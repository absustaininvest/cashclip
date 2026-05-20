import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readdirSync } from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH ?? "/absustain/";

const MAINTENANCE_MODE = ["1", "true", "on", "yes"].includes(
  (process.env.MAINTENANCE_MODE ?? "").toLowerCase(),
);
const MAINTENANCE_BYPASS_TOKEN = process.env.MAINTENANCE_BYPASS_TOKEN ?? "";

const MAINTENANCE_HTML =
  `<!doctype html><html><head><meta charset="utf-8"><title>Service unavailable</title>` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#eaeaea;` +
  `display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}` +
  `h1{font-size:22px;font-weight:600;margin:0 0 8px}p{opacity:.7;margin:0;max-width:420px}` +
  `</style></head><body><div><h1>Service temporarily unavailable</h1>` +
  `<p>We're offline for maintenance. Please check back soon.</p></div></body></html>`;

function archiveGuardPlugin(): Plugin {
  return {
    name: "archive-guard",
    buildStart() {
      const publicDir = path.resolve(import.meta.dirname, "public");
      const BLOCKED = /\.(zip|tar|gz|tgz|7z|rar|bz2)$/i;
      let found: string[];
      try {
        found = readdirSync(publicDir, { recursive: true } as Parameters<typeof readdirSync>[1]).filter(
          (f): f is string => typeof f === "string" && BLOCKED.test(f),
        );
      } catch {
        return;
      }
      if (found.length > 0) {
        this.error(
          `Archive files must not be published to static web roots.\n` +
          `Remove these files from artifacts/absustain/public/:\n` +
          found.map((f) => `  ${f}`).join("\n"),
        );
      }
    },
  };
}

function maintenancePlugin(): Plugin {
  return {
    name: "maintenance-mode",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          MAINTENANCE_BYPASS_TOKEN &&
          req.headers["x-maintenance-bypass"] === MAINTENANCE_BYPASS_TOKEN
        ) return next();
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Retry-After", "3600");
        res.end(MAINTENANCE_HTML);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          MAINTENANCE_BYPASS_TOKEN &&
          req.headers["x-maintenance-bypass"] === MAINTENANCE_BYPASS_TOKEN
        ) return next();
        res.statusCode = 503;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Retry-After", "3600");
        res.end(MAINTENANCE_HTML);
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    archiveGuardPlugin(),
    ...(MAINTENANCE_MODE ? [maintenancePlugin()] : []),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
