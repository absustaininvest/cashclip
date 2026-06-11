import { Mail, Globe, Briefcase, Smartphone, Users, BarChart3, Building2 } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";

export default function PressKit() {
  const { t } = useLang();
  return (
    <div className="pt-32 pb-24 px-6 max-w-5xl mx-auto min-h-[80vh]">
      <Seo
        title="Press Kit | AB Sustainability Investments"
        description="Press and media resources for AB Sustainability Investments LLC — company background, brand assets, leadership, and information about CashClip and our venture portfolio."
        path="/press"
      />

      <div className="text-center mb-20">
        <div className="section-label">{t.press.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{t.press.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">
          {t.press.sub}
        </p>
      </div>

      {/* Company Overview */}
      <section className="mb-16">
        <div className="section-label">{t.press.overviewLabel}</div>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-3xl p-8 md:p-10 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white mb-4">AB Sustainability Investments LLC</h2>
              <p className="text-white/60 leading-relaxed mb-6">
                {t.press.overviewDesc}
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">{t.press.founded}</span>
                  <span className="text-white font-medium">2025</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">{t.press.headquarters}</span>
                  <span className="text-white font-medium">Georgia, United States</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">{t.press.structure}</span>
                  <span className="text-white font-medium">Limited Liability Company</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">EIN</span>
                  <span className="text-white font-medium">39-2640135</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">{t.press.certification}</span>
                  <span className="text-white font-medium">D-U-N-S Registered</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-white/40 w-32">{t.press.website}</span>
                  <a href="https://absustaininvest.com" target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline font-medium">absustaininvest.com</a>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3 mb-2">
                  <BarChart3 className="w-5 h-5 text-[#00E676]" />
                  <span className="text-white font-semibold">Technology</span>
                </div>
                <p className="text-white/50 text-sm">CashClip mobile rewards app — iOS (Under Apple Review)</p>
              </div>
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3 mb-2">
                  <Building2 className="w-5 h-5 text-yellow-500" />
                  <span className="text-white font-semibold">Retail</span>
                </div>
                <p className="text-white/50 text-sm">Data-driven online retail operations — In Development</p>
              </div>
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3 mb-2">
                  <Briefcase className="w-5 h-5 text-yellow-500" />
                  <span className="text-white font-semibold">Food Service</span>
                </div>
                <p className="text-white/50 text-sm">Next-gen food service concepts — In Development</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CashClip App */}
      <section className="mb-16">
        <div className="section-label">{t.press.flagship}</div>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-3xl p-8 md:p-10 mt-6">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#00E676]/20 to-[#06060E] border border-[#00E676]/30 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-8 h-8 text-[#00E676]" />
            </div>
            <div>
              <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white mb-2">CashClip</h2>
              <p className="text-[#00E676] text-sm font-medium tracking-widest uppercase">Mobile Rewards App · iOS</p>
            </div>
          </div>
          <p className="text-white/60 leading-relaxed mb-8">
            CashClip is a mobile rewards app that pays users real cash for completing surveys, watching videos, playing games, engaging with daily offers, and referring friends. With instant PayPal withdrawals and a growing partner network of survey and offerwall providers, CashClip offers a fresher, smarter approach to earning from home. Currently under Apple App Store review.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Platform", value: "iOS (App Store)" },
              { label: "Bundle ID", value: "app.replit.cashclip" },
              { label: "Withdrawals", value: "PayPal (Instant)" },
              { label: "Status", value: "Under Apple Review" },
            ].map(({ label, value }) => (
              <div key={label} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
                <div className="text-white/40 text-xs uppercase tracking-widest mb-1">{label}</div>
                <div className="text-white font-semibold text-sm">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-white/[0.06]">
            <div className="text-white/40 text-xs uppercase tracking-widest mb-3">Earning Categories</div>
            <div className="flex flex-wrap gap-2">
              {["Surveys", "Videos", "Games", "Offers", "Daily Check-ins", "Referrals"].map((cat) => (
                <span key={cat} className="px-3 py-1 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] text-sm font-medium">{cat}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Leadership */}
      <section className="mb-16">
        <div className="section-label">{t.press.leadership}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-3xl p-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#00E676]/20 to-[#06060E] border border-[#00E676]/30 flex items-center justify-center mb-4">
              <span className="font-serif italic font-bold text-xl text-[#00E676]">JB</span>
            </div>
            <h3 className="font-['Space_Grotesk'] text-xl font-bold text-white mb-1">Jorge Ballen</h3>
            <div className="text-[#00E676] text-xs font-medium tracking-widest uppercase mb-4">Founder & CEO</div>
            <p className="text-white/50 text-sm leading-relaxed">
              Entrepreneur and technology builder behind AB Sustainability Investments LLC and the creator of CashClip. Jorge leads the company's vision, product development, and strategic direction.
            </p>
            <a href="mailto:support@absustaininvest.com" className="mt-4 inline-flex items-center gap-2 text-[#00E676] text-sm hover:underline">
              <Mail className="w-4 h-4" /> support@absustaininvest.com
            </a>
          </div>
        </div>
      </section>

      {/* Media Contact — removed per owner (Jun 2026); area intentionally left blank to refill later */}

      {/* Key Facts */}
      <section>
        <div className="section-label">{t.press.keyFacts}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          {[
            { icon: <Users className="w-5 h-5" />, label: "Team Size", value: "Growing" },
            { icon: <Globe className="w-5 h-5" />, label: "Markets", value: "175 Countries" },
            { icon: <Smartphone className="w-5 h-5" />, label: "Platform", value: "iOS (Android coming)" },
            { icon: <BarChart3 className="w-5 h-5" />, label: "Revenue Model", value: "Survey & Ad Revenue Share" },
            { icon: <Building2 className="w-5 h-5" />, label: "Incorporation", value: "Georgia, USA" },
            { icon: <Briefcase className="w-5 h-5" />, label: "Sectors", value: "Tech · Retail · Food" },
          ].map(({ icon, label, value }) => (
            <div key={label} className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-4">
              <div className="text-[#00E676]">{icon}</div>
              <div>
                <div className="text-white/40 text-xs uppercase tracking-widest">{label}</div>
                <div className="text-white font-semibold text-sm mt-0.5">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
