import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Building2, Loader2, Eye, EyeOff, AlertCircle, CheckCircle2,
  Lock, Clock, Users, HardDrive, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

// ─── Shared password strength component ──────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const { t } = useI18n();
  const checks = [
    { label: t("auth.password.min8"), valid: password.length >= 8 },
    { label: t("auth.password.uppercase"), valid: /[A-Z]/.test(password) },
    { label: t("auth.password.number"), valid: /[0-9]/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="mt-1 space-y-1">
      {checks.map((check) => (
        <div key={check.label} className="flex items-center gap-1.5 text-xs">
          <CheckCircle2 className={`h-3 w-3 ${check.valid ? "text-green-500" : "text-muted-foreground/40"}`} />
          <span className={check.valid ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
            {check.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Create-Org Form ─────────────────────────────────────────────────────────
type OrgRegValues = {
  orgName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
};

function CreateOrgForm() {
  const { t, lang } = useI18n();
  const [, setLocation] = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const orgRegSchema = useMemo(
    () =>
      z.object({
        orgName: z.string().min(2, t("auth.validation.orgNameMin")).max(100),
        adminFirstName: z.string().min(1, t("auth.validation.firstNameRequired")).max(50),
        adminLastName: z.string().min(1, t("auth.validation.lastNameRequired")).max(50),
        adminEmail: z.string().email(t("auth.validation.email")),
        adminPassword: z.string().min(8, t("auth.validation.passwordMin8"))
          .regex(/[A-Z]/, t("auth.validation.passwordUppercase"))
          .regex(/[0-9]/, t("auth.validation.passwordNumber")),
        confirmPassword: z.string(),
      }).refine(d => d.adminPassword === d.confirmPassword, {
        message: t("auth.validation.passwordsMismatch"),
        path: ["confirmPassword"],
      }),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const form = useForm<OrgRegValues>({
    resolver: zodResolver(orgRegSchema),
    defaultValues: { orgName: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "", confirmPassword: "" },
  });

  const pw = form.watch("adminPassword");

  const onSubmit = async (data: OrgRegValues) => {
    setServerError(null); setLoading(true);
    try {
      const r = await fetch("/api/auth/register-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: data.orgName,
          adminFirstName: data.adminFirstName,
          adminLastName: data.adminLastName,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
        }),
      });
      const json = await r.json();
      if (!r.ok) { setServerError(json.message ?? t("auth.register.failed")); return; }
      setSuccess(t("auth.register.success").replace("{name}", json.orgName));
      setTimeout(() => setLocation("/login"), 4000);
    } catch {
      setServerError(t("auth.shared.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        <FormField control={form.control} name="orgName" render={({ field }) => (
          <FormItem>
            <FormLabel>{t("auth.register.orgNameLabel")}</FormLabel>
            <FormControl>
              <Input placeholder={t("auth.register.orgNamePlaceholder")} className="h-11" disabled={loading || !!success} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="adminFirstName" render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.register.firstName")}</FormLabel>
              <FormControl><Input placeholder={t("auth.register.firstNamePlaceholder")} className="h-11" disabled={loading || !!success} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="adminLastName" render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.register.lastName")}</FormLabel>
              <FormControl><Input placeholder={t("auth.register.lastNamePlaceholder")} className="h-11" disabled={loading || !!success} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="adminEmail" render={({ field }) => (
          <FormItem>
            <FormLabel>{t("auth.register.workEmail")}</FormLabel>
            <FormControl>
              <Input placeholder={t("auth.register.workEmailPlaceholder")} type="email" className="h-11" disabled={loading || !!success} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="adminPassword" render={({ field }) => (
          <FormItem>
            <FormLabel>{t("auth.field.password")}</FormLabel>
            <FormControl>
              <div className="relative">
                <Input placeholder="••••••••" type={showPw ? "text" : "password"} className="h-11 pe-10" disabled={loading || !!success} {...field} />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormControl>
            <PasswordStrength password={pw} />
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="confirmPassword" render={({ field }) => (
          <FormItem>
            <FormLabel>{t("auth.register.confirmPassword")}</FormLabel>
            <FormControl>
              <div className="relative">
                <Input placeholder="••••••••" type={showConfirm ? "text" : "password"} className="h-11 pe-10" disabled={loading || !!success} {...field} />
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" className="w-full h-11 text-base font-semibold mt-2" disabled={loading || !!success}>
          {loading
            ? <><Loader2 className="me-2 h-4 w-4 animate-spin" />{t("auth.register.creating")}</>
            : t("auth.register.submit")}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          {t("auth.register.terms")}
        </p>
      </form>
    </Form>
  );
}

// ─── Main Register Page ───────────────────────────────────────────────────────
export default function Register() {
  const { t } = useI18n();

  const trialHighlights = [
    { icon: Clock,     label: t("auth.register.trialLabel"),   sub: t("auth.register.trialSub") },
    { icon: Users,     label: t("auth.register.usersLabel"),   sub: t("auth.register.usersSub") },
    { icon: HardDrive, label: t("auth.register.storageLabel"), sub: t("auth.register.storageSub") },
    { icon: Cpu,       label: t("auth.register.creditsLabel"), sub: t("auth.register.creditsSub") },
  ];

  return (
    <div className="min-h-screen w-full flex bg-background">
      <AuthLanguageToggle />
      {/* Left panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Building2 className="h-8 w-8" />
              </div>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {t("auth.register.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("auth.register.subtitle")}
            </p>
          </div>

          {/* Trial highlights */}
          <div className="grid grid-cols-2 gap-3">
            {trialHighlights.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-start gap-2.5 rounded-lg border bg-card p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-card px-6 py-8 shadow-xl shadow-black/5 rounded-2xl border border-border/50">
            <CreateOrgForm />
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("auth.register.haveAccount")}{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                {t("auth.register.signIn")}
              </Link>
            </p>
            <div className="flex items-center gap-1.5 justify-center text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span>{t("auth.register.inviteOnly")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="hidden lg:block relative w-0 flex-1 bg-slate-900">
        <img
          className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-overlay"
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt={t("auth.shared.heroAlt")}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
        <div className="absolute bottom-12 start-12 end-12 text-white">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            {t("auth.register.heroTitle")}
          </h1>
          <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
            {t("auth.register.heroSubtitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
