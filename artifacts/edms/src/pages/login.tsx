import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

type LoginFormValues = {
  email: string;
  password: string;
  rememberMe?: boolean;
};

export default function Login() {
  const { t, lang } = useI18n();
  const { login: setAuthToken } = useAuth();
  const loginMutation = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("auth.validation.email")),
        password: z.string().min(1, t("auth.validation.passwordRequired")),
        rememberMe: z.boolean().optional(),
      }),
    [lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    if (rateLimited) return;
    setServerError(null);
    setAttemptsRemaining(null);
    try {
      const response = await loginMutation.mutateAsync({
        data: { email: data.email, password: data.password },
      });
      if ((response as any).refreshToken) {
        localStorage.setItem("edms_refresh_token", (response as any).refreshToken);
      }
      if (data.rememberMe) {
        localStorage.setItem("edms_remember_me", "true");
      }
      setAuthToken(response.token);
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const body = error?.body ?? {};
      if (status === 429) {
        setRateLimited(true);
        setAttemptsRemaining(null);
        const msg = body.message || t("auth.login.rateLimited");
        setServerError(msg);
        return;
      }
      const remaining = typeof body.attemptsRemaining === "number" ? body.attemptsRemaining : null;
      setAttemptsRemaining(remaining);
      const msg = body.message || error?.message || t("auth.login.invalidCredentials");
      setServerError(msg);
    }
  };

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
              {t("auth.login.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("auth.login.subtitle")}
            </p>
          </div>

          <div className="bg-card px-6 py-8 shadow-xl shadow-black/5 rounded-2xl border border-border/50">
            {serverError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {serverError}
                  {attemptsRemaining !== null && attemptsRemaining > 0 && (
                    <span className="block mt-1 text-xs opacity-90">
                      {t("auth.login.attemptsRemaining").replace("{n}", String(attemptsRemaining))}
                    </span>
                  )}
                </AlertDescription>
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
                          disabled={loginMutation.isPending || rateLimited}
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t("auth.field.password")}</FormLabel>
                        <Link href="/forgot-password" className="text-sm text-primary hover:underline font-medium">
                          {t("auth.login.forgotPassword")}
                        </Link>
                      </div>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="••••••••"
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            disabled={loginMutation.isPending || rateLimited}
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
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="rememberMe"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={loginMutation.isPending || rateLimited}
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        {t("auth.login.rememberMe")}
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 text-base font-semibold"
                  disabled={loginMutation.isPending || rateLimited}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      {t("auth.login.signingIn")}
                    </>
                  ) : rateLimited ? (
                    t("auth.login.tooManyAttempts")
                  ) : (
                    t("auth.login.submit")
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("auth.login.noAccountPrompt")}{" "}
                <Link href="/register" className="text-primary font-medium hover:underline">
                  {t("auth.login.createAccount")}
                </Link>
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {t("auth.login.contactAdmin")}
          </p>
          {(import.meta.env.VITE_GIT_HASH && import.meta.env.VITE_GIT_HASH !== "unknown") && (
            <p className="text-center text-[10px] text-muted-foreground/40 font-mono mt-1" title={`Built: ${import.meta.env.VITE_BUILD_TIME ?? "unknown"}`}>
              build {import.meta.env.VITE_GIT_HASH} · {import.meta.env.VITE_BUILD_TIME?.slice(0, 10)}
            </p>
          )}
        </div>
      </div>

      {/* Right panel - image */}
      <div className="hidden lg:block relative w-0 flex-1 bg-slate-900">
        <img
          className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-overlay"
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt={t("auth.shared.heroAlt")}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
        <div className="absolute bottom-12 start-12 end-12 text-white">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            {t("auth.login.heroTitle")}
          </h1>
          <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
            {t("auth.login.heroSubtitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
