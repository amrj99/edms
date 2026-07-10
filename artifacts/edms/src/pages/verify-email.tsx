import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Building2, CheckCircle2, AlertCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

type State = "loading" | "success" | "error" | "missing";

export default function VerifyEmail() {
  const { t } = useI18n();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token");
  const [state, setState] = useState<State>(token ? "loading" : "missing");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const json = await r.json();
        if (r.ok) {
          setState("success");
          setMessage(json.message ?? t("auth.verify.successDefault"));
        } else {
          setState("error");
          setMessage(json.message ?? t("auth.verify.failedDefault"));
        }
      })
      .catch(() => {
        setState("error");
        setMessage(t("auth.shared.networkError"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <AuthLanguageToggle />
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Building2 className="h-8 w-8" />
            </div>
          </div>
        </div>

        <div className="bg-card px-6 py-10 shadow-xl shadow-black/5 rounded-2xl border border-border/50 text-center space-y-6">
          {state === "loading" && (
            <>
              <div className="flex justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t("auth.verify.verifying")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("auth.verify.justAMoment")}</p>
              </div>
            </>
          )}

          {state === "success" && (
            <>
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle2 className="h-7 w-7 text-green-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-700">{t("auth.verify.successTitle")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
              </div>
              <Link href="/login">
                <Button className="w-full">{t("auth.verify.continue")}</Button>
              </Link>
            </>
          )}

          {state === "error" && (
            <>
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                  <AlertCircle className="h-7 w-7 text-red-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t("auth.verify.failedTitle")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
              </div>
              <Link href="/login">
                <Button variant="outline" className="w-full">{t("auth.verify.goToLogin")}</Button>
              </Link>
            </>
          )}

          {state === "missing" && (
            <>
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Mail className="h-7 w-7 text-muted-foreground" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t("auth.verify.missingTitle")}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("auth.verify.missingBody")}
                </p>
              </div>
              <Link href="/login">
                <Button variant="outline" className="w-full">{t("auth.verify.goToLogin")}</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
