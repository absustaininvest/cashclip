import { useEffect } from "react";

const SITE_URL = "https://absustaininvest.com";

export interface SeoProps {
  title: string;
  description: string;
  /** Canonical path on the legal domain, e.g. "/ventures". Use "/" for the home page. */
  path: string;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Sets per-page document title, meta description, canonical URL, and syncs
 * the OpenGraph/Twitter title/description/url tags on navigation.
 */
export function Seo({ title, description, path }: SeoProps) {
  useEffect(() => {
    const canonical = SITE_URL + (path === "/" ? "/" : path);

    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", "index, follow");
    upsertCanonical(canonical);

    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", canonical);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
  }, [title, description, path]);

  return null;
}
