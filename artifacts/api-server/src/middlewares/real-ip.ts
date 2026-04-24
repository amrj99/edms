import { isIPv4 } from "net";
import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      /** Real client IP — CF-Connecting-IP (verified) > X-Forwarded-For[0] > req.ip */
      realIp: string;
    }
  }
}

// ─── Cloudflare egress IP ranges ─────────────────────────────────────────────
// Source: https://www.cloudflare.com/ips/ — review quarterly.
// Last checked: 2025-04.
const CF_IPV4_CIDRS: Array<[number, number]> = (
  [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  ] as const
).map((cidr) => {
  const slash = cidr.indexOf("/");
  const parts = cidr.slice(0, slash).split(".").map(Number);
  const network = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  const mask = prefix === 0 ? 0 : ((~0) << (32 - prefix)) >>> 0;
  return [network & mask, mask] as [number, number];
});

const CF_IPV6_PREFIXES = [
  "2400:cb00", "2606:4700", "2803:f800",
  "2405:b500", "2405:8100", "2a06:98c0", "2c0f:f248",
];

function ipv4ToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Returns true if `ip` is within one of Cloudflare's published egress ranges.
 * Used to validate that CF-Connecting-IP really came through Cloudflare and
 * was not injected by a client connecting directly to the origin.
 */
function isCloudflareIp(ip: string): boolean {
  const stripped = ip.replace(/^::ffff:/, "");
  if (isIPv4(stripped)) {
    const num = ipv4ToNum(stripped);
    return CF_IPV4_CIDRS.some(([net, mask]) => (num & mask) === net);
  }
  const lower = ip.toLowerCase();
  return CF_IPV6_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Extracts the real client IP, validating Cloudflare headers before trusting them.
 *
 * Priority:
 *   1. CF-Connecting-IP — only trusted when upstream (req.ip) is a Cloudflare IP.
 *      Rejects the header if the request did not actually arrive through Cloudflare,
 *      preventing header injection by clients who reach the origin directly.
 *   2. X-Forwarded-For[0] — set by Nginx / other load-balancers.
 *   3. req.ip — Express's own resolved IP (respects trust proxy = 1).
 *
 * Must be registered AFTER app.set("trust proxy", 1).
 */
export function extractRealIp(req: Request, _res: Response, next: NextFunction): void {
  const cf = req.headers["cf-connecting-ip"];
  if (cf && typeof cf === "string" && cf.trim()) {
    const upstream = (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (upstream && isCloudflareIp(upstream)) {
      req.realIp = cf.trim();
      return next();
    }
  }

  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const raw = Array.isArray(xff) ? xff[0] : xff;
    const first = raw.split(",")[0].trim();
    if (first) {
      req.realIp = first;
      return next();
    }
  }

  req.realIp = req.ip ?? "unknown";
  next();
}
