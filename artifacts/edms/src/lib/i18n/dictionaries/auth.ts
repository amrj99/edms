// auth — Phase 8B-1 Authentication Journey (vertical slice).
// Covers the 7 auth-journey pages: login, register, forgot-password,
// reset-password, set-password (invitation), verify-email, pending-org.
// Naming convention: domain.component.purpose (see LANGUAGE_LOCALIZATION_STANDARD_DRAFT.md).
// Interpolation: values with {n} / {name} are filled at the call site via String.replace.
export const auth = {
  en: {
    // ── Shared fields ─────────────────────────────────────────────────────────
    "auth.field.email": "Email address",
    "auth.field.emailPlaceholder": "you@company.com",
    "auth.field.password": "Password",

    // ── Shared chrome ─────────────────────────────────────────────────────────
    "auth.shared.backToSignIn": "Back to sign in",
    "auth.shared.networkError": "Network error. Please try again.",
    "auth.shared.heroAlt": "Architecture blueprint background",
    "auth.shared.signOut": "Sign out",

    // ── Language toggle (auth pages) ──────────────────────────────────────────
    "auth.lang.switchToArabic": "Switch to Arabic / العربية",
    "auth.lang.switchToEnglish": "Switch to English",
    "auth.lang.arabicShort": "عربي",
    "auth.lang.englishShort": "EN",

    // ── Password strength checklist ───────────────────────────────────────────
    "auth.password.min8": "At least 8 characters",
    "auth.password.uppercase": "Uppercase letter",
    "auth.password.number": "Number",

    // ── Validation (zod messages) ─────────────────────────────────────────────
    "auth.validation.email": "Please enter a valid email address",
    "auth.validation.passwordRequired": "Password is required",
    "auth.validation.passwordMin8": "Password must be at least 8 characters",
    "auth.validation.passwordUppercase": "Password must contain an uppercase letter",
    "auth.validation.passwordNumber": "Password must contain a number",
    "auth.validation.passwordsMismatch": "Passwords do not match",
    "auth.validation.orgNameMin": "Organisation name must be at least 2 characters",
    "auth.validation.firstNameRequired": "First name is required",
    "auth.validation.lastNameRequired": "Last name is required",

    // ── Login ─────────────────────────────────────────────────────────────────
    "auth.login.title": "Sign in to your account",
    "auth.login.subtitle": "ArcScale Engineering Document Management System",
    "auth.login.forgotPassword": "Forgot password?",
    "auth.login.rememberMe": "Remember me for 7 days",
    "auth.login.signingIn": "Signing in…",
    "auth.login.tooManyAttempts": "Too many attempts — please wait",
    "auth.login.submit": "Sign in",
    "auth.login.noAccountPrompt": "Don't have an account?",
    "auth.login.createAccount": "Create account",
    "auth.login.contactAdmin": "No account? Contact your system administrator for access.",
    "auth.login.attemptsRemaining": "{n} attempts remaining before temporary lockout",
    "auth.login.rateLimited": "Too many login attempts. Please wait before trying again.",
    "auth.login.invalidCredentials": "Invalid email or password. Please try again.",
    "auth.login.heroTitle": "Build with confidence.",
    "auth.login.heroSubtitle":
      "The single source of truth for engineering documents, correspondence, and workflows. Connect your teams across the entire project lifecycle.",

    // ── Register (create organisation) ────────────────────────────────────────
    "auth.register.title": "Start your free trial",
    "auth.register.subtitle": "14 days free. No credit card required.",
    "auth.register.trialLabel": "14-day free trial",
    "auth.register.trialSub": "No credit card required",
    "auth.register.usersLabel": "Up to 3 users",
    "auth.register.usersSub": "Invite your core team",
    "auth.register.storageLabel": "2 GB storage",
    "auth.register.storageSub": "50 MB max file size",
    "auth.register.creditsLabel": "1,000 AI credits",
    "auth.register.creditsSub": "Included at sign-up",
    "auth.register.orgNameLabel": "Organisation Name",
    "auth.register.orgNamePlaceholder": "Acme Engineering",
    "auth.register.firstName": "First name",
    "auth.register.firstNamePlaceholder": "John",
    "auth.register.lastName": "Last name",
    "auth.register.lastNamePlaceholder": "Smith",
    "auth.register.workEmail": "Work email",
    "auth.register.workEmailPlaceholder": "admin@company.com",
    "auth.register.confirmPassword": "Confirm password",
    "auth.register.creating": "Creating organisation…",
    "auth.register.submit": "Start Free Trial",
    "auth.register.terms": "By signing up you agree to ArcScale's Terms of Service and Privacy Policy.",
    "auth.register.failed": "Registration failed",
    "auth.register.success":
      'Organisation "{name}" created! Check your email to verify your address, then log in.',
    "auth.register.haveAccount": "Already have an account?",
    "auth.register.signIn": "Sign in",
    "auth.register.inviteOnly":
      "Organisation membership is by invitation only. Ask your admin to invite you.",
    "auth.register.heroTitle": "Start managing documents smarter.",
    "auth.register.heroSubtitle":
      "Organize engineering documents, manage workflows, and keep your entire team in sync — all in one place.",

    // ── Forgot password ───────────────────────────────────────────────────────
    "auth.forgot.title": "Forgot your password?",
    "auth.forgot.titleSent": "Check your inbox",
    "auth.forgot.subtitle": "Enter your email address and we'll send you a reset link",
    "auth.forgot.subtitleSent": "We've sent you a password reset link",
    "auth.forgot.error": "Something went wrong. Please try again.",
    "auth.forgot.networkError": "Network error. Please check your connection and try again.",
    "auth.forgot.sending": "Sending link…",
    "auth.forgot.submit": "Send reset link",
    "auth.forgot.successBody":
      "If an account exists with that email address, you'll receive a password reset link shortly.",
    "auth.forgot.devMode": "Development mode — reset link:",
    "auth.forgot.devLink": "Click here to reset password",
    "auth.forgot.tryDifferent": "Try a different email",
    "auth.forgot.heroTitle": "We've got you covered.",
    "auth.forgot.heroSubtitle":
      "Securely recover access to your account and get back to managing your engineering documents.",

    // ── Reset password (token flow) ───────────────────────────────────────────
    "auth.reset.title": "Set new password",
    "auth.reset.titleSuccess": "Password reset!",
    "auth.reset.subtitle": "Choose a strong password for your account",
    "auth.reset.subtitleSuccess": "Your password has been updated successfully",
    "auth.reset.invalidLink": "Invalid reset link. Please request a new password reset.",
    "auth.reset.invalidTitle": "Invalid Reset Link",
    "auth.reset.invalidBody": "This reset link is missing or invalid.",
    "auth.reset.requestNew": "Request new reset link",
    "auth.reset.failed": "Failed to reset password. Please try again.",
    "auth.reset.newPassword": "New password",
    "auth.reset.confirmNewPassword": "Confirm new password",
    "auth.reset.updating": "Updating password…",
    "auth.reset.submit": "Set new password",
    "auth.reset.successBody":
      "Your password has been updated. You can now log in with your new password.",
    "auth.reset.goToSignIn": "Go to sign in",
    "auth.reset.heroTitle": "Secure your account.",
    "auth.reset.heroSubtitle":
      "Choose a strong password to keep your engineering documents and team data safe.",

    // ── Set password (invitation / onboarding) ────────────────────────────────
    "auth.setPassword.title": "Set Your Password",
    "auth.setPassword.description": "Create a secure password for your ArcScale EDMS account.",
    "auth.setPassword.invalidLink":
      "Invalid or missing invitation link. Please contact your administrator.",
    "auth.setPassword.min8": "Password must be at least 8 characters.",
    "auth.setPassword.failed": "Failed to set password. The link may have expired.",
    "auth.setPassword.toastSuccess": "Password set successfully",
    "auth.setPassword.doneTitle": "Password set successfully!",
    "auth.setPassword.redirecting": "Redirecting to login…",
    "auth.setPassword.newPassword": "New Password",
    "auth.setPassword.newPasswordPlaceholder": "Minimum 12 characters recommended",
    "auth.setPassword.confirmPassword": "Confirm Password",
    "auth.setPassword.confirmPlaceholder": "Re-enter your password",
    "auth.setPassword.submit": "Set Password & Continue",

    // ── Verify email ──────────────────────────────────────────────────────────
    "auth.verify.verifying": "Verifying your email…",
    "auth.verify.justAMoment": "Just a moment.",
    "auth.verify.successDefault": "Email verified successfully.",
    "auth.verify.successTitle": "Email verified!",
    "auth.verify.continue": "Continue to login",
    "auth.verify.failedDefault": "Verification failed. The link may have expired.",
    "auth.verify.failedTitle": "Verification failed",
    "auth.verify.goToLogin": "Go to login",
    "auth.verify.missingTitle": "No verification token",
    "auth.verify.missingBody":
      "This link is invalid. Check your email for the verification link or contact your administrator.",

    // ── Pending organisation ──────────────────────────────────────────────────
    "auth.pending.title": "Account Not Linked to an Organisation",
    "auth.pending.body":
      "Your account was created but hasn't been connected to an organisation yet. Create a new organisation to get started, or ask your administrator for an invitation.",
    "auth.pending.createOrg": "Create a New Organisation",
    "auth.pending.or": "or",
    "auth.pending.haveInvite": "Have an Invitation?",
    "auth.pending.inviteBody":
      "Ask your organisation administrator to send you an invitation link directly.",
    "auth.pending.invitePlaceholder": "Enter invitation code (coming soon)",
    "auth.pending.submitInviteAria": "Submit invitation code",
  },
  ar: {
    // ── Shared fields ─────────────────────────────────────────────────────────
    "auth.field.email": "البريد الإلكتروني",
    "auth.field.emailPlaceholder": "you@company.com",
    "auth.field.password": "كلمة المرور",

    // ── Shared chrome ─────────────────────────────────────────────────────────
    "auth.shared.backToSignIn": "العودة إلى تسجيل الدخول",
    "auth.shared.networkError": "خطأ في الشبكة. يُرجى المحاولة مرة أخرى.",
    "auth.shared.heroAlt": "خلفية مخطط هندسي",
    "auth.shared.signOut": "تسجيل الخروج",

    // ── Language toggle (auth pages) ──────────────────────────────────────────
    "auth.lang.switchToArabic": "التبديل إلى العربية",
    "auth.lang.switchToEnglish": "Switch to English / الإنجليزية",
    "auth.lang.arabicShort": "عربي",
    "auth.lang.englishShort": "EN",

    // ── Password strength checklist ───────────────────────────────────────────
    "auth.password.min8": "8 أحرف على الأقل",
    "auth.password.uppercase": "حرف كبير واحد",
    "auth.password.number": "رقم واحد",

    // ── Validation (zod messages) ─────────────────────────────────────────────
    "auth.validation.email": "يُرجى إدخال بريد إلكتروني صحيح",
    "auth.validation.passwordRequired": "كلمة المرور مطلوبة",
    "auth.validation.passwordMin8": "يجب ألا تقل كلمة المرور عن 8 أحرف",
    "auth.validation.passwordUppercase": "يجب أن تحتوي كلمة المرور على حرف كبير",
    "auth.validation.passwordNumber": "يجب أن تحتوي كلمة المرور على رقم",
    "auth.validation.passwordsMismatch": "كلمتا المرور غير متطابقتين",
    "auth.validation.orgNameMin": "يجب ألا يقل اسم المؤسسة عن حرفين",
    "auth.validation.firstNameRequired": "الاسم الأول مطلوب",
    "auth.validation.lastNameRequired": "اسم العائلة مطلوب",

    // ── Login ─────────────────────────────────────────────────────────────────
    "auth.login.title": "تسجيل الدخول إلى حسابك",
    "auth.login.subtitle": "ArcScale — نظام إدارة الوثائق الهندسية",
    "auth.login.forgotPassword": "هل نسيت كلمة المرور؟",
    "auth.login.rememberMe": "تذكّرني لمدة 7 أيام",
    "auth.login.signingIn": "جارٍ تسجيل الدخول…",
    "auth.login.tooManyAttempts": "محاولات كثيرة — يُرجى الانتظار",
    "auth.login.submit": "تسجيل الدخول",
    "auth.login.noAccountPrompt": "ليس لديك حساب؟",
    "auth.login.createAccount": "إنشاء حساب",
    "auth.login.contactAdmin": "لا تملك حساباً؟ تواصل مع مسؤول النظام للحصول على صلاحية الدخول.",
    "auth.login.attemptsRemaining": "{n} محاولة متبقية قبل الإيقاف المؤقت",
    "auth.login.rateLimited": "محاولات تسجيل دخول كثيرة. يُرجى الانتظار قبل المحاولة مجدداً.",
    "auth.login.invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة. يُرجى المحاولة مرة أخرى.",
    "auth.login.heroTitle": "ابنِ بثقة.",
    "auth.login.heroSubtitle":
      "المصدر الموحّد الموثوق للوثائق الهندسية والمراسلات وسير العمل. اربط فرقك عبر دورة حياة المشروع بأكملها.",

    // ── Register (create organisation) ────────────────────────────────────────
    "auth.register.title": "ابدأ فترتك التجريبية المجانية",
    "auth.register.subtitle": "14 يوماً مجاناً. دون الحاجة إلى بطاقة ائتمان.",
    "auth.register.trialLabel": "تجربة مجانية 14 يوماً",
    "auth.register.trialSub": "دون بطاقة ائتمان",
    "auth.register.usersLabel": "حتى 3 مستخدمين",
    "auth.register.usersSub": "ادعُ فريقك الأساسي",
    "auth.register.storageLabel": "مساحة تخزين 2 غيغابايت",
    "auth.register.storageSub": "الحجم الأقصى للملف 50 ميغابايت",
    "auth.register.creditsLabel": "1,000 رصيد ذكاء اصطناعي",
    "auth.register.creditsSub": "مُضمَّنة عند التسجيل",
    "auth.register.orgNameLabel": "اسم المؤسسة",
    "auth.register.orgNamePlaceholder": "مثال: شركة الهندسة المتقدمة",
    "auth.register.firstName": "الاسم الأول",
    "auth.register.firstNamePlaceholder": "مثال: محمد",
    "auth.register.lastName": "اسم العائلة",
    "auth.register.lastNamePlaceholder": "مثال: الأحمد",
    "auth.register.workEmail": "بريد العمل",
    "auth.register.workEmailPlaceholder": "admin@company.com",
    "auth.register.confirmPassword": "تأكيد كلمة المرور",
    "auth.register.creating": "جارٍ إنشاء المؤسسة…",
    "auth.register.submit": "ابدأ التجربة المجانية",
    "auth.register.terms": "بتسجيلك فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة بـ ArcScale.",
    "auth.register.failed": "فشل التسجيل",
    "auth.register.success":
      "تم إنشاء المؤسسة \"{name}\"! تحقّق من بريدك الإلكتروني لتأكيد عنوانك، ثم سجّل الدخول.",
    "auth.register.haveAccount": "لديك حساب بالفعل؟",
    "auth.register.signIn": "تسجيل الدخول",
    "auth.register.inviteOnly": "الانضمام إلى المؤسسة بالدعوة فقط. اطلب من المسؤول دعوتك.",
    "auth.register.heroTitle": "ابدأ إدارة الوثائق بذكاء أكبر.",
    "auth.register.heroSubtitle":
      "نظّم الوثائق الهندسية، وأدِر سير العمل، وأبقِ فريقك بأكمله متناغماً — في مكان واحد.",

    // ── Forgot password ───────────────────────────────────────────────────────
    "auth.forgot.title": "هل نسيت كلمة المرور؟",
    "auth.forgot.titleSent": "تحقّق من بريدك الوارد",
    "auth.forgot.subtitle": "أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين",
    "auth.forgot.subtitleSent": "لقد أرسلنا إليك رابط إعادة تعيين كلمة المرور",
    "auth.forgot.error": "حدث خطأ ما. يُرجى المحاولة مرة أخرى.",
    "auth.forgot.networkError": "خطأ في الشبكة. يُرجى التحقق من اتصالك والمحاولة مرة أخرى.",
    "auth.forgot.sending": "جارٍ إرسال الرابط…",
    "auth.forgot.submit": "إرسال رابط إعادة التعيين",
    "auth.forgot.successBody":
      "إذا كان هناك حساب مرتبط بهذا البريد الإلكتروني، فستصلك رسالة تتضمّن رابط إعادة تعيين كلمة المرور قريباً.",
    "auth.forgot.devMode": "وضع التطوير — رابط إعادة التعيين:",
    "auth.forgot.devLink": "اضغط هنا لإعادة تعيين كلمة المرور",
    "auth.forgot.tryDifferent": "جرّب بريداً إلكترونياً آخر",
    "auth.forgot.heroTitle": "نحن هنا لمساعدتك.",
    "auth.forgot.heroSubtitle":
      "استعد الوصول إلى حسابك بأمان وعُد إلى إدارة وثائقك الهندسية.",

    // ── Reset password (token flow) ───────────────────────────────────────────
    "auth.reset.title": "تعيين كلمة مرور جديدة",
    "auth.reset.titleSuccess": "تمت إعادة تعيين كلمة المرور!",
    "auth.reset.subtitle": "اختر كلمة مرور قوية لحسابك",
    "auth.reset.subtitleSuccess": "تم تحديث كلمة مرورك بنجاح",
    "auth.reset.invalidLink": "رابط إعادة التعيين غير صالح. يُرجى طلب إعادة تعيين جديدة.",
    "auth.reset.invalidTitle": "رابط إعادة تعيين غير صالح",
    "auth.reset.invalidBody": "رابط إعادة التعيين مفقود أو غير صالح.",
    "auth.reset.requestNew": "طلب رابط إعادة تعيين جديد",
    "auth.reset.failed": "فشل إعادة تعيين كلمة المرور. يُرجى المحاولة مرة أخرى.",
    "auth.reset.newPassword": "كلمة المرور الجديدة",
    "auth.reset.confirmNewPassword": "تأكيد كلمة المرور الجديدة",
    "auth.reset.updating": "جارٍ تحديث كلمة المرور…",
    "auth.reset.submit": "تعيين كلمة المرور الجديدة",
    "auth.reset.successBody":
      "تم تحديث كلمة مرورك. يمكنك الآن تسجيل الدخول باستخدام كلمة مرورك الجديدة.",
    "auth.reset.goToSignIn": "الانتقال إلى تسجيل الدخول",
    "auth.reset.heroTitle": "أمّن حسابك.",
    "auth.reset.heroSubtitle":
      "اختر كلمة مرور قوية للحفاظ على أمان وثائقك الهندسية وبيانات فريقك.",

    // ── Set password (invitation / onboarding) ────────────────────────────────
    "auth.setPassword.title": "تعيين كلمة المرور",
    "auth.setPassword.description": "أنشئ كلمة مرور آمنة لحسابك في ArcScale EDMS.",
    "auth.setPassword.invalidLink": "رابط الدعوة غير صالح أو مفقود. يُرجى التواصل مع المسؤول.",
    "auth.setPassword.min8": "يجب ألا تقل كلمة المرور عن 8 أحرف.",
    "auth.setPassword.failed": "فشل تعيين كلمة المرور. ربما انتهت صلاحية الرابط.",
    "auth.setPassword.toastSuccess": "تم تعيين كلمة المرور بنجاح",
    "auth.setPassword.doneTitle": "تم تعيين كلمة المرور بنجاح!",
    "auth.setPassword.redirecting": "جارٍ التحويل إلى تسجيل الدخول…",
    "auth.setPassword.newPassword": "كلمة المرور الجديدة",
    "auth.setPassword.newPasswordPlaceholder": "يُوصى بـ 12 حرفاً على الأقل",
    "auth.setPassword.confirmPassword": "تأكيد كلمة المرور",
    "auth.setPassword.confirmPlaceholder": "أعد إدخال كلمة المرور",
    "auth.setPassword.submit": "تعيين كلمة المرور والمتابعة",

    // ── Verify email ──────────────────────────────────────────────────────────
    "auth.verify.verifying": "جارٍ التحقق من بريدك الإلكتروني…",
    "auth.verify.justAMoment": "لحظة من فضلك.",
    "auth.verify.successDefault": "تم التحقق من البريد الإلكتروني بنجاح.",
    "auth.verify.successTitle": "تم التحقق من البريد الإلكتروني!",
    "auth.verify.continue": "المتابعة إلى تسجيل الدخول",
    "auth.verify.failedDefault": "فشل التحقق. ربما انتهت صلاحية الرابط.",
    "auth.verify.failedTitle": "فشل التحقق",
    "auth.verify.goToLogin": "الانتقال إلى تسجيل الدخول",
    "auth.verify.missingTitle": "لا يوجد رمز تحقق",
    "auth.verify.missingBody":
      "هذا الرابط غير صالح. تحقّق من بريدك الإلكتروني بحثاً عن رابط التحقق أو تواصل مع المسؤول.",

    // ── Pending organisation ──────────────────────────────────────────────────
    "auth.pending.title": "الحساب غير مرتبط بمؤسسة",
    "auth.pending.body":
      "تم إنشاء حسابك لكنه لم يُربط بمؤسسة بعد. أنشئ مؤسسة جديدة للبدء، أو اطلب من المسؤول دعوة.",
    "auth.pending.createOrg": "إنشاء مؤسسة جديدة",
    "auth.pending.or": "أو",
    "auth.pending.haveInvite": "هل لديك دعوة؟",
    "auth.pending.inviteBody": "اطلب من مسؤول مؤسستك إرسال رابط دعوة إليك مباشرة.",
    "auth.pending.invitePlaceholder": "أدخل رمز الدعوة (قريباً)",
    "auth.pending.submitInviteAria": "إرسال رمز الدعوة",
  },
} as const;
