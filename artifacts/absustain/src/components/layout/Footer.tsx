import { Link } from "wouter";
import { SOCIALS } from "../../lib/socials";
import { useLang } from "../../lib/i18n";

export function Footer() {
  const { t } = useLang();
  const f = t.footer;

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="divider mb-8" />
        <div className="footer-links">
          <Link href="/about" data-testid="footer-link-about">{f.about}</Link>
          <Link href="/ventures" data-testid="footer-link-ventures">{f.ventures}</Link>
          <Link href="/investors" data-testid="footer-link-investors">{f.investors}</Link>
          <Link href="/contact" data-testid="footer-link-contact">{f.contact}</Link>
          <Link href="/press" data-testid="footer-link-press">{f.press}</Link>
          <a href="https://cash-clip.app" target="_blank" rel="noopener noreferrer" data-testid="footer-link-cashclip">{f.cashclip}</a>
        </div>
        <p><strong>AB Sustainability Investments LLC</strong></p>
        <p>{f.registered}</p>
        <div className="footer-emails">
          <a href="mailto:support@absustaininvest.com" data-testid="link-email-support">support@absustaininvest.com</a>
          <a href="mailto:supportpr@absustaininvest.com" data-testid="link-email-partnerships">supportpr@absustaininvest.com</a>
        </div>
        <div className="mt-8 flex justify-center gap-4" data-testid="footer-socials">
          {SOCIALS.map(({ name, url, handle, Icon }) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${name} — ${handle}`}
              title={`${name} — ${handle}`}
              data-testid={`footer-social-${name.toLowerCase()}`}
              className="w-10 h-10 flex items-center justify-center rounded-full border border-white/15 text-white/60 hover:text-[#00E676] hover:border-[#00E676]/40 transition-colors"
            >
              <Icon className="w-5 h-5" />
            </a>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Link href="/sc-portal">
            <img src={`${import.meta.env.BASE_URL}logo-alt.png`} alt="AB Sustainability Investments" className="h-16 rounded cursor-default" />
          </Link>
          <p className="text-white/20 text-xs">{f.rights}</p>
        </div>
      </div>
    </footer>
  );
}
