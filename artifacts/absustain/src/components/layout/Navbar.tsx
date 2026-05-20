import { Link, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { useLang, LANGUAGES } from "../../lib/i18n";
import { Globe } from "lucide-react";

export function Navbar() {
  const [location] = useLocation();
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang)!;

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-logo" data-testid="link-home">
          <img src={`${import.meta.env.BASE_URL}logo-full.png`} alt="AB Sustainability Investments" className="h-8 rounded" />
          <span>AB <em>Sustainability</em> Investments</span>
        </Link>
        <div className="nav-links">
          <Link href="/about" className={location === "/about" ? "active" : ""} data-testid="link-about">{t.nav.about}</Link>
          <Link href="/ventures" className={location === "/ventures" ? "active" : ""} data-testid="link-ventures">{t.nav.ventures}</Link>
          <Link href="/investors" className={location === "/investors" ? "active" : ""} data-testid="link-investors">{t.nav.investors}</Link>
          <Link href="/team" className={location === "/team" ? "active" : ""} data-testid="link-team">{t.nav.team}</Link>
          <Link href="/press" className={location === "/press" ? "active" : ""} data-testid="link-press">{t.nav.press}</Link>

          {/* Language switcher */}
          <div ref={dropRef} style={{ position: "relative" }}>
            <button
              onClick={() => setOpen((o) => !o)}
              data-testid="lang-switcher"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "20px",
                padding: "6px 12px",
                color: "rgba(255,255,255,0.7)",
                fontSize: "13px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,230,118,0.4)";
                (e.currentTarget as HTMLButtonElement).style.color = "#00E676";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
              }}
            >
              <Globe size={13} />
              <span>{current.flag} {current.label}</span>
            </button>

            {open && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "#111",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "12px",
                  overflow: "hidden",
                  minWidth: "150px",
                  zIndex: 100,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
              >
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setOpen(false); }}
                    data-testid={`lang-${l.code}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      padding: "10px 16px",
                      background: l.code === lang ? "rgba(0,230,118,0.08)" : "transparent",
                      border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      color: l.code === lang ? "#00E676" : "rgba(255,255,255,0.7)",
                      fontSize: "13px",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (l.code !== lang) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (l.code !== lang) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    <span style={{ fontSize: "16px" }}>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Link href="/contact" className="nav-cta" data-testid="link-contact">{t.nav.contact}</Link>
        </div>
      </div>
    </nav>
  );
}
