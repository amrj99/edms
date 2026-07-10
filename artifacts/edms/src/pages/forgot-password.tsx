import { useState, useMemo } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, ArrowLeft, Mail, AlertCircle } from "lucide-react";
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

type ForgotFormValues = { email: string };

export default function ForgotPassword() {
  const { t, lang } = useI18n();
  const { flipIconClass } = useDirection();
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<{ resetToken?: string; resetUrl?: string } | null>(null);

  const forgotSchema = useMemo(
    () => z.object({ email: z.string().email(t("auth.validation.email")) }),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const form = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotFormValues) => {
    setIsLoading(true);
    setServerError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setServerError(json.message || t("auth.forgot.error"));
        return;
      }
      setSent(true);
      if (json.resetToken) {
        setResetInfo({ resetToken: json.resetToken, resetUrl: json.resetUrl });
      }
    } catch {
      setServerError(t("auth.forgot.networkError"));
    } finally {
      setIsLoading(false);
    }
  };

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
              {sent ? t("auth.forgot.titleSent") : t("auth.forgot.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {sent ? t("auth.forgot.subtitleSent") : t("auth.forgot.subtitle")}
            </p>
          </div>

          <div className="bg-card px-6 py-8 shadow-xl shadow-black/5 rounded-2xl border border-border/50">
            {!sent ? (
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
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.field.email")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("auth.field.emailPlaceholder")}
                              type="email"
                              autoComplete="email"
                              disabled={isLoading}
                              className="h-11"
                              {...field}
                            />
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
                          {t("auth.forgot.sending")}
                        </>
                      ) : (
                        t("auth.forgot.submit")
                      )}
                    </Button>
                  </form>
                </Form>
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <Mail className="h-7 w-7 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t("auth.forgot.successBody")}
                </p>

                {resetInfo?.resetToken && (
                  <Alert className="text-start mt-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
                    <AlertDescription className="text-xs">
                      <strong className="text-amber-800 dark:text-amber-300">{t("auth.forgot.devMode")}</strong>
                      <br />
                      <Link
                        href={resetInfo.resetUrl || `/reset-password?token=${resetInfo.resetToken}`}
                        className="text-primary underline break-all mt-1 block"
                      >
                        {t("auth.forgot.devLink")}
                      </Link>
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => { setSent(false); form.reset(); }}
                >
                  {t("auth.forgot.tryDifferent")}
                </Button>
              </div>
            )}

            <div className="mt-6 text-center">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className={`h-3.5 w-3.5 ${flipIconClass}`} />
                {t("auth.shared.backToSignIn")}
              </Link>
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
            {t("auth.forgot.heroTitle")}
          </h1>
          <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
            {t("auth.forgot.heroSubtitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
