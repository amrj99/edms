import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * AuthLanguageToggle — Phase 8B-1.
 *
 * The auth-journey pages render OUTSIDE AppLayout, so the app's main
 * LanguageToggle is not available there. Without a switcher a first-time
 * (unauthenticated) user has no way to choose Arabic on the login/register
 * screens. This small display-only control fills that gap; it flips the same
 * global language state (persisted in localStorage as `edms_lang`) — no auth or
 * security logic is involved.
 *
 * Positioned at the reading-end top corner using logical `end-4`, so it sits
 * top-right in LTR and top-left in RTL automatically.
 */
export function AuthLanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const toArabic = lang === "en";
  return (
    <div className="fixed top-4 end-4 z-50">
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2.5 gap-1.5 text-xs font-semibold bg-card/80 backdrop-blur shadow-sm"
        onClick={() => setLang(toArabic ? "ar" : "en")}
        title={toArabic ? t("auth.lang.switchToArabic") : t("auth.lang.switchToEnglish")}
      >
        <span className="text-base leading-none">{toArabic ? "🇦🇪" : "🇬🇧"}</span>
        <span>{toArabic ? t("auth.lang.arabicShort") : t("auth.lang.englishShort")}</span>
      </Button>
    </div>
  );
}
