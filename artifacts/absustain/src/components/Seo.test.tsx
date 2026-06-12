import { describe, it, expect, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";
import { Seo } from "./Seo";

function getMeta(attr: "name" | "property", key: string): string | null {
  const el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  return el ? el.getAttribute("content") : null;
}

function getCanonical(): string | null {
  const el = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  return el ? el.getAttribute("href") : null;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.title = "";
});

const SITE = "https://absustaininvest.com";

const pages = [
  {
    name: "Home",
    title:
      "AB Sustainability Investments LLC — Building Enduring Enterprises",
    description:
      "AB Sustainability Investments LLC is a diversified holding company building sustainable technology, retail, and food service ventures, including the CashClip rewards app and Solera Restaurant.",
    path: "/",
  },
  {
    name: "About",
    title: "About | AB Sustainability Investments",
    description:
      "Learn about AB Sustainability Investments LLC — a diversified holding company founded by Jorge Ballen that builds, operates, and invests in sustainable business models for long-term value.",
    path: "/about",
  },
  {
    name: "Ventures",
    title: "Ventures & Portfolio | AB Sustainability Investments",
    description:
      "Explore the AB Sustainability Investments portfolio across technology, retail, and food service — including the CashClip mobile rewards app and Solera Restaurant.",
    path: "/ventures",
  },
  {
    name: "Solera",
    title: "Solera Restaurant | AB Sustainability Investments",
    description:
      "Solera Restaurant — aged in tradition, served with soul. A modern hospitality and food service venture in Lake Worth Beach, FL, part of AB Sustainability Investments.",
    path: "/ventures/solera",
  },
  {
    name: "Investors",
    title: "Investor Relations | AB Sustainability Investments",
    description:
      "Investor relations for AB Sustainability Investments LLC — explore investment opportunities, equity details, and the growth strategy behind our sustainable venture portfolio.",
    path: "/investors",
  },
  {
    name: "Contact",
    title: "Contact | AB Sustainability Investments",
    description:
      "Get in touch with AB Sustainability Investments LLC for corporate inquiries, partnerships, and investor relations, or reach support for the CashClip rewards app.",
    path: "/contact",
  },
  {
    name: "Press Kit",
    title: "Press Kit | AB Sustainability Investments",
    description:
      "Press and media resources for AB Sustainability Investments LLC — company background, brand assets, leadership, and information about CashClip and our venture portfolio.",
    path: "/press",
  },
  {
    name: "CashClip Privacy",
    title: "CashClip Privacy Policy | AB Sustainability Investments",
    description:
      "The CashClip privacy policy explains how AB Sustainability Investments LLC collects, uses, and protects your information when you use the CashClip mobile rewards app.",
    path: "/cashclip/privacy",
  },
  {
    name: "CashClip Terms",
    title: "CashClip Terms of Service | AB Sustainability Investments",
    description:
      "The CashClip terms of service govern your use of the CashClip mobile rewards app operated by AB Sustainability Investments LLC, including rewards, withdrawals, and account rules.",
    path: "/cashclip/terms",
  },
];

describe("Seo component", () => {
  it.each(pages)(
    "$name — sets title, description, canonical, and robots=index,follow",
    ({ title, description, path: pagePath }) => {
      act(() => {
        render(
          <Seo title={title} description={description} path={pagePath} />,
        );
      });

      expect(document.title).toBe(title);
      expect(getMeta("name", "description")).toBe(description);

      const expectedCanonical =
        pagePath === "/" ? SITE + "/" : SITE + pagePath;
      expect(getCanonical()).toBe(expectedCanonical);

      expect(getMeta("name", "robots")).toBe("index, follow");
    },
  );

  it.each(pages)(
    "$name — sets og:title, og:description, og:url",
    ({ title, description, path: pagePath }) => {
      act(() => {
        render(
          <Seo title={title} description={description} path={pagePath} />,
        );
      });

      expect(getMeta("property", "og:title")).toBe(title);
      expect(getMeta("property", "og:description")).toBe(description);

      const expectedCanonical =
        pagePath === "/" ? SITE + "/" : SITE + pagePath;
      expect(getMeta("property", "og:url")).toBe(expectedCanonical);
    },
  );

  it.each(pages)(
    "$name — sets twitter:title, twitter:description, twitter:card",
    ({ title, description, path: pagePath }) => {
      act(() => {
        render(
          <Seo title={title} description={description} path={pagePath} />,
        );
      });

      expect(getMeta("name", "twitter:title")).toBe(title);
      expect(getMeta("name", "twitter:description")).toBe(description);
      expect(getMeta("name", "twitter:card")).toBe("summary_large_image");
    },
  );

  it("uses global default og:image when no image prop is given", () => {
    act(() => {
      render(
        <Seo title="Test" description="desc" path="/about" />,
      );
    });

    const DEFAULT_OG_IMAGE =
      "https://absustaininvest.com/absustain/logo-full.png";
    expect(getMeta("property", "og:image")).toBe(DEFAULT_OG_IMAGE);
    expect(getMeta("name", "twitter:image")).toBe(DEFAULT_OG_IMAGE);
    expect(getMeta("property", "og:image:width")).toBe("981");
    expect(getMeta("property", "og:image:height")).toBe("487");
  });

  it("uses the supplied image and removes width/height when omitted", () => {
    act(() => {
      render(
        <Seo
          title="Test"
          description="desc"
          path="/about"
          image={{ url: "https://example.com/custom.jpg" }}
        />,
      );
    });

    expect(getMeta("property", "og:image")).toBe(
      "https://example.com/custom.jpg",
    );
    expect(getMeta("name", "twitter:image")).toBe(
      "https://example.com/custom.jpg",
    );
    expect(
      document.head.querySelector('meta[property="og:image:width"]'),
    ).toBeNull();
    expect(
      document.head.querySelector('meta[property="og:image:height"]'),
    ).toBeNull();
  });

  it("updates all tags when props change", () => {
    const { rerender } = render(
      <Seo title="First" description="first desc" path="/about" />,
    );
    expect(document.title).toBe("First");
    expect(getMeta("name", "description")).toBe("first desc");

    act(() => {
      rerender(
        <Seo title="Second" description="second desc" path="/contact" />,
      );
    });

    expect(document.title).toBe("Second");
    expect(getMeta("name", "description")).toBe("second desc");
    expect(getCanonical()).toBe(`${SITE}/contact`);
    expect(getMeta("property", "og:title")).toBe("Second");
    expect(getMeta("name", "twitter:title")).toBe("Second");
  });
});

