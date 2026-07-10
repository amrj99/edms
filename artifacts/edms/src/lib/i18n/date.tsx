import { format as dfFormat } from "date-fns";
import { arSA } from "date-fns/locale/ar-SA";
import { enUS } from "date-fns/locale/en-US";
import { useI18n } from "./index.js";

// ─── useLocalizedDate (Phase 8A-1) ────────────────────────────────────────────
// Wraps date-fns format() with the active locale so Arabic mode shows Arabic
// month/day names. The audit found format() is called ~33 times with no locale,
// so Arabic users see English month names. Pages should migrate to this hook.
//
// Standard decision (LANGUAGE_LOCALIZATION_STANDARD_DRAFT §5): Gregorian
// calendar and Western digits (0-9) in both languages — arSA provides Arabic
// month/day names on the Gregorian calendar, which is what we want.

export function useLocalizedDate() {
  const { lang } = useI18n();
  const locale = lang === "ar" ? arSA : enUS;

  /** Drop-in replacement for date-fns format(date, pattern) with active locale. */
  function formatDate(date: Date | number | string, pattern: string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return dfFormat(d, pattern, { locale });
  }

  return { formatDate, locale };
}
