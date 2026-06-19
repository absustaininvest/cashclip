import { Mail } from "lucide-react";
import { useLang } from "../lib/i18n";
import { Seo } from "../components/Seo";

const team = [
  {
    initials: "JB",
    name: "Jorge Ballen",
    title: "Founder & CEO",
    color: "#00E676",
    email: "support@absustaininvest.com",
    linkedin: null,
    bio: "Entrepreneur, technology builder, and visionary behind AB Sustainability Investments LLC and its flagship product CashClip. Jorge leads the company's product development, technology infrastructure, and strategic direction — turning an idea into a real, growing business.",
    highlights: ["Product & Technology", "Venture Strategy", "Capital Operations"],
  },
];

export default function Team() {
  const { t } = useLang();
  const bios = [t.team.jbBio];
  return (
    <div className="pt-32 pb-24 px-6 max-w-5xl mx-auto min-h-[80vh]">
      <Seo
        title="Team | AB Sustainability Investments"
        description="Meet the team behind AB Sustainability Investments LLC — the people building, operating, and growing our portfolio of sustainable technology and business ventures."
        path="/team"
      />

      <div className="text-center mb-20">
        <div className="section-label">{t.team.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{t.team.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">
          {t.team.sub}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
        {team.map(({ initials, name, title, color, email, highlights }, i) => (
          <div key={name} className="bg-white/[0.03] border border-white/[0.08] rounded-3xl p-8 flex flex-col">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-6 flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${color}22, #06060E)`, border: `1px solid ${color}44` }}
            >
              <span className="font-serif italic font-bold text-2xl" style={{ color }}>{initials}</span>
            </div>

            <h2 className="font-['Space_Grotesk'] text-2xl font-bold text-white mb-1">{name}</h2>
            <div className="text-xs font-medium tracking-widest uppercase mb-5" style={{ color }}>{title}</div>

            <p className="text-white/50 text-sm leading-relaxed mb-6 flex-1">{bios[i]}</p>

            <div className="grid grid-cols-3 gap-2 pt-6 border-t border-white/[0.06] mb-6">
              {highlights.map((h) => (
                <div key={h} className="text-center">
                  <div className="text-white text-xs font-semibold leading-tight">{h}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <a
                href={`mailto:${email}`}
                className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
              >
                <Mail className="w-4 h-4" style={{ color }} />
                {email}
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto text-center py-12 px-8 border border-white/5 rounded-3xl bg-white/[0.01]">
        <div className="text-white/40 text-xs uppercase tracking-widest mb-4">{t.team.philosophy}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <div className="text-white font-bold mb-1">{t.team.ventureStrategy}</div>
            <div className="text-white/40 text-sm">{t.team.ventureStrategyDesc}</div>
          </div>
          <div>
            <div className="text-white font-bold mb-1">{t.team.capitalDiscipline}</div>
            <div className="text-white/40 text-sm">{t.team.capitalDisciplineDesc}</div>
          </div>
          <div>
            <div className="text-white font-bold mb-1">{t.team.growthScale}</div>
            <div className="text-white/40 text-sm">{t.team.growthScaleDesc}</div>
          </div>
        </div>
      </div>

    </div>
  );
}
