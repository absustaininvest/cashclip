import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/cashclip";
import { appVersionMiddleware } from "./lib/versionCheck";
import { getClientIp } from "./lib/clientIp";

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /\.replit\.dev$/,
  /\.replit\.app$/,
  /^https:\/\/cash-clip\.app$/,
  /^https:\/\/www\.cash-clip\.app$/,
  /^https:\/\/absustaininvest\.com$/,
  /^https:\/\/www\.absustaininvest\.com$/,
];

// ── COOKIE SESSION SECRET (INVECE) ───────────────────────────────────────────
// INVECE signs the sid cookie envelope. JWT_TRIDENTE validates the token inside.
const INVECE_SECRET = process.env.INVECE ?? "";
if (!INVECE_SECRET) {
  logger.warn("INVECE not set — signed cookie session layer is disabled");
}

const app: Express = express();
app.set("trust proxy", 1);
app.use(cookieParser(INVECE_SECRET || undefined));

// ── MAINTENANCE MODE ─────────────────────────────────────────────────────────
// Set MAINTENANCE_MODE=1 to take the API offline for the public.
// Returns 503 for every route. Bypass with header X-Maintenance-Bypass that
// matches MAINTENANCE_BYPASS_TOKEN so operators can keep testing.
const MAINTENANCE_MODE = ["1", "true", "on", "yes"].includes(
  (process.env.MAINTENANCE_MODE ?? "").toLowerCase(),
);
const MAINTENANCE_BYPASS_TOKEN = process.env.MAINTENANCE_BYPASS_TOKEN ?? "";
if (MAINTENANCE_MODE) {
  logger.warn("MAINTENANCE_MODE is ON — all API traffic will be served 503");
  app.use((req, res, next) => {
    if (
      MAINTENANCE_BYPASS_TOKEN &&
      req.header("X-Maintenance-Bypass") === MAINTENANCE_BYPASS_TOKEN
    ) {
      return next();
    }
    res.status(503);
    res.setHeader("Retry-After", "3600");
    if (req.accepts(["html", "json"]) === "html") {
      res.type("html").send(
        `<!doctype html><html><head><meta charset="utf-8"><title>Service unavailable</title>` +
          `<meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#eaeaea;` +
          `display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}` +
          `h1{font-size:22px;font-weight:600;margin:0 0 8px}p{opacity:.7;margin:0;max-width:420px}` +
          `</style></head><body><div><h1>Service temporarily unavailable</h1>` +
          `<p>We're offline for maintenance. Please check back soon.</p></div></body></html>`,
      );
    } else {
      res.json({ error: "Service temporarily unavailable", maintenance: true });
    }
  });
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Single, restrictive CORS policy.  Mobile clients (no Origin header) are
// allowed through; unknown browser origins are rejected.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGINS.some((p) => p.test(origin));
      if (allowed) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }),
);

// ── GLOBAL RATE LIMIT ────────────────────────────────────────────────────────
// Caps total API requests per IP to prevent CPU/bandwidth abuse.
// Specific routes (webhooks, auth, leads) have their own tighter limits on
// top of this.  Uses the rightmost XFF address (getClientIp) so proxy
// headers cannot be spoofed to bypass the cap.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.GLOBAL_RATE_LIMIT ?? "300", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  // Suppress only the IPv6 keyGenerator validation: our getClientIp already
  // extracts the rightmost XFF entry correctly for this deployment, so the
  // library's heuristic is a false positive. All other validations remain on.
  validate: { keyGeneratorIpFallback: false },
  handler(_req, res) {
    res.status(429).json({ error: "Too many requests — please slow down." });
  },
});
app.use("/api", globalLimiter);

// ── VERSION GATE ─────────────────────────────────────────────────────────────
// Rejects app clients that send X-App-Version below MIN_APP_VERSION.
// Clients that omit the header (web, curl, provider callbacks) are not blocked.
app.use("/api", appVersionMiddleware);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ── BODY PARSING ─────────────────────────────────────────────────────────────
// Hard cap on request body size to prevent memory/CPU exhaustion from large
// payloads.  Webhook routes get rawBody attached for HMAC verification.
app.use(
  express.json({
    limit: "64kb",
    verify: (req, _res, buf) => {
      if (req.url?.includes("/webhook/")) {
        (req as unknown as Record<string, unknown>).rawBody = buf;
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

function loadTemplate(filename: string): string | null {
  const primary = path.resolve(import.meta.dirname ?? __dirname, "templates", filename);
  try {
    return fs.readFileSync(primary, "utf-8");
  } catch {
    const fallback = path.resolve(process.cwd(), "src", "templates", filename);
    try {
      return fs.readFileSync(fallback, "utf-8");
    } catch {
      logger.warn(`Template not found: ${filename}`);
      return null;
    }
  }
}

const landingHtml = loadTemplate("landing-page.html");
const corporateHtml = loadTemplate("corporate-page.html");
const privacyHtml = loadTemplate("privacy-page.html");
const supportHtml = loadTemplate("support-page.html");

if (landingHtml) {
  app.get("/api", (_req, res) => {
    res.type("html").send(landingHtml);
  });
  app.get("/api/", (_req, res) => {
    res.type("html").send(landingHtml);
  });
}

if (corporateHtml) {
  app.get("/api/about", (_req, res) => {
    res.type("html").send(corporateHtml);
  });
}

if (privacyHtml) {
  app.get("/api/privacy", (_req, res) => {
    res.type("html").send(privacyHtml);
  });
}

if (supportHtml) {
  app.get("/api/support", (_req, res) => {
    res.type("html").send(supportHtml);
  });
}


app.use("/api", router);
registerRoutes(app);

export default app;
