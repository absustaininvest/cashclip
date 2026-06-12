import { useEffect } from "react";

const SITE_URL = "https://absustaininvest.com";
const DEFAULT_OG_IMAGE = "https://absustaininvest.com/absustain/logo-full.png";
const DEFAULT_OG_IMAGE_WIDTH = 981;
const DEFAULT_OG_IMAGE_HEIGHT = 487;

export interface SeoImage {
  url: string;
  width?: number;
  height?: number;
}

export interface SeoProps {
  title: string;
  description: string;
  /** Canonical path on the legal domain, e.g. "/ventures". Use "/" for the home page. */
  path: string;
  /** Optional page-specific OG/Twitter image. Falls back to the global default when omitted. */
  image?: SeoImage;
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

function removeMeta(attr: "name" | "property", key: string) {
  const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (el) el.remove();
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
 * the OpenGraph/Twitter title/description/url/image tags on navigation.
 *
 * Pass an `image` prop to override the default og:image and twitter:image for
 * this page. Omit it to fall back to the global default.
 */
export function Seo({ title, description, path, image }: SeoProps) {
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

    const img = image ?? { url: DEFAULT_OG_IMAGE, width: DEFAULT_OG_IMAGE_WIDTH, height: DEFAULT_OG_IMAGE_HEIGHT };

    upsertMeta("property", "og:image", img.url);
    upsertMeta("name", "twitter:image", img.url);
    upsertMeta("name", "twitter:card", "summary_large_image");

    if (img.width != null) {
      upsertMeta("property", "og:image:width", String(img.width));
    } else {
      removeMeta("property", "og:image:width");
    }
    if (img.height != null) {
      upsertMeta("property", "og:image:height", String(img.height));
    } else {
      removeMeta("property", "og:image:height");
    }
  }, [title, description, path, image]);

  return null;
}
