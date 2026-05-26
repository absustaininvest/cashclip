/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const PRIVACY_PATH = path.resolve(__dirname, "templates", "privacy.html");
const SUPPORT_PATH = path.resolve(__dirname, "templates", "support.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(res, landingPageTemplate, appName) {
  const baseUrl = htmlEscape(`https://${CONFIGURED_HOSTNAME}`);
  const expsUrl = htmlEscape(CONFIGURED_HOSTNAME);
  // For values injected into JavaScript string literals, use JSON.stringify so
  // that characters like \, ", and newlines are correctly escaped for that
  // context rather than relying on HTML escaping, which is wrong for JS.
  const deepLinkJs = JSON.stringify(`exps://${CONFIGURED_HOSTNAME}`);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/DEEP_LINK_JS_PLACEHOLDER/g, deepLinkJs)
    .replace(/APP_NAME_PLACEHOLDER/g, htmlEscape(appName));

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const privacyPageHtml = fs.readFileSync(PRIVACY_PATH, "utf-8");
const supportPageHtml = fs.readFileSync(SUPPORT_PATH, "utf-8");
const appName = getAppName();

function serveStaticHtml(html, res) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

const ABSUSTAIN_DOMAIN = "absustaininvest.com";

const REPLIT_DOMAIN_PATTERN = /replit\.(app|dev)$/i;
const CASHCLIP_DOMAIN = "cash-clip.app";

/**
 * Trusted static hostname resolved once at startup from environment config.
 * Never derived from request headers to prevent host-header injection.
 */
