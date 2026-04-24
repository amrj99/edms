import { isIPv4, isIPv6 } from "net";
import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      /** Real client IP — CF-Connecting-IP (verified) > X-Forwarded-For[0] > req.ip */
      realIp: string;
    }
  }
}

// ─── IPv4 CIDR helpers ────────────────────────────────────────────────────────

function ipv4ToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseCidrV4(cidr: string): [number, number] {
  const slash = cidr.indexOf("/");
  const network = ipv4ToNum(cidr.slice(0, slash));
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  const mask = prefix === 0 ? 0 : ((~0) << (32 - prefix)) >>> 0;
  return [network & mask, mask];
}

function inCidrV4(ip: string, [net, mask]: [number, number]): boolean {
  return (ipv4ToNum(ip) & mask) === net;
}

// ─── IPv6 CIDR helpers ────────────────────────────────────────────────────────
// Uses BigInt for full 128-bit precision. Required for /29 and other non-32-bit
// prefix ranges (e.g. Cloudflare's 2a06:98c0::/29 spans 2a06:98c0:: – 2a06:98c7::).

function expandIPv6Groups(addr: string): number[] {
  // Handle IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const v4mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(addr);
  if (v4mapped) {
    const [a, b, c, d] = v4mapped[1].split(".").map(Number);
    addr = `::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = addr.split("::");
  const left  = halves[0] ? halves[0].split(":").map(h => parseInt(h, 16)) : [];
  const right = halves[1] ? halves[1].split(":").map(h => parseInt(h, 16)) : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv6ToBigInt(addr: string): bigint {
  return expandIPv6Groups(addr).reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

function parseCidrV6(cidr: string): [bigint, bigint] {
  const slash = cidr.indexOf("/");
  const prefixLen = BigInt(parseInt(cidr.slice(slash + 1), 10));
  const network = ipv6ToBigInt(cidr.slice(0, slash));
  const mask = prefixLen === 0n ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - prefixLen)) - 1n);
  return [network & mask, mask];
}

function inCidrV6(addr: string, [net, mask]: [bigint, bigint]): boolean {
  try {
    return (ipv6ToBigInt(addr) & mask) === net;
  } catch {
    return false;
  }
}

// ─── Cloudflare egress IP ranges ─────────────────────────────────────────────
// Source: https://www.cloudflare.com/ips/ — review quarterly.
// Last updated: 2025-04.
const CF_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
].map(parseCidrV4);

// BigInt CIDR comparison — correct for all prefix lengths including the /29 range
// (2a06:98c0::/29 spans 2a06:98c0:: through 2a06:98c7::, not just 2a06:98c0::).
const CF_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
  "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
].map(parseCidrV6);

/**
 * Returns true if `ip` is within one of Cloudflare's published egress ranges.
 * IPv4 uses 32-bit unsigned integer math; IPv6 uses BigInt 128-bit comparison.
 * Handles IPv4-mapped IPv6 addresses (::ffff:x.x.x.x).
 */
function isCloudflareIp(ip: string): boolean {
  const stripped = ip.replace(/^::ffff:/, "");
  if (isIPv4(stripped)) {
    return CF_V4.some(cidr => inCidrV4(stripped, cidr));
  }
  if (isIPv6(ip)) {
    return CF_V6.some(cidr => inCidrV6(ip, cidr));
  }
  return false;
}

/**
 * Extracts the real client IP, validating Cloudflare headers before trusting them.
 *
 * Priority:
 *   1. CF-Connecting-IP — only trusted when upstream (req.ip) is a verified Cloudflare IP.
 *      Prevents header injection by clients connecting directly to the origin.
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
