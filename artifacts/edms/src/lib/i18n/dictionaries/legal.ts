// legal — Phase 8B-1 legal UI chrome (TermsGate + LegalModals).
//
// SCOPE (product-owner decision, Option A):
//   Only the *chrome* around the legal text is translated here — headings,
//   buttons, scroll instructions, the acceptance checkbox, and toasts.
//   The legal agreement BODY (Terms of Use / Privacy Policy sections) is NOT
//   machine-translated: it stays in its currently approved English wording and
//   an Arabic-user notice (legal.notice.arabicPending) is shown above it.
//
//   ⚠️ LEGAL LOCALIZATION BLOCKER — Arabic Terms Review:
//   The Arabic legal body is pending professional legal review. Do not claim the
//   Terms/Privacy content is complete bilingual until the Arabic wording is
//   legally approved. See docs/architecture/LANGUAGE_LOCALIZATION_STANDARD_DRAFT.md.
//
// Interpolation: {v} = version, {owner} = system owner name — filled at call site.
export const legal = {
  en: {
    // ── Legal Localization Blocker notice (shown above the English body in AR) ──
    "legal.notice.arabicPending":
      "Note: The approved legal text below is currently provided in English. A professionally reviewed Arabic version is pending legal approval. By accepting, you agree to the English text shown.",

    // ── TermsGate (post-login acceptance gate) ────────────────────────────────
    "legal.termsGate.title": "Terms of Use & Data Protection Notice",
    "legal.termsGate.versionNote": "Version {v} · Please read the full terms before accepting",
    "legal.termsGate.signOut": "Sign out",
    "legal.termsGate.signOutTitle": "Sign out and switch account",
    "legal.termsGate.intro": "Before accessing {owner}, you must read and accept these Terms of Use in full.",
    "legal.termsGate.scrollNudge": "Scroll to read all terms",
    "legal.termsGate.agreeLabel":
      "I have read and agree to the Terms of Use and Privacy Policy for {owner}. I understand that my activity is monitored and logged, and that unauthorized use may result in legal action.",
    "legal.termsGate.scrollWarning":
      "↑ Please scroll through and read all the terms above before accepting.",
    "legal.termsGate.recording": "Recording…",
    "legal.termsGate.accept": "Accept & Continue",
    "legal.termsGate.toastSuccess": "Terms accepted. Welcome to the system.",
    "legal.termsGate.toastFail": "Failed to record terms acceptance. Please try again.",

    // ── LegalModals (standalone reference dialogs) ────────────────────────────
    "legal.modal.termsTitle": "Terms of Use",
    "legal.modal.privacyTitle": "Privacy Policy",
  },
  ar: {
    // ── Legal Localization Blocker notice (shown above the English body in AR) ──
    "legal.notice.arabicPending":
      "تنبيه: النص القانوني المعتمد أدناه مُتاح حالياً باللغة الإنجليزية. النسخة العربية قيد المراجعة القانونية المتخصصة ولم تُعتمد بعد. بالموافقة، فإنك توافق على النص الإنجليزي المعروض.",

    // ── TermsGate (post-login acceptance gate) ────────────────────────────────
    "legal.termsGate.title": "شروط الاستخدام وإشعار حماية البيانات",
    "legal.termsGate.versionNote": "الإصدار {v} · يُرجى قراءة الشروط كاملةً قبل الموافقة",
    "legal.termsGate.signOut": "تسجيل الخروج",
    "legal.termsGate.signOutTitle": "تسجيل الخروج وتبديل الحساب",
    "legal.termsGate.intro": "قبل الوصول إلى {owner}، يجب قراءة شروط الاستخدام هذه والموافقة عليها بالكامل.",
    "legal.termsGate.scrollNudge": "مرّر لأسفل لقراءة كل الشروط",
    "legal.termsGate.agreeLabel":
      "لقد قرأت شروط الاستخدام وسياسة الخصوصية الخاصة بـ {owner} وأوافق عليها. وأدرك أن نشاطي مُراقَب ومُسجَّل، وأن الاستخدام غير المصرّح به قد يؤدي إلى إجراءات قانونية.",
    "legal.termsGate.scrollWarning":
      "↑ يُرجى التمرير عبر جميع الشروط أعلاه وقراءتها قبل الموافقة.",
    "legal.termsGate.recording": "جارٍ التسجيل…",
    "legal.termsGate.accept": "الموافقة والمتابعة",
    "legal.termsGate.toastSuccess": "تم قبول الشروط. مرحباً بك في النظام.",
    "legal.termsGate.toastFail": "فشل تسجيل قبول الشروط. يُرجى المحاولة مرة أخرى.",

    // ── LegalModals (standalone reference dialogs) ────────────────────────────
    "legal.modal.termsTitle": "شروط الاستخدام",
    "legal.modal.privacyTitle": "سياسة الخصوصية",
  },
} as const;
