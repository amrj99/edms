import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Building2, LogOut, Plus, Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useI18n, useDirection } from "@/lib/i18n";
import { AuthLanguageToggle } from "@/components/auth/AuthLanguageToggle";

/**
 * PendingOrg — shown when an authenticated user has no organisation assigned.
 *
 * This is NOT a 403 error page. It is a deliberate UX state that guides the
 * user towards one of two paths:
 *   1. Create a new organisation (starts a free trial).
 *   2. Contact their admin for an invitation link.
 *
 * Invitation code redemption is a future feature — the input is present for
 * expectation-setting but not yet wired to the backend.
 */
export default function PendingOrg() {
  const { t } = useI18n();
  const { flipIconClass } = useDirection();
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const [inviteCode, setInviteCode] = useState("");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <AuthLanguageToggle />
      <div className="w-full max-w-md space-y-8">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-5">
              <Building2 className="h-9 w-9 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("auth.pending.title")}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            {t("auth.pending.body")}
          </p>
        </div>

        {/* Primary CTA */}
        <Button
          className="w-full"
          size="lg"
          onClick={() => navigate("/register")}
        >
          <Plus className="h-4 w-4 me-2" />
          {t("auth.pending.createOrg")}
          <ArrowRight className={`h-4 w-4 ms-auto ${flipIconClass}`} />
        </Button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("auth.pending.or")}</span>
          <Separator className="flex-1" />
        </div>

        {/* Invitation code */}
        <Card className="border-dashed">
          <CardContent className="pt-5 space-y-3">
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">{t("auth.pending.haveInvite")}</p>
              <p className="text-xs text-muted-foreground">
                {t("auth.pending.inviteBody")}
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder={t("auth.pending.invitePlaceholder")}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                disabled
                className="text-sm"
              />
              <Button variant="outline" disabled size="icon" aria-label={t("auth.pending.submitInviteAria")}>
                <Mail className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sign out */}
        <div className="text-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={logout}
          >
            <LogOut className="h-4 w-4 me-2" />
            {t("auth.shared.signOut")}
          </Button>
        </div>

      </div>
    </div>
  );
}
