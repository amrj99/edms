import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { globalErrorHandler } from "./middlewares/error-handler.js";
import { extractRealIp } from "./middlewares/real-ip.js";

// app.ts is intentionally free of startup side-effects (seeds, migrations,
// schedulers, timers). All of that lives in bootstrap.ts and runs only from the
// server entrypoint (index.ts). This lets the test harness import the Express
// app with zero background DB activity — see fix/app-bootstrap-separation.

const app: Express = express();
const isProd = process.env.NODE_ENV === "production";

// ─── Trust proxy (Cloudflare → Nginx → Node) ──────────────────────────────────
// Tells Express to trust the leftmost X-Forwarded-For entry added by a trusted
// reverse proxy. Required for req.ip to be the real client IP and for
// express-rate-limit to work correctly behind Cloudflare/Nginx.
app.set("trust proxy", 1);

// ─── Real-IP extraction (must come first) ─────────────────────────────────────
// Reads CF-Connecting-IP > X-Forwarded-For > req.ip and sets req.realIp.
app.use(extractRealIp);

// ─── Security headers (Cloudflare-compatible) ─────────────────────────────────
// Helmet is applied conditionally: file-serving routes (/api/storage/objects/*
// and /api/storage/onpremise/*) are embedded in <iframe> elements for PDF/image
// preview — Helmet is skipped entirely for these paths so X-Frame-Options is
// never emitted. All other routes receive full Helmet protection including
// frameguard: deny for clickjacking protection.
//
// Security note: the view token (5-min signed JWT, user-scoped) IS the
// clickjacking protection for file routes — X-Frame-Options is redundant there.
const FILE_ROUTE_RE = /^\/api\/storage\/(objects|onpremise)\//;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (FILE_ROUTE_RE.test(req.path)) return next(); // skip Helmet for file routes

  return helmet({
    frameguard: { action: "deny" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })(req, res, next);
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production, restrict origins to the ALLOWED_ORIGINS env var (comma-separated).
// In development, allow all origins for convenience.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const corsOptions: cors.CorsOptions = {
  origin: isProd
    ? (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Disposition"],
  optionsSuccessStatus: 204,
};

// Explicit pre-flight handler — must come BEFORE any route so nginx/proxies
// forwarding OPTIONS requests get a 204 response immediately without hitting
// auth middleware (which would 401 a pre-flight and cause a 405 on the browser side).
// Note: Express 5 requires named wildcards — "/*path" instead of "*".
app.options("/*path", cors(corsOptions));
app.use(cors(corsOptions));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global IP-based limiter acts as a baseline safety net for unrecognised routes.
// Authenticated API routes use the per-org tenant limiter (in routes/index.ts).
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: () => !isProd,
  keyGenerator: (req: Request) => req.realIp ?? req.ip ?? "unknown",
  message: { error: "Too many requests", message: "Rate limit exceeded. Please wait before retrying." },
});

// Auth endpoints stay on a strict IP-based limiter to prevent brute-force.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: () => !isProd,
  keyGenerator: (req: Request) => req.realIp ?? req.ip ?? "unknown",
  message: { error: "Too many requests", message: "Too many authentication attempts. Try again in 15 minutes." },
});

app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Raw body for Stripe webhook signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Global error handler ─────────────────────────────────────────────────────
// Must be registered after all routes. Handles AppError subclasses with typed
// HTTP responses and structured logging. See middlewares/error-handler.ts.
app.use(globalErrorHandler);

export default app;
