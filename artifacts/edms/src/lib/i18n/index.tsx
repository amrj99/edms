import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { translations } from "./dictionaries/index.js";

// ─── Language & Localization (Phase 8A) ───────────────────────────────────────
// Public API unchanged from the original monolithic i18n.tsx:
//   I18nProvider, useI18n, useDirection, useLocalizedDate, TranslationKeys.
// Translation strings now live in ./dictionaries/<domain>.ts (Phase 8A-2 split).
// The governing terminology reference is docs/architecture/
// LANGUAGE_LOCALIZATION_STANDARD_DRAFT.md — do not add new terms without it.

type Lang = "en" | "ar";

export type TranslationKeys = keyof typeof translations.en;

interface I18nContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKeys) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => (translations.en as Record<string, string>)[key] ?? key,
  isRtl: false,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem("edms_lang") as Lang) ?? "en";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("edms_lang", l);
  };

  const isRtl = lang === "ar";

  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, isRtl]);

  const t = (key: TranslationKeys): string => {
    return (
      (translations[lang] as Record<string, string>)[key] ??
      (translations.en as Record<string, string>)[key] ??
      key
    );
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t, isRtl }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export { useDirection } from "./direction.js";
export { useLocalizedDate } from "./date.js";
