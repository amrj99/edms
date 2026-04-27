import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Building2, CheckCircle2, AlertCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "loading" | "success" | "error" | "missing";

export default function VerifyEmail() {
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
          setMessage(json.message ?? "Email verified successfully.");
        } else {
          setState("error");
          setMessage(json.message ?? "Verification failed. The link may have expired.");
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Network error. Please try again.");
      });
  }, [token]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
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
                <h3 className="text-lg font-semibold">Verifying your email…</h3>
                <p className="text-sm text-muted-foreground mt-1">Just a moment.</p>
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
                <h3 className="text-lg font-semibold text-green-700">Email verified!</h3>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
              </div>
              <Link href="/login">
                <Button className="w-full">Continue to login</Button>
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
                <h3 className="text-lg font-semibold">Verification failed</h3>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
              </div>
              <Link href="/login">
                <Button variant="outline" className="w-full">Go to login</Button>
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
                <h3 className="text-lg font-semibold">No verification token</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  This link is invalid. Check your email for the verification link or contact your administrator.
                </p>
              </div>
              <Link href="/login">
                <Button variant="outline" className="w-full">Go to login</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
