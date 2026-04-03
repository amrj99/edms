import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      /** Real client IP — CF-Connecting-IP > X-Forwarded-For[0] > req.ip */
      realIp: string;
    }
  }
}

/**
 * Extracts the real client IP address, accounting for Cloudflare proxy headers.
 * Priority order:
 *   1. CF-Connecting-IP  — set by Cloudflare, always the end-user IP
 *   2. X-Forwarded-For   — set by Nginx/load balancers; take the first (leftmost) entry
 *   3. req.ip            — Express's own resolved IP (works after trust proxy = 1)
 *
 * Must be registered AFTER app.set("trust proxy", 1).
 */
export function extractRealIp(req: Request, _res: Response, next: NextFunction): void {
  const cf = req.headers["cf-connecting-ip"];
  if (cf && typeof cf === "string" && cf.trim()) {
    req.realIp = cf.trim();
    return next();
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
