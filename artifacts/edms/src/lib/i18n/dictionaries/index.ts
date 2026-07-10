// Auto-composed translation dictionary (Phase 8A-2).
// Domain files split from the original monolithic i18n.tsx; values identical.
// To add a key: put it in the right domain file, not here.
import { registers } from "./registers.js";
import { common } from "./common.js";
import { correspondence } from "./correspondence.js";
import { transmittals } from "./transmittals.js";
import { quality } from "./quality.js";
import { dashboard } from "./dashboard.js";
import { activityLog } from "./activityLog.js";
import { modules } from "./modules.js";
import { organizations } from "./organizations.js";
import { workflow } from "./workflow.js";
import { navigation } from "./navigation.js";
import { calendar } from "./calendar.js";
import { tasks } from "./tasks.js";
import { notifications } from "./notifications.js";
import { layout } from "./layout.js";
import { meetings } from "./meetings.js";
import { actionItems } from "./actionItems.js";
import { auth } from "./auth.js";
import { legal } from "./legal.js";

export const translations = {
  en: {
    ...registers.en,
    ...common.en,
    ...correspondence.en,
    ...transmittals.en,
    ...quality.en,
    ...dashboard.en,
    ...activityLog.en,
    ...modules.en,
    ...organizations.en,
    ...workflow.en,
    ...navigation.en,
    ...calendar.en,
    ...tasks.en,
    ...notifications.en,
    ...layout.en,
    ...meetings.en,
    ...actionItems.en,
    ...auth.en,
    ...legal.en,
  },
  ar: {
    ...registers.ar,
    ...common.ar,
    ...correspondence.ar,
    ...transmittals.ar,
    ...quality.ar,
    ...dashboard.ar,
    ...activityLog.ar,
    ...modules.ar,
    ...organizations.ar,
    ...workflow.ar,
    ...navigation.ar,
    ...calendar.ar,
    ...tasks.ar,
    ...notifications.ar,
    ...layout.ar,
    ...meetings.ar,
    ...actionItems.ar,
    ...auth.ar,
    ...legal.ar,
  },
} as const;
