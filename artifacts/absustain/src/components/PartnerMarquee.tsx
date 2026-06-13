type SinglePartner = {
  kind: "single";
  name: string;
  logo: string;
  fallback?: string;
};

type DualPartner = {
  kind: "dual";
  name: string;
  logo1: string;
  logo2: string;
  fallback1?: string;
  fallback2?: string;
};

type Partner = SinglePartner | DualPartner;

const cb  = (domain: string, size = 80) =>
  `https://logo.clearbit.com/${domain}?size=${size}`;
const fav = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const PARTNERS: Partner[] = [
  { kind: "single", name: "CPX Research",        logo: cb("cpx-research.com"),  fallback: fav("cpx-research.com") },
  { kind: "single", name: "Google AdMob",         logo: "/logos/admob.svg" },
  { kind: "single", name: "Zoho CRM",             logo: cb("zoho.com"),          fallback: "/logos/zoho.svg" },
  { kind: "single", name: "Google Play",          logo: "/logos/googleplay.svg" },
  { kind: "single", name: "Expo",                 logo: "/logos/expo-white.svg" },
  { kind: "single", name: "Replit",               logo: "/logos/replit.svg" },
  { kind: "single", name: "Apple",                logo: "/logos/apple-white.svg" },
  { kind: "single", name: "Unity",                logo: "/logos/unity-white.svg" },
  { kind: "dual",   name: "LevelPlay",            logo1: "/logos/unity-white.svg",  logo2: fav("ironsource.com") },
  { kind: "single", name: "Chartboost",           logo: cb("chartboost.com"),    fallback: fav("chartboost.com") },
  { kind: "dual",   name: "Chartboost · Unity",  logo1: cb("chartboost.com"),   logo2: "/logos/unity-white.svg",  fallback1: fav("chartboost.com") },
  { kind: "single", name: "Tapjoy",               logo: cb("tapjoy.com"),        fallback: fav("tapjoy.com") },
  { kind: "dual",   name: "Tapjoy · Unity",      logo1: cb("tapjoy.com"),       logo2: "/logos/unity-white.svg",  fallback1: fav("tapjoy.com") },
  { kind: "dual",   name: "HyperWallet · PayPal", logo1: fav("hyperwallet.com"), logo2: "/logos/paypal-light.svg" },
];

function Img({ src, fallback, alt, className }: { src: string; fallback?: string; alt: string; className: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
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
      <Img src={logo} fallback={fallback} alt={name} className="partner-logo" />
      <span className="partner-label">{name}</span>
    </div>
  );
}

function DualBadge({ name, logo1, logo2, fallback1, fallback2 }: DualPartner) {
  return (
    <div className="partner-badge partner-badge--dual">
      <div className="partner-dual-logos">
        <Img src={logo1} fallback={fallback1} alt={name} className="partner-logo-sm" />
        <div className="partner-dual-sep" />
        <Img src={logo2} fallback={fallback2} alt={name} className="partner-logo-sm" />
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
