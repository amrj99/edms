import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TERMS_VERSION = "1.0";
const OWNER = import.meta.env.VITE_OWNER_NAME ?? "ArcScale EDMS";
const CURRENT_YEAR = new Date().getFullYear();

export function TermsGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const userAny = user as any;
  const needsAcceptance = userAny && !userAny.acceptedTermsAt;

  const handleAccept = async () => {
    if (!accepted) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!r.ok) throw new Error("Failed to accept terms");
      await qc.invalidateQueries({ queryKey: ["getMe"] });
      toast({ title: "Terms accepted. Welcome to the system." });
    } catch {
      toast({ title: "Failed to record terms acceptance. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (needsAcceptance) {
    return (
      <Dialog open modal>
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5 text-primary" />
              Terms of Use & Data Protection Notice
            </DialogTitle>
          </DialogHeader>

          <div className="text-sm text-muted-foreground">
            Before accessing {OWNER}, please read and accept the following Terms of Use.
          </div>

          <ScrollArea className="flex-1 border rounded-lg p-4 max-h-[50vh]">
            <div className="space-y-4 text-sm leading-relaxed">
              <p className="text-xs text-muted-foreground">Version {TERMS_VERSION} · © {CURRENT_YEAR} {OWNER}</p>

              <section>
                <h3 className="font-semibold mb-1">1. System Ownership</h3>
                <p>
                  All intellectual property within {OWNER} — including workflows, templates, configurations, and customizations — belongs exclusively to the System owner. © {CURRENT_YEAR} {OWNER}. All rights reserved.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-1">2. Authorized Use Only</h3>
                <p>
                  You may only access data and documents that your organization administrator has explicitly authorized for your role. Access to data belonging to other organizations or unauthorized projects is strictly prohibited.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-1">3. Prohibited Activities</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Copying, reverse engineering, or redistributing System components</li>
                  <li>Sharing login credentials with unauthorized persons</li>
                  <li>Attempting to access other organizations' data</li>
                  <li>Circumventing security controls or audit mechanisms</li>
                  <li>Uploading malicious or unauthorized content</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold mb-1">4. Activity Monitoring</h3>
                <p>
                  All actions — logins, document access, downloads, workflow operations, and administrative changes — are logged with your identity, timestamp, and IP address. By using this System you consent to this monitoring.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-1">5. Data Isolation</h3>
                <p>
                  This System is multi-tenant. Your organization's data is completely isolated from all other organizations. Cross-tenant access is technically prevented and constitutes a material breach of these Terms.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-1">6. Legal Liability</h3>
                <p>
                  Unauthorized access, misuse, or deliberate circumvention of controls may result in account suspension and legal proceedings. The System owner reserves all rights to pursue remedies to the fullest extent of applicable law.
                </p>
              </section>

              <div className="flex items-start gap-2 p-3 border rounded-lg bg-muted/40">
                <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <strong>Privacy:</strong> Your data is stored securely and isolated per organization. Audit logs record access attempts and system actions for compliance. We do not share your organization's data with third parties except as required by law.
                </p>
              </div>
            </div>
          </ScrollArea>

          <div className="flex items-start gap-3 pt-1">
            <Checkbox
              id="terms-accept"
              checked={accepted}
              onCheckedChange={v => setAccepted(!!v)}
            />
            <Label htmlFor="terms-accept" className="text-sm leading-snug cursor-pointer">
              I have read and agree to the Terms of Use and Privacy Policy for {OWNER}. I understand that my activity is monitored and logged, and that unauthorized use may result in legal action.
            </Label>
          </div>

          <DialogFooter>
            <Button
              onClick={handleAccept}
              disabled={!accepted || submitting}
              className="w-full sm:w-auto"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Recording acceptance…</>
              ) : (
                <><Shield className="h-4 w-4 mr-2" />Accept & Continue</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return <>{children}</>;
}
