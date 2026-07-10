import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

export default function SetPasswordPage() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t2 = params.get("token");
    if (!t2) {
      setError(t("auth.setPassword.invalidLink"));
    } else {
      setToken(t2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!password || password.length < 8) {
      setError(t("auth.setPassword.min8"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.validation.passwordsMismatch"));
      return;
    }

    setIsLoading(true);
    try {
      const r = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.message || t("auth.setPassword.failed"));
        return;
      }
      setIsDone(true);
      toast({ title: t("auth.setPassword.toastSuccess") });
      setTimeout(() => navigate("/login"), 2500);
    } catch {
      setError(t("auth.shared.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <AuthLanguageToggle />
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t("auth.setPassword.title")}</CardTitle>
          <CardDescription>
            {t("auth.setPassword.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isDone ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium">{t("auth.setPassword.doneTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("auth.setPassword.redirecting")}</p>
            </div>
          ) : error && !token ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">{t("auth.setPassword.newPassword")}</Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t("auth.setPassword.newPasswordPlaceholder")}
                    autoComplete="new-password"
                    className="pe-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="confirmPassword">{t("auth.setPassword.confirmPassword")}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t("auth.setPassword.confirmPlaceholder")}
                  autoComplete="new-password"
                  className="mt-1"
                  required
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
                {t("auth.setPassword.submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
