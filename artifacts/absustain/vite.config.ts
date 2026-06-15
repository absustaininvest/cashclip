import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { PUBLIC_ROUTES, ROUTES } from "./src/public-routes";

const SITE_BASE = "https://absustaininvest.com";

interface RouteMeta {
  title: string;
  description: string;
  image: string;
  imageWidth?: number;
  imageHeight?: number;
}

const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "AB Sustainability Investments LLC — Building Enduring Enterprises",
    description:
      "AB Sustainability Investments LLC is a diversified holding company building sustainable technology, retail, and food service ventures, including the CashClip rewards app and Solera Restaurant.",
    image: "https://absustaininvest.com/absustain/opengraph.jpg",
    imageWidth: 1280,
    imageHeight: 720,
  },
  "/ventures": {
    title: "Ventures & Portfolio | AB Sustainability Investments",
    description:
      "Explore the AB Sustainability Investments portfolio across technology, retail, and food service — including the CashClip mobile rewards app and Solera Restaurant.",
    image: "https://absustaininvest.com/absustain/ab-logo.jpeg",
    imageWidth: 1320,
    imageHeight: 757,
  },
  "/ventures/solera": {
    title: "Solera Restaurant | AB Sustainability Investments",
    description:
      "Solera Restaurant — aged in tradition, served with soul. A modern hospitality and food service venture in Lake Worth Beach, FL, part of AB Sustainability Investments.",
    image: "https://absustaininvest.com/absustain/solera-logo.jpeg",
    imageWidth: 1116,
    imageHeight: 1140,
  },
  "/about": {
    title: "About | AB Sustainability Investments",
    description:
      "Learn about AB Sustainability Investments LLC — a diversified holding company founded by Jorge Ballen that builds, operates, and invests in sustainable business models for long-term value.",
    image: "https://absustaininvest.com/absustain/logo-full.png",
    imageWidth: 981,
    imageHeight: 487,
  },
  "/investors": {
    title: "Investor Relations | AB Sustainability Investments",
    description:
      "Investor relations for AB Sustainability Investments LLC — explore investment opportunities, equity details, and the growth strategy behind our sustainable venture portfolio.",
    image: "https://absustaininvest.com/absustain/opengraph.jpg",
    imageWidth: 1280,
    imageHeight: 720,
  },
  "/contact": {
    title: "Contact | AB Sustainability Investments",
    description:
      "Get in touch with AB Sustainability Investments LLC for corporate inquiries, partnerships, and investor relations, or reach support for the CashClip rewards app.",
    image: "https://absustaininvest.com/absustain/logo-full.png",
    imageWidth: 981,
    imageHeight: 487,
  },
  "/press": {
    title: "Press Kit | AB Sustainability Investments",
    description:
      "Press and media resources for AB Sustainability Investments LLC — company background, brand assets, leadership, and information about CashClip and our venture portfolio.",
    image: "https://absustaininvest.com/absustain/logo-full.png",
    imageWidth: 981,
    imageHeight: 487,
  },
  "/cashclip/privacy": {
    title: "CashClip Privacy Policy | AB Sustainability Investments",
    description:
      "The CashClip privacy policy explains how AB Sustainability Investments LLC collects, uses, and protects your information when you use the CashClip mobile rewards app.",
    image: "https://absustaininvest.com/absustain/logo-full.png",
    imageWidth: 981,
    imageHeight: 487,
  },
  "/cashclip/terms": {
    title: "CashClip Terms of Service | AB Sustainability Investments",
    description:
      "The CashClip terms of service govern your use of the CashClip mobile rewards app operated by AB Sustainability Investments LLC, including rewards, withdrawals, and account rules.",
    image: "https://absustaininvest.com/absustain/logo-full.png",
    imageWidth: 981,
    imageHeight: 487,
  },
};

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function replaceAttrValue(
  html: string,
  selector: string,
  attrName: string,
  value: string,
): string {
  const re = new RegExp(
    `(<meta\\s[^>]*${selector}[^>]*\\s${attrName}=")[^"]*("(?:[^>]*>))`,
    "i",
  );
  if (re.test(html)) return html.replace(re, `$1${value}$2`);
  const re2 = new RegExp(
    `(<meta\\s[^>]*${attrName}=")[^"]*("[^>]*${selector}[^>]*>)`,
    "i",
  );
  return html.replace(re2, `$1${value}$2`);
}

