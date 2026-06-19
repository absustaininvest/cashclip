const fav = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

type SinglePartner = { kind: "single"; name: string; logo: string; fallback?: string };
type DualPartner   = { kind: "dual";   name: string; logo1: string; logo2: string; fallback1?: string; fallback2?: string };
type Partner = SinglePartner | DualPartner;

const PARTNERS: Partner[] = [
  { kind: "single", name: "CPX Research",          logo: "/logos/partner-cpx.png" },
  { kind: "single", name: "Google AdMob",           logo: "/logos/partner-admob.jpeg" },
  { kind: "single", name: "Replit",                 logo: "/logos/partner-replit.png" },
  { kind: "single", name: "Zoho CRM",               logo: "/logos/partner-zoho.png" },
  { kind: "single", name: "BitLabs",                logo: fav("bitlabs.ai") },
  { kind: "single", name: "Google Play",            logo: "/logos/partner-googleplay.png" },
  { kind: "single", name: "Apple",                  logo: "/logos/partner-apple.png" },
  { kind: "single", name: "Unity",                  logo: "/logos/partner-unity.png" },
  { kind: "single", name: "LevelPlay",              logo: "/logos/partner-unity-ironsource.png" },
  { kind: "single", name: "Chartboost",             logo: fav("chartboost.com") },
  { kind: "single", name: "Tapjoy · Unity",          logo: "/logos/partner-tapjoy-unity.png" },
  { kind: "single", name: "HyperWallet · PayPal",  logo: "/logos/partner-hyperwallet.jpeg" },
  { kind: "single", name: "Expo",                   logo: "/logos/expo-white.svg" },
];

function Img({ src, fallback, alt, cls }: { src: string; fallback?: string; alt: string; cls: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className={cls}
      onError={(e) => {
        const img = e.currentTarget as HTMLImageElement;
        if (fallback && img.src !== fallback) { img.src = fallback; }
        else { img.style.opacity = "0"; }
      }}
    />
  );
}

function SingleBadge({ name, logo, fallback }: SinglePartner) {
  return (
    <div className="partner-badge">
      <Img src={logo} fallback={fallback} alt={name} cls="partner-logo" />
      <span className="partner-label">{name}</span>
    </div>
  );
}

function DualBadge({ name, logo1, logo2, fallback1, fallback2 }: DualPartner) {
  return (
    <div className="partner-badge partner-badge--dual">
      <div className="partner-dual-logos">
        <Img src={logo1} fallback={fallback1} alt={name} cls="partner-logo-sm" />
        <div className="partner-dual-sep" />
        <Img src={logo2} fallback={fallback2} alt={name} cls="partner-logo-sm" />
      </div>
      <span className="partner-label">{name}</span>
    </div>
  );
}

export function PartnerMarquee() {
  return (
    <div className="marquee-track-outer" aria-label="Technology and platform partners">
      <p className="marquee-heading">TECHNOLOGY &amp; PLATFORM PARTNERS</p>
      <div className="marquee-fade-left" />
      <div className="marquee-track">
        <div className="marquee-inner">
          {PARTNERS.map((p) =>
            p.kind === "dual"
              ? <DualBadge key={p.name + "a"} {...p} />
              : <SingleBadge key={p.name + "a"} {...p} />
          )}
          {PARTNERS.map((p) =>
            p.kind === "dual"
              ? <DualBadge key={p.name + "b"} {...p} />
              : <SingleBadge key={p.name + "b"} {...p} />
          )}
        </div>
      </div>
      <div className="marquee-fade-right" />
    </div>
  );
}
