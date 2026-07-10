import { useState, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n, useDirection } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

type ResetFormValues = { password: string; confirmPassword: string };

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
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-1.5 text-xs">
          <CheckCircle2 className={`h-3 w-3 ${c.valid ? "text-green-500" : "text-muted-foreground/40"}`} />
          <span className={c.valid ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function ResetPassword() {
  const { t, lang } = useI18n();
  const { flipIconClass } = useDirection();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") || "";

  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const resetSchema = useMemo(
    () =>
      z.object({
        password: z
          .string()
          .min(8, t("auth.validation.passwordMin8"))
          .regex(/[A-Z]/, t("auth.validation.passwordUppercase"))
          .regex(/[0-9]/, t("auth.validation.passwordNumber")),
        confirmPassword: z.string(),
      }).refine((d) => d.password === d.confirmPassword, {
        message: t("auth.validation.passwordsMismatch"),
        path: ["confirmPassword"],
      }),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const password = form.watch("password");

  const onSubmit = async (data: ResetFormValues) => {
    if (!token) {
      setServerError(t("auth.reset.invalidLink"));
      return;
    }
    setIsLoading(true);
    setServerError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setServerError(json.message || t("auth.reset.failed"));
        return;
      }
      setSuccess(true);
    } catch {
      setServerError(t("auth.shared.networkError"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <AuthLanguageToggle />
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">{t("auth.reset.invalidTitle")}</h2>
          <p className="text-muted-foreground">{t("auth.reset.invalidBody")}</p>
          <Link href="/forgot-password">
            <Button className="mt-4">{t("auth.reset.requestNew")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex bg-background">
      <AuthLanguageToggle />
      <div className="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Building2 className="h-8 w-8" />
              </div>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {success ? t("auth.reset.titleSuccess") : t("auth.reset.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {success ? t("auth.reset.subtitleSuccess") : t("auth.reset.subtitle")}
            </p>
          </div>

          <div className="bg-card px-6 py-8 shadow-xl shadow-black/5 rounded-2xl border border-border/50">
            {!success ? (
              <>
                {serverError && (
                  <Alert variant="destructive" className="mb-6">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{serverError}</AlertDescription>
                  </Alert>
                )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.reset.newPassword")}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="••••••••"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                disabled={isLoading}
                                className="h-11 pe-10"
                                {...field}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <PasswordStrength password={password} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.reset.confirmNewPassword")}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="••••••••"
                                type={showConfirm ? "text" : "password"}
                                autoComplete="new-password"
                                disabled={isLoading}
                                className="h-11 pe-10"
                                {...field}
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirm(!showConfirm)}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                              >
                                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full h-11 font-semibold"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          {t("auth.reset.updating")}
                        </>
                      ) : (
                        t("auth.reset.submit")
                      )}
                    </Button>
                  </form>
                </Form>
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("auth.reset.successBody")}
                </p>
                <Link href="/login">
                  <Button className="w-full h-11 font-semibold mt-2">
                    {t("auth.reset.goToSignIn")}
                  </Button>
                </Link>
              </div>
            )}

            {!success && (
              <div className="mt-6 text-center">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                  <ArrowLeft className={`h-3.5 w-3.5 ${flipIconClass}`} />
                  {t("auth.shared.backToSignIn")}
                </Link>
              </div>
            )}
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
            {t("auth.reset.heroTitle")}
          </h1>
          <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
            {t("auth.reset.heroSubtitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
