const PARTNERS = [
  { name: "CPX Research",          domain: "cpx-research.com" },
  { name: "BitLabs",               domain: "bitlabs.ai" },
  { name: "Tapjoy",                domain: "tapjoy.com" },
  { name: "Unity Ads",             domain: "unity.com" },
  { name: "LevelPlay",             domain: "ironsource.com" },
  { name: "Chartboost",            domain: "chartboost.com" },
  { name: "Google Play",           domain: "play.google.com" },
  { name: "Apple App Store",       domain: "apple.com" },
  { name: "PayPal / HyperWallet",  domain: "hyperwallet.com" },
  { name: "Zoho CRM",              domain: "zoho.com" },
  { name: "Replit",                domain: "replit.com" },
];

function LogoBadge({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="marquee-badge">
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt={name}
        width={22}
        height={22}
        className="marquee-logo"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
      <span>{name}</span>
    </div>
  );
}

export function PartnerMarquee() {
  return (
    <div className="marquee-track-outer" aria-label="Technology and platform partners">
      <div className="marquee-fade-left" />
      <div className="marquee-track">
        <div className="marquee-inner">
          {PARTNERS.map((p) => <LogoBadge key={p.name + "a"} {...p} />)}
          {PARTNERS.map((p) => <LogoBadge key={p.name + "b"} {...p} />)}
        </div>
      </div>
      <div className="marquee-fade-right" />
    </div>
  );
}
