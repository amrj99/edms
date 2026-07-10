import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Shield, FileText, Loader2, ChevronsDown, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const TERMS_VERSION = "1.0";
const OWNER = import.meta.env.VITE_OWNER_NAME ?? "ArcScale EDMS";
const CURRENT_YEAR = new Date().getFullYear();

export function TermsGate({ children }: { children: React.ReactNode }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { logout } = useAuth();
  const userAny = user as any;
  const needsAcceptance = userAny && !userAny.acceptedTermsAt;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  const scrollDown = () => {
    scrollRef.current?.scrollBy({ top: 300, behavior: "smooth" });
  };

  const handleAccept = async () => {
    if (!accepted || !hasScrolledToBottom) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!r.ok) throw new Error("Failed to accept terms");
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await qc.refetchQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: t("legal.termsGate.toastSuccess") });
      setLocation("/");
    } catch {
      toast({ title: t("legal.termsGate.toastFail"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (needsAcceptance) {
    return (
      <Dialog open modal>
        <DialogContent
          className="max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
          style={{ height: "min(90vh, 760px)" }}
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 shrink-0">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold leading-tight">{t("legal.termsGate.title")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("legal.termsGate.versionNote").replace("{v}", TERMS_VERSION)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="shrink-0 text-muted-foreground hover:text-foreground gap-1.5"
              title={t("legal.termsGate.signOutTitle")}
            >
              <LogOut className="h-4 w-4" />
              <span className="text-xs">{t("legal.termsGate.signOut")}</span>
            </Button>
          </div>

          {/* Scroll area */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto px-6 py-4 scroll-smooth"
            >
              <div className="space-y-5 text-sm leading-relaxed pb-4">
                {/* Legal Localization Blocker — Arabic Terms Review.
                    The legal body below is the approved English wording; the Arabic
                    version awaits professional legal review. Notice shown to AR users. */}
                {lang === "ar" && (
                  <div className="flex items-start gap-2 p-3 border border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50 dark:bg-amber-950/40">
                    <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      {t("legal.notice.arabicPending")}
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("legal.termsGate.intro").replace("{owner}", OWNER)}
                </p>

                <section>
                  <h3 className="font-semibold mb-1">1. System Ownership</h3>
                  <p>
                    All intellectual property within {OWNER} — including workflows, templates,
                    configurations, and customizations — belongs exclusively to the System owner.
                    © {CURRENT_YEAR} {OWNER}. All rights reserved. Unauthorized copying,
                    redistribution, or reproduction of any part of this System is strictly prohibited.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">2. Authorized Use Only</h3>
                  <p>
                    You are granted a limited, non-exclusive, non-transferable right to access and
                    use this System solely for its intended purpose within your authorized
                    organization. You may only access data and documents that your organization
                    administrator has explicitly authorized for your role. Access to data belonging
                    to other organizations or unauthorized projects is strictly prohibited and
                    constitutes a material breach of these Terms.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">3. Prohibited Activities</h3>
                  <p className="mb-2">The following are strictly prohibited:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
                    <li>Copying, reverse engineering, decompiling, or redistributing System components</li>
                    <li>Sharing login credentials or granting unauthorized access to third parties</li>
                    <li>Attempting to access data belonging to other organizations or tenants</li>
                    <li>Circumventing security controls, access restrictions, or audit mechanisms</li>
                    <li>Uploading malicious content, scripts, or unauthorized executables</li>
                    <li>Interfering with system availability, integrity, or security</li>
                    <li>Using automated tools to scrape, harvest, or extract system data</li>
                  </ul>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">4. Activity Monitoring & Audit Logging</h3>
                  <p>
                    All activity within this System — including logins (successful and failed),
                    document access, downloads, edits, workflow actions, and administrative changes
                    — is logged with your identity, timestamp, and IP address. These logs are
                    immutable and may be used for security audits, compliance reporting, or legal
                    proceedings. By using this System you expressly consent to this monitoring.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">5. Multi-Tenant Data Isolation</h3>
                  <p>
                    This System operates as a multi-tenant platform. Each organization's data is
                    strictly isolated at both the application and database layers and is inaccessible
                    to users of other organizations. Attempting to access, query, or infer data
                    belonging to another tenant is a material breach of these Terms and may
                    constitute a violation of applicable data protection laws.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">6. Legal Liability</h3>
                  <p>
                    Unauthorized access, misuse, data theft, or deliberate circumvention of this
                    System's controls may result in immediate account suspension, civil claims,
                    and/or referral to relevant law enforcement authorities. The System owner
                    reserves all rights to pursue legal remedies to the fullest extent permitted
                    by applicable law.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">7. Privacy & Data Protection</h3>
                  <p>
                    Your organization's data is stored securely and is never shared with other
                    organizations or third parties except as required by law. Audit logs record
                    all system access and actions for compliance purposes. Personal data (name,
                    email, role) is retained for as long as your account is active. You may
                    request access to or deletion of your personal data via your administrator.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">8. Changes to These Terms</h3>
                  <p>
                    These Terms may be updated at any time. Administrators may require all users
                    to re-accept updated Terms before continued access is permitted. Continued use
                    of the System after notification of updated Terms constitutes acceptance of the
                    revised Terms.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold mb-1">9. Governing Law</h3>
                  <p>
                    These Terms are governed by and construed in accordance with applicable laws.
                    Any disputes arising under these Terms shall be subject to the exclusive
                    jurisdiction of the relevant courts.
                  </p>
                </section>

                <div className="flex items-start gap-2 p-3 border rounded-lg bg-muted/40 mt-2">
                  <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <strong>Summary:</strong> Use this System only as authorized, do not share credentials
                    or attempt cross-tenant access, and understand that all activity is permanently logged.
                    Violations may result in account termination and legal action.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground border-t pt-3">
                  © {CURRENT_YEAR} {OWNER}. All rights reserved. Version {TERMS_VERSION}.
                </p>
              </div>
            </div>

            {/* Scroll-down nudge — fades out once user reaches bottom */}
            {!hasScrolledToBottom && (
              <button
                onClick={scrollDown}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-full px-3 py-1.5 transition-colors shadow-sm"
              >
                <ChevronsDown className="h-3.5 w-3.5 animate-bounce" />
                {t("legal.termsGate.scrollNudge")}
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-4 space-y-4 shrink-0 bg-card">
            <div className={cn(
              "flex items-start gap-3 transition-opacity",
              !hasScrolledToBottom && "opacity-40 pointer-events-none select-none"
            )}>
              <Checkbox
                id="terms-accept"
                checked={accepted}
                onCheckedChange={v => setAccepted(!!v)}
                disabled={!hasScrolledToBottom}
              />
              <Label
                htmlFor="terms-accept"
                className={cn("text-sm leading-snug", hasScrolledToBottom ? "cursor-pointer" : "cursor-not-allowed")}
              >
                {t("legal.termsGate.agreeLabel").replace("{owner}", OWNER)}
              </Label>
            </div>

            {!hasScrolledToBottom && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("legal.termsGate.scrollWarning")}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleAccept}
                disabled={!accepted || !hasScrolledToBottom || submitting}
                className="min-w-[160px]"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin me-2" />{t("legal.termsGate.recording")}</>
                ) : (
                  <><Shield className="h-4 w-4 me-2" />{t("legal.termsGate.accept")}</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return <>{children}</>;
}