const CONFIGURED_HOSTNAME = (() => {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return domains.split(",")[0].trim();
  if (process.env.APP_HOSTNAME) return process.env.APP_HOSTNAME;
  return CASHCLIP_DOMAIN;
})();

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const server = http.createServer((req, res) => {
  const rawHost = req.headers["host"];
  const safeHost =
    typeof rawHost === "string" && /^[a-zA-Z0-9.\-:[\]]+$/.test(rawHost)
      ? rawHost
      : "localhost";

  let url;
  try {
    url = new URL(req.url || "/", `http://${safeHost}`);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad Request");
    return;
  }
  let pathname = url.pathname;

  const host = safeHost.replace(/:\d+$/, "").toLowerCase();
  const expoPlatform = req.headers["expo-platform"];

  if (REPLIT_DOMAIN_PATTERN.test(host) && !expoPlatform) {
    const target = pathname.startsWith("/absustain")
      ? `https://${ABSUSTAIN_DOMAIN}${pathname}`
      : `https://${CASHCLIP_DOMAIN}${pathname}`;
    res.writeHead(301, { location: target });
    res.end();
    return;
  }


  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = expoPlatform;
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(res, landingPageTemplate, appName);
    }
  }

  if (pathname === "/privacy" || pathname === "/privacy/") {
    return serveStaticHtml(privacyPageHtml, res);
  }

  if (pathname === "/support" || pathname === "/support/") {
    return serveStaticHtml(supportPageHtml, res);
  }


  if (pathname === "/app-ads.txt" || pathname === "/ads.txt") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end([
      "google.com, pub-8679658921848348, DIRECT, f08c47fec0942fa0",
      "unity.com, 121661720, DIRECT, 96cabb5fbdde37a7",
      "adagio.io, 1522, RESELLER",
      "adagio.io, 1575, RESELLER",
      "admanmedia.com, 2242, RESELLER",
      "adyoulike.com, aff404dd1a704f379acae5190701c9c2, RESELLER",
      "adyoulike.com, f78b24039641337f06634ab9a3da4b48, RESELLER",
      "algorix.co, 54616, RESELLER, 5b394c12fea27a1d",
      "anzu.io, 691e95644e633a6eee2567ee, RESELLER, 1c1b7acf4992136c",
      "app-stock.com, 256917, RESELLER",
      "app-stock.com, 358747, RESELLER",
      "appads.in, 106246, RESELLER",
      "appnexus.com, 11826, RESELLER, f5ab79cb980f11d1",
      "appnexus.com, 12061, RESELLER, f5ab79cb980f11d1",
      "appnexus.com, 14230, RESELLER, f5ab79cb980f11d1",
      "appnexus.com, 15980, RESELLER, f5ab79cb980f11d1",
      "appnexus.com, 17234, RESELLER",
      "appnexus.com, 17779, RESELLER",
      "appnexus.com, 6849, RESELLER",
      "betweendigital.com, 45827, RESELLER",
      "bidmachine.io, 1371, RESELLER",
      "bidmachine.io, 1412, RESELLER",
      "bidmachine.io, 896, RESELLER",
      "blueseasx.com, 203625, RESELLER",
      "bold-win.com, 165, RESELLER, 71746737d0bab951",
      "contextweb.com, 558622, RESELLER, 89ff185a4c4e857c",
      "conversantmedia.com, 41024, RESELLER, 03113cd04947736d",
      "criteo.com, b-062019, RESELLER, 9fac4a4a87c2a44f",
      "google.com, pub-1682595508078257, RESELLER, f08c47fec0942fa0",
      "google.com, pub-2923085774557613, RESELLER, f08c47fec0942fa0",
      "google.com, pub-3990748024667386, RESELLER, f08c47fec0942fa0",
      "google.com, pub-5060663379040713, RESELLER, f08c47fec0942fa0",
      "ignitemediatech.com, pub_11115, RESELLER",
      "improvedigital.com, 2297, RESELLER",
      "improvedigital.com, 2464, RESELLER",
      "indexexchange.com, 214183, RESELLER, 50b1c356f2c5c8fc",
      "inmobi.com, 23d316d3d980453d8ea0dcf9caec4078, RESELLER, 83e75a7ae333ca9d",
      "jcprog.com, pub-4518750432, RESELLER",
      "kidoz.net, 14260, RESELLER, a109366414b7335e",
      "kidoz.net, 15467, RESELLER, a109366414b7335e",
      "lacunads.com, lcb555b3bc8667a09a, RESELLER",
      "lijit.com, 528770, RESELLER, fafdf38b16bf6b2b",
      "loopme.com, 11463, RESELLER, 6c8d5f95897a5a3b",
      "loopme.com, 9621, RESELLER, 6c8d5f95897a5a3b",
      "lunamedia.io, 2fdb16a1-5025-4c41-9b17-e01e47ebc8b4, RESELLER, 524ecb396915caaf",
      "mars.media, 1010442, RESELLER",
      "media.net, 8cu12aq1y, RESELLER",
      "media.net, 8cu355vs4, RESELLER",
      "media.net, 8cu5l226o, RESELLER",
      "media.net, 8cu9b72o6, RESELLER",
      "media.net, 8CUH46N56, RESELLER",
      "openx.com, 537153564, RESELLER, 6a698e2ec38604c6",
      "openx.com, 559912325, RESELLER, 6a698e2ec38604c6",
      "openx.com, 561446248, RESELLER, 6a698e2ec38604c6",
      "openx.com, 561470659, RESELLER, 6a698e2ec38604c6",
      "openx.com, 562174952, RESELLER, 6a698e2ec38604c6",
      "opera.com, pub6148735850944, RESELLER, 55a0c5fd61378de3",
      "outbrain.com, 0073fa86cff719c752763d2c3ee52c8f00, RESELLER",
      "pokkt.com, 6246, RESELLER, c45702d9311e25fd",
      "prado.co, 14260, RESELLER",
      "programmaticx.ai, 84448, RESELLER, b42d42eb28400efa",
      "pubmatic.com, 137711, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 156177, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 156520, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 159501, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 159906, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 160318, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 160456, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 161151, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 162588, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 165438, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 167130, RESELLER, 5d62403b186f2ace",
      "pubmatic.com, 167188, RESELLER, 5d62403b186f2ace",
      "pubnative.net, 1009458, RESELLER, d641df8625486a7b",
      "pubnative.net, 1009966, RESELLER, d641df8625486a7b",
      "risecodes.com, 68d54e2fe125150001dd91e2, RESELLER",
      "rubiconproject.com, 13380, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 15268, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 15854, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 17062, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 17328, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 17476, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 17608, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 17960, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 20014, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 20744, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 22134, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 22412, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 24400, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 24600, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 25064, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 25336, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 25978, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 26132, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 26292, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 26958, RESELLER, 0bfd66d529a55807",
      "rubiconproject.com, 28169, RESELLER, 0bfd66d529a55807",
      "sharethrough.com, 3713, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, 5294, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, 5828-OB, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, 5828, RESELLER, 060d053dcf45cbf3",
      "sharethrough.com, bc6d1whs, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, bxzzb1br, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, ftvct81v, RESELLER",
      "sharethrough.com, ibazay96, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, r9b1mg7e, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, sniqcomc, RESELLER, d53b998a7bd4ecd2",
      "sharethrough.com, UvcAx8IL, RESELLER, d53b998a7bd4ecd2",
      "smaato.com, 1100040398, RESELLER, 07bcf65f187117b4",
      "smaato.com, 1100047589, RESELLER, 07bcf65f187117b4",
      "smaato.com, 1100055750, RESELLER, 07bcf65f187117b4",
      "smaato.com, 1100059282, RESELLER, 07bcf65f187117b4",
      "smaato.com, 1100059375, RESELLER, 07bcf65f187117b4",
      "smaato.com, 1100059563, RESELLER, 07bcf65f187117b4",
      "smartadserver.com, 4456, RESELLER",
      "smartadserver.com, 4568, RESELLER, 060d053dcf45cbf3",
      "smartadserver.com, 4578, RESELLER, 060d053dcf45cbf3",
      "smartadserver.com, 4610, RESELLER, 060d053dcf45cbf3",
      "smartadserver.com, 5294, RESELLER, 060d053dcf45cbf3",
      "smartadserver.com, 5828-OB, RESELLER, 060d053dcf45cbf3",
      "smartadserver.com, 5828, RESELLER, 060d053dcf45cbf3",
      "smartclip.net, 13564, RESELLER",
      "start.io, 168507669, RESELLER",
      "start.io, 197760873, RESELLER",
      "targetbetter.com, 82228, RESELLER",
      "taurusx.com, 70079, RESELLER",
      "thebrave.io, 1234634, RESELLER, c25b2154543746ac",
      "themediagrid.com, GODNC4, RESELLER, 35d5010d7789b49d",
      "themediagrid.com, ws2d8n, RESELLER, 35d5010d7789b49d",
      "thunder-monetize.com, 4818959194, RESELLER",
      "toponad.com, 165535463cfb70, RESELLER, 1d49fe424a1a456d",
      "tredio.io, 357a6fdf7642bf815a88822c447d9dc436891, RESELLER",
      "triplelift.com, 12908, RESELLER, 6c33edb13117fd86",
      "triplelift.com, 13042, RESELLER",
      "triplelift.com, 13883, RESELLER, 6c33edb13117fd86",
      "triplelift.com, 14127, RESELLER, 6c33edb13117fd86",
      "triplelift.com, 14594, RESELLER, 6c33edb13117fd86",
      "triplelift.com, 14716, RESELLER, 6c33edb13117fd86",
      "triplelift.com, 95054, RESELLER, 6c33edb13117fd86",
      "undertone.com, 4108, RESELLER",
      "ushareit.com, lcb555b3bc8667a09a, RESELLER",
      "video.unrulymedia.com, 144138083, RESELLER",
      "video.unrulymedia.com, 389957698, RESELLER",
      "video.unrulymedia.com, 657436911, RESELLER",
      "videoheroes.tv, 212428, RESELLER, 064bc410192443d8",
      "voisetech.com, 1066, RESELLER",
      "xandr.com, 13799, RESELLER",
      "xandr.com, 15840, RESELLER",
      "xandr.com, 17779, RESELLER",
      "zetaglobal.net, 630, RESELLER",
      "zmaticoo.com, 5135195, RESELLER",
    ].join("\n") + "\n");
    return;
  }

  serveStaticFile(pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static Expo build on port ${port}`);
});
