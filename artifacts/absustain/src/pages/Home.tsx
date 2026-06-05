import { Link } from "wouter";
import { ArrowRight, ChevronRight, BarChart3, Building2, ShoppingCart, Smartphone, FileText } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";

export default function Home() {
  const { t } = useLang();
  const h = t.home;

  return (
    <>
      <Seo
        title="AB Sustainability Investments LLC — Building Enduring Enterprises"
        description="AB Sustainability Investments LLC is a diversified holding company building sustainable technology, retail, and food service ventures, including the CashClip rewards app and Solera Restaurant."
        path="/"
      />
      <section className="hero">
        <div className="hero-badge">
          <div className="dot" />
          {h.badge}
        </div>
        <h1>
          {h.hero.split("enduring").length > 1 ? (
            <>{h.hero.split("enduring")[0]}<em>enduring</em>{h.hero.split("enduring")[1]}</>
          ) : (
            <>{h.hero.split("durable")[0]}<em>durable</em>{h.hero.split("durable")[1]}</>
          )}
        </h1>
        <div className="hero-holdings">{h.sectors}</div>
        <p>{h.heroSub}</p>
        <div className="hero-tagline">{h.motto}</div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-2">
          <Link href="/ventures" className="hero-cta group" data-testid="btn-explore-ventures">
            {h.explorePortfolio} <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a href="https://cash-clip.app" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors text-sm font-medium" data-testid="btn-cashclip">
            <ArrowRight className="w-4 h-4" /> {h.cashclipBtn}
          </a>
        </div>
      </section>

      <section className="px-6 max-w-4xl mx-auto w-full -mt-4 mb-4">
        <a
          href="https://cash-clip.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-4 px-6 py-4 rounded-2xl bg-[#00E676]/[0.06] border border-[#00E676]/20 hover:bg-[#00E676]/[0.10] transition-colors group"
          data-testid="banner-appstore"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#00E676]/10 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-4 h-4 text-[#00E676]" />
            </div>
            <div>
              <span className="text-white font-semibold text-sm">{h.reviewBadge}</span>
              <span className="text-white/40 text-xs ml-2 hidden sm:inline">{h.reviewSub}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[#00E676] text-xs font-medium flex-shrink-0">
            {h.learnMore} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </a>
      </section>

      {/* Power of the Penny Banner */}
      <section className="px-6 max-w-4xl mx-auto w-full mb-8">
        <div className="rounded-2xl border border-[#7C3AED]/30 bg-[#4F46E5]/[0.06] px-8 py-7 text-center">
          <p className="text-[#7C3AED] text-xs font-bold tracking-widest uppercase mb-3">{h.founderLabel}</p>
          <blockquote className="font-['Space_Grotesk'] text-xl md:text-2xl font-bold text-white italic mb-3">
            {h.founderQuote}
          </blockquote>
          <p className="text-white/40 text-xs mb-4">{h.founderName}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-white/60">
              <span className="text-[#00E676] text-base">✓</span>
              {h.check1}
            </div>
            <div className="flex items-center gap-2 text-white/60">
              <span className="text-[#7C3AED] text-base">✓</span>
              {h.check2}
            </div>
            <div className="flex items-center gap-2 text-white/60">
              <span className="text-yellow-400 text-base">✓</span>
              {h.check3}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-label">{h.philLabel}</div>
        <h2>{h.philTitle.split("sustainable").length > 1 ? (
          <>{h.philTitle.split("sustainable")[0]}<em>sustainable</em>{h.philTitle.split("sustainable")[1]}</>
        ) : h.philTitle}</h2>
        <div className="section-sub">{h.philSub}</div>

        <div className="verticals-grid">
          <div className="vertical-card" data-testid="card-tech">
            <div className="card-icon bg-green-500/10 text-[#00E676]"><BarChart3 className="w-6 h-6" /></div>
            <h3>{h.tech}</h3>
            <div className="card-status status-live">{h.techStatus}</div>
            <p>{h.techDesc}</p>
            <a href="https://cash-clip.app" target="_blank" rel="noopener noreferrer" className="card-link" data-testid="link-cashclip-home">Visit cash-clip.app <ArrowRight className="w-4 h-4" /></a>
            <Link href="/ventures" className="card-link">View Tech Ventures <ChevronRight className="w-4 h-4" /></Link>
          </div>

          <div className="vertical-card" data-testid="card-retail">
            <div className="card-icon bg-yellow-500/10 text-yellow-500"><ShoppingCart className="w-6 h-6" /></div>
            <h3>{h.retail}</h3>
            <div className="card-status status-coming">{h.retailStatus}</div>
            <p>{h.retailDesc}</p>
            <Link href="/ventures" className="card-link">Learn More <ChevronRight className="w-4 h-4" /></Link>
          </div>

          <div className="vertical-card" data-testid="card-food">
            <div className="card-icon bg-yellow-500/10 text-yellow-500"><Building2 className="w-6 h-6" /></div>
            <h3>{h.food}</h3>
            <div className="card-status status-coming">{h.foodStatus}</div>
            <p>{h.foodDesc}</p>
            <Link href="/ventures" className="card-link">Learn More <ChevronRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      <section className="section about-section mb-20">
        <div className="section-label">{h.govLabel}</div>
        <h2>{h.govTitle.split("trust").length > 1 ? (
          <>{h.govTitle.split("trust")[0]}<em>trust</em>{h.govTitle.split("trust")[1]}</>
        ) : h.govTitle}</h2>
        <div className="company-info mt-12 mx-auto">
          <div className="company-name">AB Sustainability Investments LLC</div>
          <div className="company-type">Registered Holding Company</div>
          <div className="info-row">
            <span className="label">Structure</span>
            <span className="value">Limited Liability Company (LLC)</span>
          </div>
          <div className="info-row">
            <span className="label">EIN</span>
            <span className="value">39-2640135</span>
          </div>
          <div className="info-row">
            <span className="label">Certification</span>
            <span className="value">D-U-N-S Registered</span>
          </div>
          <div className="info-row">
            <span className="label">Core Sectors</span>
            <span className="value">Tech, Retail, Food Service</span>
          </div>
          <div className="info-row">
            <span className="label">Headquarters</span>
            <span className="value">Georgia, United States</span>
          </div>
        </div>
        <div className="mt-8 text-center">
          <Link href="/press" className="inline-flex items-center gap-2 text-[#00E676] text-sm hover:underline font-medium" data-testid="link-press-home">
            <FileText className="w-4 h-4" /> {h.pressLink}
          </Link>
        </div>
      </section>
    </>
  );
}