describe("AdminGate — SEO behaviour", () => {
  it("sets robots=noindex,nofollow when mounted", async () => {
    const AdminGate = (await import("../pages/AdminGate")).default;
    act(() => {
      render(<AdminGate />);
    });
    expect(getMeta("name", "robots")).toBe("noindex, nofollow");
  });

  it("sets document.title to 'Operator Portal' when mounted", async () => {
    const AdminGate = (await import("../pages/AdminGate")).default;
    document.title = "Previous Title";
    act(() => {
      render(<AdminGate />);
    });
    expect(document.title).toBe("Operator Portal");
  });

  it("restores title and removes robots tag on unmount", async () => {
    const AdminGate = (await import("../pages/AdminGate")).default;
    document.title = "Original Title";

    let unmount!: () => void;
    act(() => {
      const result = render(<AdminGate />);
      unmount = result.unmount;
    });

    expect(document.title).toBe("Operator Portal");
    expect(getMeta("name", "robots")).toBe("noindex, nofollow");

    act(() => {
      unmount();
    });

    expect(document.title).toBe("Original Title");
    expect(
      document.head.querySelector('meta[name="robots"]'),
    ).toBeNull();
  });

  it("restores a pre-existing robots tag value on unmount instead of removing it", async () => {
    const AdminGate = (await import("../pages/AdminGate")).default;

    const existing = document.createElement("meta");
    existing.setAttribute("name", "robots");
    existing.setAttribute("content", "index, follow");
    document.head.appendChild(existing);

    let unmount!: () => void;
    act(() => {
      const result = render(<AdminGate />);
      unmount = result.unmount;
    });

    expect(getMeta("name", "robots")).toBe("noindex, nofollow");

    act(() => {
      unmount();
    });

    expect(getMeta("name", "robots")).toBe("index, follow");
  });
});

describe("robots.txt", () => {
  const robotsPath = path.resolve(
    import.meta.dirname,
    "../../public/robots.txt",
  );
  const robotsText = readFileSync(robotsPath, "utf-8");

  it("disallows /sc-portal", () => {
    expect(robotsText).toMatch(/Disallow:\s*\/sc-portal/);
  });

  it("allows / for all user-agents", () => {
    expect(robotsText).toMatch(/User-agent:\s*\*/);
    expect(robotsText).toMatch(/Allow:\s*\//);
  });

  it("references the canonical sitemap URL", () => {
    expect(robotsText).toContain(
      "Sitemap: https://absustaininvest.com/sitemap.xml",
    );
  });
});

describe("sitemap.xml", () => {
  const sitemapPath = path.resolve(
    import.meta.dirname,
    "../../public/sitemap.xml",
  );
  const sitemapText = readFileSync(sitemapPath, "utf-8");

  it("does not include /sc-portal", () => {
    expect(sitemapText).not.toContain("/sc-portal");
  });

  it("contains all expected public page URLs", () => {
    const expectedUrls = [
      "https://absustaininvest.com/",
      "https://absustaininvest.com/ventures",
      "https://absustaininvest.com/about",
      "https://absustaininvest.com/investors",
      "https://absustaininvest.com/contact",
      "https://absustaininvest.com/press",
      "https://absustaininvest.com/cashclip/privacy",
      "https://absustaininvest.com/cashclip/terms",
    ];
    for (const url of expectedUrls) {
      expect(sitemapText).toContain(url);
    }
  });

  it("uses only the canonical legal domain (no Replit subdomains)", () => {
    expect(sitemapText).not.toMatch(/replit\.app|repl\.co/);
  });
});
