import { useState } from "react";
import { Activity, CheckCircle, BarChart3, Zap, ArrowUpRight, Smartphone, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";
import { trackEvent } from "../lib/analytics";

export default function Investors() {
  const { t } = useLang();
  const seo = (
    <Seo
      title="Investor Relations | AB Sustainability Investments"
      description="Investor relations for AB Sustainability Investments LLC — explore the vision behind our sustainable venture portfolio and connect with our team directly."
      path="/investors"
      image={{ url: "https://absustaininvest.com/absustain/investors-og.jpg", width: 1200, height: 630 }}
    />
  );
  const [form, setForm] = useState({ name: "", email: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type: "investor", source: "website-investors" }),
      });
      if (!res.ok) throw new Error();
      trackEvent("lead_submit", { type: "investor" });
      setStatus("sent");
      setForm({ name: "", email: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="pt-32 pb-24 px-6 max-w-6xl mx-auto">
      {seo}

      {/* Hero */}
      <div className="text-center mb-20">
        <div className="section-label">{t.investors.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{t.investors.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">
          {t.investors.sub}
        </p>
      </div>

      {/* Ventures */}
      <div className="mb-16">
        <div className="text-center mb-10">
          <div className="section-label">{t.investors.portfolioLabel}</div>
          <h2 className="font-['Space_Grotesk'] text-3xl md:text-4xl font-bold text-white mt-4">{t.investors.portfolioTitle}</h2>
          <p className="text-white/40 mt-3 max-w-xl mx-auto text-sm">{t.investors.portfolioSub}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {[
            { icon: <Smartphone className="w-5 h-5" />, name: "CashClip", color: "#00E676", sector: "Mobile AdTech", status: "Live", desc: "Users earn real cash from surveys, ads, games. PayPal withdrawals." },
            { icon: <UtensilsCrossed className="w-5 h-5" />, name: "Solera", color: "#D4A540", sector: "Hospitality", status: "Relocating", desc: "Modern restaurant concept — Lake Worth Beach, FL. Securing a new venue. Brand, menu, and team are ready." },
            { icon: <ShoppingBag className="w-5 h-5" />, name: "Online Retail", color: "#F59E0B", sector: "E-Commerce", status: "2026 Launch", desc: "Sustainable consumer goods — Amazon Business + Costco wholesale channels." },
          ].map((v) => (
            <div key={v.name} className="rounded-2xl p-7 bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-colors" style={{ borderColor: `${v.color}18` }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl" style={{ backgroundColor: `${v.color}15`, color: v.color }}>{v.icon}</div>
                <div>
                  <p className="font-['Space_Grotesk'] font-bold text-white text-lg">{v.name}</p>
                  <p className="text-white/30 text-xs">{v.sector}</p>
                </div>
                <div className="ml-auto">
                  <span className="text-xs font-bold font-['Space_Grotesk'] px-2 py-1 rounded-full" style={{ backgroundColor: `${v.color}15`, color: v.color }}>{v.status}</span>
                </div>
              </div>
              <p className="text-white/40 text-sm leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Investment thesis */}
      <div className="grid md:grid-cols-2 gap-10 mb-16">
        <div className="space-y-6">
          <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white">{t.investors.thesisTitle}</h2>
          <p className="text-white/50 leading-relaxed">{t.investors.thesisPara1}</p>
          <p className="text-white/50 leading-relaxed">{t.investors.thesisPara2}</p>
        </div>
        <div className="rounded-3xl bg-white/[0.02] border border-white/[0.06] p-8 space-y-6">
          <h3 className="font-['Space_Grotesk'] text-xl font-bold text-white border-b border-white/10 pb-4">{t.investors.whyNow}</h3>
          {[
            { icon: <Activity className="w-5 h-5" />, title: "Operational, not hypothetical", desc: "Full mobile app, API, database, admin dashboard, and corporate site — all live and running." },
            { icon: <Zap className="w-5 h-5" />, title: "Multiple revenue streams", desc: "AdTech, hospitality, and e-commerce — diversified from day one." },
            { icon: <BarChart3 className="w-5 h-5" />, title: "D-U-N-S Verified", desc: "Corporate structure, EIN, financial transparency — accountable from the start." },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-4">
              <div className="mt-0.5 text-[#00E676] flex-shrink-0">{item.icon}</div>
              <div>
                <p className="text-white font-semibold text-sm mb-1">{item.title}</p>
                <p className="text-white/40 text-sm">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-3xl bg-[#00E676]/[0.03] border border-[#00E676]/20 p-12 text-center">
        <h3 className="font-serif italic font-bold text-4xl text-white mb-3">{t.investors.ctaTitle}</h3>
        <p className="text-white/40 mb-2 max-w-xl mx-auto">{t.investors.ctaSub}</p>
        <p className="text-[#00E676] font-['Space_Grotesk'] font-bold text-sm mb-8 italic">{t.investors.ctaQuote}</p>

        {status === "sent" ? (
          <div className="flex flex-col items-center py-4" data-testid="investor-success">
            <CheckCircle className="w-10 h-10 text-[#00E676] mb-3" />
            <p className="text-white font-semibold mb-1">{t.investors.ctaSuccess}</p>
            <p className="text-white/50 text-sm">{t.investors.ctaSuccessSub}</p>
            <button onClick={() => setStatus("idle")} className="mt-4 text-[#00E676] text-sm hover:underline">{t.investors.ctaAnother}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4" data-testid="investor-form">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors text-center"
              placeholder={t.investors.namePlaceholder}
            />
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors text-center"
              placeholder={t.investors.emailPlaceholder}
            />
            {status === "error" && <p className="text-red-400 text-sm">{t.investors.errorMsg}</p>}
            <button type="submit" disabled={status === "sending"} className="hero-cta inline-flex items-center gap-2">
              {status === "sending" ? t.investors.sending : <>{t.investors.submitBtn} <ArrowUpRight className="w-4 h-4" /></>}
            </button>
          </form>
        )}
        <p className="text-white/20 text-xs mt-6">Or email directly: <a href="mailto:supportpr@absustaininvest.com" className="text-[#00E676] hover:underline">supportpr@absustaininvest.com</a></p>
      </div>
    </div>
  );
}
