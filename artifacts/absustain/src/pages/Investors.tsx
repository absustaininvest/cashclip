import { useState } from "react";
import { TrendingUp, PieChart, Activity, CheckCircle, DollarSign, BarChart3, Zap, ArrowUpRight, Monitor, Smartphone, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";
import { trackEvent } from "../lib/analytics";

const PRE_MONEY = 1_000_000;
const ROUND_2_VALUATION = 2_500_000;

function calcEquity(investment: number) {
  return ((investment / (PRE_MONEY + investment)) * 100).toFixed(2);
}

function calcRound2Value(investment: number) {
  const pct = investment / (PRE_MONEY + investment);
  return Math.round(pct * ROUND_2_VALUATION);
}

function calcMultiple(investment: number) {
  return (calcRound2Value(investment) / investment).toFixed(1);
}

export default function Investors() {
  const { t } = useLang();
  const seo = (
    <Seo
      title="Investor Relations | AB Sustainability Investments"
      description="Investor relations for AB Sustainability Investments LLC — explore investment opportunities, equity details, and the growth strategy behind our sustainable venture portfolio."
      path="/investors"
      image={{ url: "https://absustaininvest.com/absustain/investors-og.jpg", width: 1200, height: 630 }}
    />
  );
  const [form, setForm] = useState({ name: "", email: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [customAmount, setCustomAmount] = useState(100000);

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

  const tiers = [
    { amount: 25000, label: "Angel Entry" },
    { amount: 50000, label: "Seed Angel" },
    { amount: 100000, label: "Lead Angel" },
    { amount: 150000, label: "Strategic Partner" },
    { amount: 250000, label: "Major Investor" },
  ];

  const milestones = [
    { label: "Today — Seed Round", value: "$1,000,000", color: "#00E676", note: "Pre-money valuation at close" },
    { label: "CashClip 500+ users + documented ad revenue", value: "+$500,000", color: "#00E676", note: "App Store growth + first AdTech receipts" },
    { label: "Solera venue secured + first monthly revenue", value: "+$500,000", color: "#D4A540", note: "Restaurant concept reopens; recurring revenue documented" },
    { label: "Online Retail channel live (Amazon / Costco)", value: "+$500,000", color: "#F59E0B", note: "First SKUs selling; e-commerce revenue confirmed" },
    { label: "Round 2 Valuation", value: "$2,500,000", color: "#00E676", note: "90 days from funding — 2.5× today's entry price" },
  ];

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

      {/* Valuation + raise */}
      <div className="grid md:grid-cols-2 gap-5 mb-16">
        <div className="rounded-3xl bg-gradient-to-br from-[#00E676]/10 to-[#06060E] border border-[#00E676]/20 p-10 flex flex-col justify-center">
          <p className="text-[#00E676] font-['Space_Grotesk'] font-bold text-xs tracking-widest uppercase mb-3">{t.investors.preMoneyLabel}</p>
          <p className="font-['Space_Grotesk'] font-bold text-5xl text-white mb-2">$1,000,000</p>
          <p className="text-white/40 text-sm leading-relaxed">Based on replacement cost of built assets (~$350K), live product, and validated business model across four verticals.</p>
        </div>
        <div className="rounded-3xl bg-gradient-to-br from-[#4F46E5]/10 to-[#06060E] border border-[#4F46E5]/20 p-10 flex flex-col justify-center">
          <p className="text-[#818CF8] font-['Space_Grotesk'] font-bold text-xs tracking-widest uppercase mb-3">{t.investors.raiseLabel}</p>
          <p className="font-['Space_Grotesk'] font-bold text-5xl text-white mb-2">$250,000</p>
          <p className="text-white/40 text-sm leading-relaxed">Equity model — proportional stake based on investment amount. No bluffs. Every dollar allocated with measurable milestones.</p>
        </div>
      </div>

      {/* Equity calculator */}
      <div className="mb-16 rounded-3xl bg-white/[0.02] border border-white/[0.06] p-10">
        <div className="flex items-center gap-3 mb-8">
          <PieChart className="w-5 h-5 text-[#00E676]" />
          <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white">{t.investors.equityTitle}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase pb-4 pr-6">{t.investors.investment}</th>
                <th className="text-left text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase pb-4 pr-6">{t.investors.equityStake}</th>
                <th className="text-left text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase pb-4 pr-6">{t.investors.investorType}</th>
                <th className="text-left text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase pb-4">{t.investors.postMoneyValue}</th>
                <th className="text-left text-white/30 text-xs font-bold font-['Space_Grotesk'] tracking-widest uppercase pb-4 pl-6 hidden md:table-cell">Value @ Round 2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {tiers.map((tier) => (
                <tr key={tier.amount} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 pr-6">
                    <span className="font-['Space_Grotesk'] font-bold text-xl text-white">${tier.amount.toLocaleString()}</span>
                  </td>
                  <td className="py-4 pr-6">
                    <span className="font-['Space_Grotesk'] font-bold text-xl text-[#00E676]">{calcEquity(tier.amount)}%</span>
                  </td>
                  <td className="py-4 pr-6">
                    <span className="text-white/50 text-sm">{tier.label}</span>
                  </td>
                  <td className="py-4">
                    <span className="text-white/40 text-sm">${(PRE_MONEY + tier.amount).toLocaleString()}</span>
                  </td>
                  <td className="py-4 pl-6 hidden md:table-cell">
                    <div>
                      <span className="font-['Space_Grotesk'] font-bold text-sm text-[#00E676]">${calcRound2Value(tier.amount).toLocaleString()}</span>
                      <span className="text-white/30 text-xs ml-1.5">{calcMultiple(tier.amount)}×</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Custom calculator */}
        <div className="mt-8 pt-8 border-t border-white/[0.06]">
          <p className="text-white/40 text-sm font-['Space_Grotesk'] font-bold uppercase tracking-widest mb-4">{t.investors.customCalc}</p>
          <div className="flex flex-col md:flex-row gap-6 items-center">
            <div className="flex-1 w-full">
              <input
                type="range"
                min={10000}
                max={500000}
                step={5000}
                value={customAmount}
                onChange={(e) => setCustomAmount(Number(e.target.value))}
                className="w-full accent-[#00E676]"
              />
              <div className="flex justify-between text-white/20 text-xs mt-1">
                <span>$10K</span><span>$500K</span>
              </div>
            </div>
            <div className="flex gap-6 flex-shrink-0 flex-wrap justify-center">
              <div className="text-center">
                <p className="text-white/30 text-xs mb-1 font-['Space_Grotesk'] uppercase tracking-widest">{t.investors.youInvest}</p>
                <p className="font-['Space_Grotesk'] font-bold text-2xl text-white">${customAmount.toLocaleString()}</p>
              </div>
              <div className="text-center">
                <p className="text-white/30 text-xs mb-1 font-['Space_Grotesk'] uppercase tracking-widest">{t.investors.youGet}</p>
                <p className="font-['Space_Grotesk'] font-bold text-2xl text-[#00E676]">{calcEquity(customAmount)}%</p>
              </div>
              <div className="text-center">
                <p className="text-white/30 text-xs mb-1 font-['Space_Grotesk'] uppercase tracking-widest">{t.investors.postMoney}</p>
                <p className="font-['Space_Grotesk'] font-bold text-2xl text-white/60">${(PRE_MONEY + customAmount).toLocaleString()}</p>
              </div>
              <div className="text-center border-l border-white/10 pl-6">
                <p className="text-white/30 text-xs mb-1 font-['Space_Grotesk'] uppercase tracking-widest">Value @ Round 2</p>
                <p className="font-['Space_Grotesk'] font-bold text-2xl text-[#00E676]">${calcRound2Value(customAmount).toLocaleString()}</p>
                <p className="text-white/30 text-xs mt-0.5">{calcMultiple(customAmount)}× return</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 90-day valuation path */}
      <div className="mb-16 rounded-3xl bg-white/[0.02] border border-white/[0.06] p-10">
        <div className="flex items-center gap-3 mb-8">
          <TrendingUp className="w-5 h-5 text-[#00E676]" />
          <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white">{t.investors.valuationTitle}</h2>
        </div>
        <p className="text-white/40 mb-8 text-sm leading-relaxed max-w-2xl">{t.investors.valuationSub}</p>
        <div className="space-y-4">
          {milestones.map((m, i) => (
            <div key={m.label} className="flex items-center gap-5">
              <div className="flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold font-['Space_Grotesk']" style={{ borderColor: m.color, color: m.color }}>
                {i + 1}
              </div>
              <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div>
                  <p className="text-white font-['Space_Grotesk'] font-bold text-sm">{m.label}</p>
                  <p className="text-white/30 text-xs mt-0.5">{m.note}</p>
                </div>
                <p className="font-['Space_Grotesk'] font-bold text-lg flex-shrink-0" style={{ color: m.color }}>{m.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Four ventures */}
      <div className="mb-16">
        <div className="text-center mb-10">
          <div className="section-label">{t.investors.portfolioLabel}</div>
          <h2 className="font-['Space_Grotesk'] text-3xl md:text-4xl font-bold text-white mt-4">{t.investors.portfolioTitle}</h2>
          <p className="text-white/40 mt-3 max-w-xl mx-auto text-sm">{t.investors.portfolioSub}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {[
            { icon: <Smartphone className="w-5 h-5" />, name: "CashClip", color: "#00E676", sector: "Mobile AdTech", status: "App Store Review", desc: "Users earn real cash from surveys, ads, games. PayPal withdrawals." },
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
            { icon: <TrendingUp className="w-5 h-5" />, title: "Preferred entry valuation", desc: "Valuation re-assessed at $2.5M following 90-day milestones. Today's $1M is the ground floor." },
            { icon: <Activity className="w-5 h-5" />, title: "Operational, not hypothetical", desc: "Full mobile app, API, database, admin dashboard, and corporate site — all live and running." },
            { icon: <Zap className="w-5 h-5" />, title: "Four revenue streams", desc: "AdTech, mobility media, hospitality, and e-commerce — diversified from day one." },
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

      {/* Use of funds */}
      <div className="mb-16 rounded-3xl bg-white/[0.02] border border-white/[0.06] p-10">
        <div className="flex items-center gap-3 mb-8">
          <DollarSign className="w-5 h-5 text-[#00E676]" />
          <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white">{t.investors.fundsTitle}</h2>
        </div>
        <div className="space-y-4">
          {[
            { color: "#00E676", pct: "50%", amt: "$125,000", label: "CashClip Growth", desc: "User acquisition, ASO, influencer partnerships — first 5,000 active users" },
            { color: "#D4A540", pct: "25%", amt: "$62,500", label: "Solera Expansion", desc: "New venue buildout, catering infrastructure, brand marketing" },
            { color: "#F59E0B", pct: "10%", amt: "$25,000", label: "Online Retail Launch", desc: "First SKU sourcing, Amazon Business + Costco wholesale setup" },
            { color: "#8A8A9A", pct: "10%", amt: "$25,000", label: "Operations & Legal", desc: "IP protection, contracts, accounting, corporate structure" },
            { color: "#6B7280", pct: "5%", amt: "$12,500", label: "Technology Reserve", desc: "Infrastructure, platform upkeep, and contingency buffer" },
          ].map((u) => (
            <div key={u.label} className="flex items-center gap-5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="w-12 text-center flex-shrink-0">
                <p className="font-['Space_Grotesk'] font-bold text-lg" style={{ color: u.color }}>{u.pct}</p>
              </div>
              <div className="flex-1">
                <p className="font-['Space_Grotesk'] font-bold text-white text-sm">{u.label} <span className="font-normal" style={{ color: u.color }}>— {u.amt}</span></p>
                <p className="text-white/30 text-xs mt-0.5">{u.desc}</p>
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