function injectRouteMeta(template: string, route: string, meta: RouteMeta): string {
  const canonicalUrl = SITE_BASE + (route === "/" ? "/" : route);
  let html = template;

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(meta.title)}</title>`);

  html = replaceAttrValue(html, 'name="description"', "content", escapeAttr(meta.description));

  html = replaceAttrValue(html, 'property="og:title"', "content", escapeAttr(meta.title));
  html = replaceAttrValue(html, 'property="og:description"', "content", escapeAttr(meta.description));
  html = replaceAttrValue(html, 'property="og:url"', "content", canonicalUrl);
  html = replaceAttrValue(html, 'property="og:image"', "content", meta.image);

  html = replaceAttrValue(html, 'name="twitter:title"', "content", escapeAttr(meta.title));
  html = replaceAttrValue(html, 'name="twitter:description"', "content", escapeAttr(meta.description));
  html = replaceAttrValue(html, 'name="twitter:image"', "content", meta.image);

  if (meta.imageWidth != null || meta.imageHeight != null) {
    const dimensionTags: string[] = [];
    if (meta.imageWidth != null) {
      dimensionTags.push(`    <meta property="og:image:width" content="${meta.imageWidth}" />`);
    }
    if (meta.imageHeight != null) {
      dimensionTags.push(`    <meta property="og:image:height" content="${meta.imageHeight}" />`);
    }
    if (html.includes('property="og:image:width"')) {
      html = replaceAttrValue(html, 'property="og:image:width"', "content", String(meta.imageWidth ?? ""));
    } else {
      html = html.replace(
        /(<meta\s[^>]*property="og:image"[^>]*>)/i,
        `$1\n${dimensionTags[0]}`,
      );
      if (dimensionTags[1]) {
        html = html.replace(
          /(<meta\s[^>]*property="og:image:width"[^>]*>)/i,
          `$1\n${dimensionTags[1]}`,
        );
      }
    }
    if (html.includes('property="og:image:height"') && !dimensionTags[1]) {
      html = replaceAttrValue(html, 'property="og:image:height"', "content", String(meta.imageHeight ?? ""));
    }
  }

  return html;
}

function prerenderPlugin(): Plugin {
  return {
    name: "prerender-meta",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist/public");
      const templatePath = path.join(outDir, "index.html");
      let template: string;
      try {
        template = readFileSync(templatePath, "utf-8");
      } catch {
        this.warn("prerender-meta: dist/public/index.html not found, skipping.");
        return;
      }

      for (const [route, meta] of Object.entries(ROUTE_META)) {
        const html = injectRouteMeta(template, route, meta);

        if (route === "/") {
          writeFileSync(templatePath, html, "utf-8");
        } else {
          const routeDir = path.join(outDir, route.slice(1));
          mkdirSync(routeDir, { recursive: true });
          writeFileSync(path.join(routeDir, "index.html"), html, "utf-8");
        }
      }

      const count = Object.keys(ROUTE_META).length;
      console.log(`\n✓ prerender-meta: wrote ${count} per-route index.html files with injected og/twitter meta\n`);
    },
  };
}

function sitemapPlugin(): Plugin {
  return {
    name: "generate-sitemap",
    generateBundle() {
      const lastmod = new Date().toISOString().split("T")[0];
      const urls = PUBLIC_ROUTES.map(({ path: p, changefreq, priority }) => {
        const loc = p === "/" ? `${SITE_BASE}/` : `${SITE_BASE}${p}`;
        return [
          `  <url>`,
          `    <loc>${loc}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          `    <changefreq>${changefreq}</changefreq>`,
          `    <priority>${priority.toFixed(1)}</priority>`,
          `  </url>`,
        ].join("\n");
      }).join("\n");
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls + "\n" +
        `</urlset>\n`;
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: xml });
    },
  };
}

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
  `<p>We sincerely apologize for the inconvenience. We're offline for scheduled maintenance and will be back shortly. Thank you for your patience.</p></div></body></html>`;

function antiClickjackPlugin(): Plugin {
  const ANTI_FRAMING_HEADERS: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
  };
  return {
    name: "anti-clickjack",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(ANTI_FRAMING_HEADERS)) {
          res.setHeader(k, v);
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(ANTI_FRAMING_HEADERS)) {
          res.setHeader(k, v);
        }
        next();
      });
    },
  };
}

function routeSyncCheckPlugin(): Plugin {
  return {
    name: "route-sync-check",
    buildStart() {
      const EXCLUDED = new Set<string>([ROUTES.SC_PORTAL]);
      const isDynamic = /:/;

      const sitemapPaths = new Set(PUBLIC_ROUTES.map((r) => r.path));
      const appPaths = (Object.values(ROUTES) as string[]).filter(
        (p) => !EXCLUDED.has(p) && !isDynamic.test(p),
      );

      const missing = appPaths.filter((p) => !sitemapPaths.has(p));
      if (missing.length > 0) {
        this.error(
          `Sitemap/route mismatch — routes in ROUTES but missing from PUBLIC_ROUTES:\n` +
          missing.map((p) => `  ${p}`).join("\n") +
          `\nAdd them to artifacts/absustain/src/public-routes.ts`,
        );
      }

      const appPathSet = new Set(appPaths);
      const orphaned = [...sitemapPaths].filter((p) => !appPathSet.has(p));
      if (orphaned.length > 0) {
        this.warn(
          `Sitemap/route mismatch — paths in PUBLIC_ROUTES but not in ROUTES:\n` +
          orphaned.map((p) => `  ${p}`).join("\n") +
          `\nRemove them from artifacts/absustain/src/public-routes.ts or add matching ROUTES entries.`,
        );
      }
    },
  };
}

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
    antiClickjackPlugin(),
    archiveGuardPlugin(),
    routeSyncCheckPlugin(),
    sitemapPlugin(),
    prerenderPlugin(),
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
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
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
