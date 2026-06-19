import { ArrowUpRight, ShoppingBag, UtensilsCrossed, Link2, ExternalLink, Monitor } from "lucide-react";
import { Link } from "wouter";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";

export default function Ventures() {
  const { t } = useLang();
  return (
    <div className="pt-32 pb-24 px-6 max-w-6xl mx-auto">
      <Seo
        title="Ventures & Portfolio | AB Sustainability Investments"
        description="Explore the AB Sustainability Investments portfolio across technology, retail, and food service — including the CashClip mobile rewards app and Solera Restaurant."
        path="/ventures"
        image={{ url: "https://absustaininvest.com/absustain/ab-logo.jpeg", width: 1320, height: 757 }}
      />
      <div className="text-center mb-20">
        <div className="section-label">{t.ventures.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{t.ventures.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">
          {t.ventures.sub}
        </p>
      </div>

      <div className="space-y-32">
        {/* Venture 1 — CashClip */}
        <div className="flex flex-col md:flex-row gap-12 items-center" data-testid="venture-cashclip">
          <div className="flex-1 w-full relative">
            <div className="aspect-[4/3] rounded-3xl bg-gradient-to-br from-[#00E676]/20 to-[#06060E] border border-white/5 flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[#00E676]/5 group-hover:bg-[#00E676]/10 transition-colors" />
              <div className="absolute inset-0 flex items-center justify-center p-10">
                <img
                  src={`${import.meta.env.BASE_URL}cashclip-logo.png`}
                  alt="CashClip"
                  className="w-full max-w-[220px] object-contain rounded-[28px] shadow-2xl opacity-95 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                />
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-6">
            <div className="card-status status-live mb-0 inline-block">{t.ventures.flagship}</div>
            <h2 className="font-['Space_Grotesk'] text-4xl font-bold text-white tracking-tight">CashClip</h2>
            <p className="text-white/50 text-lg leading-relaxed">
              {t.ventures.cashclipDesc}
            </p>
            <ul className="space-y-4 py-4 border-y border-white/10">
              <li className="flex justify-between items-center text-white/70">
                <span>{t.ventures.sector}</span>
                <span className="font-semibold text-white">Mobile Technology / AdTech</span>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>{t.ventures.status}</span>
                <span className="font-semibold text-[#00E676]">Live on the App Store</span>
              </li>
            </ul>
            <a href="https://apps.apple.com/app/id6759931285" target="_blank" rel="noopener noreferrer" className="hero-cta !text-sm !py-3 !px-6" data-testid="link-cashclip">
              Get it on the App Store <ArrowUpRight className="w-4 h-4 ml-1" />
            </a>
            <div className="flex flex-wrap gap-3 mt-2">
              <a
                href="https://apps.apple.com/app/id6759931285"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 bg-black border border-white/10 hover:border-white/30 text-white rounded-xl px-5 py-2.5 transition-colors"
                data-testid="badge-appstore"
              >
                <svg width="18" height="22" viewBox="0 0 814 1000" fill="white" xmlns="http://www.w3.org/2000/svg">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-150.3-91.9C80.5 786.8 0 643.7 0 508.2c0-225.1 147.2-344.2 292.1-344.2 73.9 0 135.5 48.7 182 48.7 44.4 0 114.4-52.9 198.3-52.9 31.9 0 108.2 2.9 166.3 78.2zm-61.6-156.5c-28.5-32.4-76.9-57-122.5-57-5.8 0-11.6.6-17.4 1.6 1.3 6.5 2.3 13.6 2.3 21.4 0 42.2-16.1 86.4-48 117.9-28.5 28.2-70.3 49.4-110.8 49.4-2.9 0-5.8-.3-8.7-.6 0-1.3-.3-2.6-.3-4.2 0-39.5 17.4-82.7 47-114.8 30.3-32.7 85.5-58.4 134.5-62.2 0-5.1-.3-10.3-.3-15.4 0-37.2 8.7-76 29.8-109.1 25.4-40.5 68.7-71.6 116.4-83.2 6.1 21.4 9.3 43.7 9.3 66 0 42.5-11.3 83.7-33.3 117.9z"/>
                </svg>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-[9px] uppercase tracking-widest text-white/60 font-normal">Download on the</span>
                  <span className="text-[15px] font-bold tracking-tight">App Store</span>
                </span>
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=app.replit.cashclip"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 bg-black border border-white/10 hover:border-white/30 text-white rounded-xl px-5 py-2.5 transition-colors"
                data-testid="badge-googleplay"
              >
                <svg width="18" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l2.4 1.4 247.2-247v-5.8L47 0zm425.6 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c17.1-9.8 17.1-25.9 0-35.3l-1.2-.5zm-185.7 29l-247.2 247 283.2-162.5 65.7-64.5-101.7-20z" fill="white"/>
                </svg>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-[9px] uppercase tracking-widest text-white/60 font-normal">Get it on</span>
                  <span className="text-[15px] font-bold tracking-tight">Google Play</span>
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Venture 2 — Online Retail */}
        <div className="flex flex-col md:flex-row-reverse gap-12 items-center" data-testid="venture-retail">
          <div className="flex-1 w-full relative">
            <div className="aspect-[4/3] rounded-3xl bg-gradient-to-bl from-yellow-500/10 to-[#06060E] border border-white/5 flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-yellow-500/5 group-hover:bg-yellow-500/10 transition-colors" />
              <ShoppingBag className="w-24 h-24 text-yellow-500 opacity-60 group-hover:scale-110 transition-transform duration-500" />
            </div>
          </div>
          <div className="flex-1 space-y-6">
            <div className="card-status status-coming mb-0 inline-block">In Development</div>
            <h2 className="font-['Space_Grotesk'] text-4xl font-bold text-white tracking-tight">Online Retail Division</h2>
            <p className="text-white/50 text-lg leading-relaxed">
              A comprehensive e-commerce strategy focusing on sustainable consumer goods. This venture integrates advanced supply chain logistics with a premium direct-to-consumer experience.
            </p>
            <ul className="space-y-4 py-4 border-y border-white/10">
              <li className="flex justify-between items-center text-white/70">
                <span>Sector</span>
                <span className="font-semibold text-white">E-Commerce / Retail</span>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>Status</span>
                <span className="font-semibold text-yellow-500">2026 Launch</span>
              </li>
            </ul>
            <button disabled className="opacity-50 cursor-not-allowed bg-white/10 text-white py-3 px-6 rounded-full font-['Space_Grotesk'] font-bold text-sm">
              Coming Soon
            </button>
          </div>
        </div>

        {/* Venture 3 — Solera */}
        <div className="flex flex-col md:flex-row gap-12 items-center" data-testid="venture-food">
          <div className="flex-1 w-full relative">
            <div className="aspect-[4/3] rounded-3xl bg-gradient-to-br from-[#1A0D08] via-[#0F0A07] to-[#06060E] border border-[#8B4A35]/20 flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[#8B4A35]/[0.03] group-hover:bg-[#8B4A35]/[0.06] transition-colors" />
              <div className="absolute inset-0 flex items-center justify-center p-10">
                <img
                  src={`${import.meta.env.BASE_URL}solera-logo.jpeg`}
                  alt="Solera Restaurant"
                  className="w-full max-w-[300px] object-contain rounded-2xl opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                />
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-6">
            <div className="card-status status-coming mb-0 inline-block">Concept Stage</div>
            <h2 className="font-['Space_Grotesk'] text-4xl font-bold text-white tracking-tight">Solera</h2>
            <p className="text-[#D4A540]/80 font-serif italic text-lg tracking-wide">Aged in Tradition. Served with Soul.</p>
            <p className="text-white/50 text-lg leading-relaxed">
              A modern restaurant concept rooted in hospitality and quality. Solera draws its name from the traditional aging method — blending the best of what came before with the innovation of what's next. Every detail is designed to deliver an experience that feels both timeless and fresh.
            </p>
            <ul className="space-y-4 py-4 border-y border-white/10">
              <li className="flex justify-between items-center text-white/70">
                <span>Sector</span>
                <span className="font-semibold text-white">Hospitality / Food Service</span>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>Location</span>
                <span className="font-semibold text-white">Lake Worth Beach, FL / Greater Palm Beach Area</span>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>Status</span>
                <span className="font-semibold text-[#D4A540]">Relocating — New Venue Being Secured</span>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>Domain</span>
                <a
                  href="https://solera-restaurant.absustaininvest.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 font-semibold text-[#8B4A35] hover:text-[#A0522D] transition-colors text-sm"
                >
                  solera-restaurant.absustaininvest.com
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </li>
              <li className="flex justify-between items-center text-white/70">
                <span>Partnership Inquiries</span>
                <a href="mailto:supportpr@absustaininvest.com" className="font-semibold text-[#8B4A35] hover:underline text-sm">
                  supportpr@absustaininvest.com
                </a>
              </li>
            </ul>
            {/* Signature dishes */}
            <div className="rounded-2xl border border-[#8B4A35]/20 bg-[#8B4A35]/5 p-5 space-y-3">
              <p className="text-[#D4A540] font-['Space_Grotesk'] font-bold text-xs tracking-widest uppercase">A Few of Our Favorites</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { name: "Cordon Bleu", icon: "🍗" },
                  { name: "Coastal Cobb", icon: "🥗" },
                  { name: "Lentil Soup", icon: "🍲" },
                ].map((dish) => (
                  <div key={dish.name} className="text-center p-3 rounded-xl bg-[#8B4A35]/10 border border-[#8B4A35]/15">
                    <div className="text-2xl mb-1">{dish.icon}</div>
                    <p className="text-white/80 text-xs font-semibold">{dish.name}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-[#D4A540]/30 bg-[#D4A540]/5 text-[#D4A540] text-sm font-medium">
                <UtensilsCrossed className="w-4 h-4" />
                Relocating — New Venue in Progress
              </div>
              <a
                href="/ventures/solera"
                className="flex items-center gap-2 border border-[#8B4A35]/40 hover:border-[#D4A540]/40 text-[#D4A540] py-3 px-6 rounded-full font-['Space_Grotesk'] font-bold text-sm transition-colors"
              >
                Full Story <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>

          </div>
        </div>
      </div>

      {/* Founder Philosophy */}
      <div className="mt-32 pt-16 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative inline-block">
            <span className="text-7xl font-bold text-[#7C3AED] leading-none select-none absolute -top-4 -left-4 opacity-60">"</span>
            <blockquote className="font-['Space_Grotesk'] text-2xl md:text-3xl font-bold text-white italic leading-relaxed px-8 pt-4">
              Don't you ever underestimate the power of the penny.
            </blockquote>
            <span className="text-7xl font-bold text-[#7C3AED] leading-none select-none absolute -bottom-8 -right-4 opacity-60">"</span>
          </div>
          <p className="mt-4 text-[#7C3AED] font-semibold text-sm tracking-widest uppercase">— Jorge Ballen, Founder & CEO</p>
          <p className="mt-4 text-white/40 text-sm max-w-xl mx-auto">
            The founding principle behind CashClip's investment vision — every small earning, compounded over time, has the power to change a life.
          </p>
        </div>
      </div>

      {/* Partner Ecosystem */}
      <div className="mt-20 pt-16 border-t border-white/[0.06]">
        <div className="text-center mb-12">
          <div className="section-label">Partner Ecosystem</div>
          <h2 className="font-['Space_Grotesk'] text-3xl md:text-4xl font-bold text-white mt-4 mb-4">Survey & Offerwall Network</h2>
          <p className="text-white/40 max-w-2xl mx-auto text-sm">
            CashClip connects users to a curated network of premium survey and engagement providers, maximizing earning opportunities across 175+ countries.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[
            { name: "Google AdMob", type: "Ads", status: "Active" },
            { name: "Unity Ads", type: "Ads", status: "Active" },
            { name: "CPX Research", type: "Surveys", status: "Active" },
            { name: "BitLabs", type: "Surveys", status: "Active" },
            { name: "AdGem", type: "Offerwall", status: "Active" },
            { name: "Pollfish", type: "Surveys", status: "Integrated" },
            { name: "Lucid", type: "Surveys", status: "Integrated" },
            { name: "Cint", type: "Surveys", status: "Integrated" },
            { name: "InBrain", type: "Surveys", status: "In Contact" },
            { name: "AdGate Media", type: "Offerwall", status: "Integrated" },
            { name: "OfferToro", type: "Offerwall", status: "Integrated" },
            { name: "Tapjoy", type: "Offerwall", status: "Integrated" },
            { name: "Fyber", type: "Offerwall", status: "In Contact" },
          ].map(({ name, type, status }) => (
            <div key={name} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="w-3.5 h-3.5 text-[#00E676] flex-shrink-0" />
                <span className="text-white text-sm font-semibold leading-tight">{name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/30 text-xs">{type}</span>
                <span className={`text-xs font-medium ${status === "Active" ? "text-[#00E676]" : status === "Integrated" ? "text-blue-400" : "text-yellow-500"}`}>
                  {status}
                </span>
              </div>
            </div>
          ))}
          <Link href="/sc-portal">
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-colors cursor-pointer">
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="w-3.5 h-3.5 text-[#00E676] flex-shrink-0" />
                <span className="text-white text-sm font-semibold leading-tight">Dynata</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/30 text-xs">Surveys</span>
                <span className="text-xs font-medium text-yellow-500">In Contact</span>
              </div>
            </div>
          </Link>
        </div>
        <p className="text-center text-white/30 text-xs mt-6">
          For partnership inquiries: <a href="mailto:supportpr@absustaininvest.com" className="text-[#00E676] hover:underline">supportpr@absustaininvest.com</a>
        </p>
      </div>
    </div>
  );
}
