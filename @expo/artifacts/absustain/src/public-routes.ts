export interface PublicRoute {
  path: string;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/",                 changefreq: "weekly",  priority: 1.0 },
  { path: "/ventures",         changefreq: "weekly",  priority: 0.9 },
  { path: "/ventures/solera",  changefreq: "monthly", priority: 0.7 },
  { path: "/about",            changefreq: "monthly", priority: 0.8 },
  { path: "/investors",        changefreq: "monthly", priority: 0.8 },
  { path: "/contact",          changefreq: "monthly", priority: 0.7 },
  { path: "/press",            changefreq: "monthly", priority: 0.6 },
  { path: "/cashclip/privacy", changefreq: "yearly",  priority: 0.4 },
  { path: "/cashclip/terms",   changefreq: "yearly",  priority: 0.4 },
];

export const ROUTES = {
  HOME:            "/",
  VENTURES:        "/ventures",
  VENTURES_SOLERA: "/ventures/solera",
  ABOUT:           "/about",
  INVESTORS:       "/investors",
  CONTACT:         "/contact",
  PRESS:           "/press",
  PRIVACY:         "/cashclip/privacy",
  TERMS:           "/cashclip/terms",
  SC_PORTAL:       "/sc-portal",
} as const;
