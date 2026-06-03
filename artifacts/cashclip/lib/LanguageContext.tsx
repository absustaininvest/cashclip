import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getLanguage, setLanguage as persistLanguage, getTranslations, type Language, type Translations } from "./i18n";

interface LanguageContextValue {
  lang: Language;
  t: Translations;
  setLang: (lang: Language) => void;
  loaded: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  t: getTranslations("en"),
  setLang: () => {},
  loaded: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");
  const [translations, setTranslations] = useState<Translations>(getTranslations("en"));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getLanguage().then((saved) => {
      setLangState(saved);
      setTranslations(getTranslations(saved));
      setLoaded(true);
    });
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    setTranslations(getTranslations(newLang));
    persistLanguage(newLang);
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <LanguageContext.Provider value={{ lang, t: translations, setLang, loaded }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
