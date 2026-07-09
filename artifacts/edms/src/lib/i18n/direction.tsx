import { useI18n } from "./index.js";

// ─── useDirection (Phase 8A-1) ────────────────────────────────────────────────
// Central source of truth for direction-aware UI, so RTL logic is not
// re-implemented ad-hoc per page (the audit found it only in AppLayout).
//
// Prefer Tailwind logical classes (ms-/me-/ps-/pe-) over these helpers wherever
// possible — they flip automatically with `dir`. Use this hook only where a
// value genuinely depends on direction (icon rotation, Radix `side`/`align`,
// explicit `dir` props on portalled content).

export interface DirectionInfo {
  isRtl: boolean;
  /** "rtl" | "ltr" — pass to Radix portalled content (Popover/Dropdown/Sheet). */
  dir: "rtl" | "ltr";
  /** Physical side matching the reading start (left in LTR, right in RTL). */
  startSide: "left" | "right";
  /** Physical side matching the reading end. */
  endSide: "left" | "right";
  /** Class to horizontally flip a directional icon (chevron/arrow) in RTL. */
  flipIconClass: string;
}

export function useDirection(): DirectionInfo {
  const { isRtl } = useI18n();
  return {
    isRtl,
    dir: isRtl ? "rtl" : "ltr",
    startSide: isRtl ? "right" : "left",
    endSide: isRtl ? "left" : "right",
    flipIconClass: isRtl ? "rotate-180" : "",
  };
}
