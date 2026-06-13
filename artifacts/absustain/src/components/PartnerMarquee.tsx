type SinglePartner = {
  kind: "single";
  name: string;
  label?: string;
  logo: string;
  bg?: string;
};

type DualPartner = {
  kind: "dual";
  name: string;
  logo1: string;
  logo2: string;
};

type Partner = SinglePartner | DualPartner;

const fav = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const PARTNERS: Partner[] = [
  { kind: "single", name: "CPX Research",   logo: fav("cpx-research.com") },
  { kind: "single", name: "Google AdMob",   logo: "/logos/admob.svg" },
  { kind: "single", name: "Zoho CRM",       logo: "/logos/zoho.svg" },
  { kind: "single", name: "Google Play",    logo: "/logos/googleplay.svg" },
  { kind: "single", name: "Expo",           logo: "/logos/expo.svg",        bg: "#000" },
  { kind: "single", name: "Replit",         logo: "/logos/replit.svg" },
  { kind: "single", name: "Apple",          logo: "/logos/apple.svg",       bg: "#000" },
  { kind: "single", name: "Unity",          logo: "/logos/unity.svg",       bg: "#000" },
  { kind: "dual",   name: "LevelPlay",      logo1: "/logos/unity.svg",      logo2: fav("ironsource.com") },
  { kind: "single", name: "Tapjoy",         logo: fav("tapjoy.com") },
  { kind: "dual",   name: "Tapjoy · Unity", logo1: fav("tapjoy.com"),       logo2: "/logos/unity.svg" },
  { kind: "single", name: "PayPal",         logo: "/logos/paypal.svg" },
  { kind: "dual",   name: "HyperWallet",    logo1: fav("hyperwallet.com"),  logo2: "/logos/paypal.svg" },
];

function SingleBadge({ name, logo, bg }: SinglePartner) {
  return (
    <div className="partner-badge" style={bg ? { background: bg } : undefined}>
      <img
        src={logo}
        alt={name}
        className="partner-logo"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
      />
      <span className="partner-label">{name}</span>
    </div>
  );
}

function DualBadge({ name, logo1, logo2 }: DualPartner) {
  return (
    <div className="partner-badge partner-badge--dual">
      <div className="partner-dual-logos">
        <img src={logo1} alt={name} className="partner-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
        <div className="partner-dual-sep" />
        <img src={logo2} alt={name} className="partner-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
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
