import { useState } from "react";
import { Mail, Globe, MapPin, Send, CheckCircle } from "lucide-react";
import { SOCIALS } from "../lib/socials";
import { useLang } from "../lib/i18n";

export default function Contact() {
  const { t } = useLang();
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type: "contact", source: "website-contact" }),
      });
      if (!res.ok) throw new Error();
      setStatus("sent");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="pt-32 pb-24 px-6 max-w-5xl mx-auto min-h-[80vh] flex flex-col justify-center">
      <div className="text-center mb-16">
        <div className="section-label">{t.contact.label}</div>
        <h1 className="font-serif italic font-bold text-5xl md:text-6xl text-white mb-6">{t.contact.title}</h1>
        <p className="text-white/50 max-w-2xl mx-auto text-lg">
          {t.contact.sub}
        </p>
      </div>

      <div className="contact-cards w-full">
        <div className="contact-card" data-testid="contact-partnerships">
          <div className="cc-icon"><Globe className="w-6 h-6 text-[#00E676]" /></div>
          <h3>{t.contact.partnerships}</h3>
          <p>{t.contact.partnershipsDesc}</p>
          <a href="mailto:supportpr@absustaininvest.com" className="hover:opacity-80 transition-opacity">supportpr@absustaininvest.com</a>
        </div>

        <div className="contact-card" data-testid="contact-cashclip">
          <div className="cc-icon"><Mail className="w-6 h-6 text-[#00E676]" /></div>
          <h3>{t.contact.cashclipSupport}</h3>
          <p>{t.contact.cashclipSupportDesc}</p>
          <a href="mailto:support@absustaininvest.com" className="hover:opacity-80 transition-opacity">support@absustaininvest.com</a>
        </div>

        <div className="contact-card" data-testid="contact-corporate">
          <div className="cc-icon"><MapPin className="w-6 h-6 text-[#00E676]" /></div>
          <h3>{t.contact.corporate}</h3>
          <p>{t.contact.corporateDesc}</p>
          <a href="mailto:support@absustaininvest.com" className="hover:opacity-80 transition-opacity">support@absustaininvest.com</a>
          <div className="mt-4 text-white/30 text-xs font-['Space_Grotesk'] uppercase tracking-widest">D-U-N-S Certified • Georgia, USA</div>
        </div>
      </div>

      <div className="mt-24 max-w-2xl mx-auto w-full">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-3xl p-10">
          <h3 className="font-['Space_Grotesk'] text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <Send className="w-5 h-5 text-[#00E676]" /> {t.contact.sendTitle}
          </h3>
          <p className="text-white/40 text-sm mb-8">{t.contact.sendSub}</p>

          {status === "sent" ? (
            <div className="flex flex-col items-center py-8 text-center" data-testid="contact-success">
              <CheckCircle className="w-12 h-12 text-[#00E676] mb-4" />
              <p className="text-white font-semibold text-lg mb-2">{t.contact.sent}</p>
              <p className="text-white/50 text-sm">{t.contact.sentSub}</p>
              <button onClick={() => setStatus("idle")} className="mt-6 text-[#00E676] text-sm hover:underline">{t.contact.sendAnother}</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" data-testid="contact-form">
              <div>
                <label className="block text-white/60 text-sm font-medium mb-2">{t.contact.nameLabel}</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
                  placeholder={t.contact.namePlaceholder}
                />
              </div>
              <div>
                <label className="block text-white/60 text-sm font-medium mb-2">{t.contact.emailLabel}</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
                  placeholder={t.contact.emailPlaceholder}
                />
              </div>
              <div>
                <label className="block text-white/60 text-sm font-medium mb-2">{t.contact.messageLabel}</label>
                <textarea
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors resize-none"
                  placeholder={t.contact.messagePlaceholder}
                />
              </div>
              {status === "error" && (
                <p className="text-red-400 text-sm">{t.contact.errorMsg}</p>
              )}
              <button
                type="submit"
                disabled={status === "sending"}
                className="hero-cta w-full justify-center !py-4"
              >
                {status === "sending" ? t.contact.sending : t.contact.sendBtn}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-16 text-center">
        <div className="inline-flex flex-wrap justify-center gap-6 p-6 bg-white/[0.02] border border-white/[0.05] rounded-2xl">
          <a href="https://absustaininvest.com" target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white transition-colors font-medium text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" /> absustaininvest.com
          </a>
          <div className="w-px h-5 bg-white/10 hidden md:block"></div>
          <a href="https://cash-clip.app" target="_blank" rel="noopener noreferrer" className="text-[#00E676]/80 hover:text-[#00E676] transition-colors font-medium text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" /> cash-clip.app
          </a>
        </div>
      </div>

      <div className="mt-16 max-w-3xl mx-auto w-full text-center" data-testid="contact-socials">
        <div className="section-label">{t.contact.connect}</div>
        <h2 className="font-serif italic font-bold text-3xl md:text-4xl text-white mb-3">{t.contact.follow}</h2>
        <p className="text-white/50 mb-8 text-sm md:text-base">{t.contact.followSub}</p>
        <div className="flex flex-wrap justify-center gap-4">
          {SOCIALS.map(({ name, url, handle, Icon }) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${name} — ${handle}`}
              data-testid={`contact-social-${name.toLowerCase()}`}
              className="group flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-[#00E676]/40 hover:bg-white/[0.06] transition-colors"
            >
              <Icon className="w-5 h-5 text-[#00E676]" />
              <div className="text-left">
                <div className="text-white text-sm font-semibold">{name}</div>
                <div className="text-white/40 text-xs">{handle}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
