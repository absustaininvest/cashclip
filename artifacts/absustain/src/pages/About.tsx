import { ShieldCheck, Target, Zap } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";

export default function About() {
  const { t } = useLang();
  const a = t.about;

  return (
    <div className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
      <Seo
        title="About | AB Sustainability Investments"
        description="Learn about AB Sustainability Investments LLC — a diversified holding company founded by Jorge Ballen that builds, operates, and invests in sustainable business models for long-term value."
        path="/about"
      />

      {/* Hero */}
      <div className="text-center mb-20">
        <div className="section-label">{a.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{a.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">{a.sub}</p>
      </div>

      {/* Motto strip */}
      <div className="flex items-center justify-center gap-0 mb-20 overflow-hidden rounded-2xl border border-[#00E676]/20">
        {["BUILD", "GROW", "SUSTAIN", "SUCCEED"].map((word, i) => (
          <div
            key={word}
            className="flex-1 text-center py-5 border-r border-[#00E676]/10 last:border-r-0"
            style={{ background: `rgba(0,230,118,${0.03 + i * 0.02})` }}
          >
            <span className="text-[#00E676] font-['Space_Grotesk'] font-bold text-sm md:text-base tracking-[0.15em]">
              {word}
            </span>
          </div>
        ))}
      </div>

      {/* Jorge's words */}
      <div className="prose prose-invert prose-lg mx-auto mb-24">
        <p className="lead text-white font-medium text-xl border-l-2 border-[#00E676] pl-6 py-2 mb-8 italic">
          {a.quote}
        </p>
        <p className="text-white/70 text-lg leading-relaxed mb-6">{a.p1}</p>
        <p className="text-white/60 leading-relaxed mb-6">{a.p2}</p>
        <p className="text-white/50 leading-relaxed">{a.p3}</p>
      </div>

      {/* Value cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-24">
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 text-center hover:bg-white/[0.04] transition-colors">
          <Target className="w-10 h-10 text-[#00E676] mx-auto mb-6" />
          <h3 className="font-['Space_Grotesk'] text-xl font-bold text-white mb-3">{a.missionTitle}</h3>
          <p className="text-white/50 text-sm leading-relaxed">{a.missionDesc}</p>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 text-center hover:bg-white/[0.04] transition-colors">
          <ShieldCheck className="w-10 h-10 text-[#00E676] mx-auto mb-6" />
          <h3 className="font-['Space_Grotesk'] text-xl font-bold text-white mb-3">{a.govTitle}</h3>
          <p className="text-white/50 text-sm leading-relaxed">{a.govDesc}</p>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 text-center hover:bg-white/[0.04] transition-colors">
          <Zap className="w-10 h-10 text-[#00E676] mx-auto mb-6" />
          <h3 className="font-['Space_Grotesk'] text-xl font-bold text-white mb-3">{a.execTitle}</h3>
          <p className="text-white/50 text-sm leading-relaxed">{a.execDesc}</p>
        </div>
      </div>

      {/* Founder note */}
      <div className="relative rounded-2xl border border-[#00E676]/20 bg-white/[0.02] p-8 mb-24">
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl bg-[#00E676]" />
        <p className="text-white/40 text-xs font-['Space_Grotesk'] tracking-widest uppercase mb-4 pl-4">
          {a.founderLabel}
        </p>
        <p className="text-white/80 text-lg leading-relaxed italic pl-4">{a.founderQuote}</p>
        <p className="text-[#00E676] font-['Space_Grotesk'] font-bold text-sm mt-4 pl-4">{a.founderName}</p>
      </div>

      {/* Corporate details */}
      <div className="company-info mx-auto">
        <div className="company-name text-center mb-6">{a.detailsTitle}</div>
        <div className="info-row">
          <span className="label">Entity Name</span>
          <span className="value">AB Sustainability Investments LLC</span>
        </div>
        <div className="info-row">
          <span className="label">Structure</span>
          <span className="value">Holding Company (LLC)</span>
        </div>
        <div className="info-row">
          <span className="label">EIN</span>
          <span className="value">39-2640135</span>
        </div>
        <div className="info-row">
          <span className="label">Incorporated</span>
          <span className="value">Georgia, United States</span>
        </div>
        <div className="info-row">
          <span className="label">Verification</span>
          <span className="value text-[#00E676]">D-U-N-S Certified</span>
        </div>
        <div className="info-row">
          <span className="label">Primary Domain</span>
          <span className="value"><a href="https://absustaininvest.com">absustaininvest.com</a></span>
        </div>
        <div className="info-row">
          <span className="label">App Domain</span>
          <span className="value"><a href="https://cash-clip.app">cash-clip.app</a></span>
        </div>
      </div>
    </div>
  );
}
