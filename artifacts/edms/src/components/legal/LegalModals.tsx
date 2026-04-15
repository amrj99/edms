import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, FileText } from "lucide-react";

const OWNER = import.meta.env.VITE_OWNER_NAME ?? "ArcScale EDMS";
const CURRENT_YEAR = new Date().getFullYear();

// ─── Terms of Use ─────────────────────────────────────────────────────────────

export function TermsOfUseModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Terms of Use
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-5 text-sm leading-relaxed">
            <p className="text-xs text-muted-foreground">Effective as of 1 January 2024 · Version 1.0</p>

            <section>
              <h3 className="font-semibold mb-1">1. Ownership & Copyright</h3>
              <p>
                {OWNER} and this Engineering Document Management System ("System") are the exclusive intellectual property of their respective owners. All rights reserved. © {CURRENT_YEAR} {OWNER}.
              </p>
              <p className="mt-2">
                All ideas, workflows, custom configurations, templates, automation rules, metadata schemas, and other customizations created within or contributed to this System remain the property of the System owner unless otherwise agreed in writing.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">2. Permitted Use</h3>
              <p>
                You are granted a limited, non-exclusive, non-transferable right to access and use this System solely for its intended purpose as an engineering document management platform within your authorized organization. You may only access data, documents, and records that have been explicitly shared with you or that you are authorized to view by your organization administrator.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">3. Prohibited Activities</h3>
              <p>The following are strictly prohibited:</p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-muted-foreground">
                <li>Copying, reproducing, or redistributing System source code, UI, or proprietary workflows</li>
                <li>Reverse engineering, decompiling, or attempting to extract System logic or architecture</li>
                <li>Sharing login credentials or granting unauthorized access to third parties</li>
                <li>Uploading malicious content, scripts, or unauthorized executables</li>
                <li>Attempting to access data belonging to other organizations or tenants</li>
                <li>Interfering with system availability, integrity, or security controls</li>
                <li>Circumventing access controls or audit logging mechanisms</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold mb-1">4. Multi-Tenant Isolation</h3>
              <p>
                This System operates as a multi-tenant platform. Each organization's data is strictly isolated and inaccessible to users of other organizations. Attempting to access, query, or infer data belonging to another tenant is a material breach of these Terms and may constitute a violation of applicable data protection laws.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">5. Activity Logging & Monitoring</h3>
              <p>
                All activity within this System — including logins, document access, downloads, edits, workflow actions, and administrative changes — is logged with timestamps, user identity, and IP address. These logs may be used for security audits, compliance reporting, or legal proceedings. By using this System you consent to such monitoring.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">6. Legal Liability</h3>
              <p>
                Unauthorized access, misuse, data theft, or deliberate circumvention of this System's controls may result in immediate account suspension, civil claims, and/or referral to relevant law enforcement authorities. The System owner reserves all rights to pursue legal remedies to the fullest extent permitted by applicable law.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">7. Changes to Terms</h3>
              <p>
                These Terms may be updated at any time. Administrators may require all users to re-accept updated Terms before continued access is permitted. Continued use of the System following notification of updated Terms constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">8. Governing Law</h3>
              <p>
                These Terms are governed by and construed in accordance with applicable laws. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the relevant courts.
              </p>
            </section>

            <p className="text-xs text-muted-foreground border-t pt-3">© {CURRENT_YEAR} {OWNER}. All rights reserved.</p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─── Privacy Policy ───────────────────────────────────────────────────────────

export function PrivacyPolicyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Privacy Policy
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-5 text-sm leading-relaxed">
            <p className="text-xs text-muted-foreground">Effective as of 1 January 2024 · Version 1.0</p>

            <section>
              <h3 className="font-semibold mb-1">1. Data Controller</h3>
              <p>
                {OWNER} operates this System and is responsible for the collection, storage, and processing of personal data within the platform. Each subscribing organization acts as an independent data controller for the personal and project data it stores within its tenant.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">2. Tenant Data Isolation</h3>
              <p>
                All data stored in this System — including documents, correspondence, workflows, users, and audit records — is strictly isolated by organization. No user from one organization can access, view, or infer any data belonging to another organization. This isolation is enforced at both the application layer and the database layer.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">3. What Data We Store</h3>
              <ul className="list-disc list-inside mt-1 space-y-1 text-muted-foreground">
                <li>Account information: name, email address, role, organization membership</li>
                <li>Document files, metadata, revisions, and attached files you upload</li>
                <li>Workflow actions, approvals, transmittals, and correspondence</li>
                <li>Audit logs: timestamps, IP addresses, and actions performed</li>
                <li>System preferences and notification settings</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold mb-1">4. Audit Trails</h3>
              <p>
                All access attempts, document views, downloads, edits, workflow actions, and administrative operations are recorded in an immutable audit log. These records include the user's identity, timestamp, IP address, and the type of action performed. Audit logs are retained for compliance and security purposes.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">5. Access Controls</h3>
              <p>
                Access to data within this System is governed by role-based permissions assigned by your organization administrator. Users may only access documents, projects, and workflows explicitly authorized for their role. Unauthorized access attempts are logged and flagged for review.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">6. Data Retention</h3>
              <p>
                Data is retained for as long as your organization's account is active. Upon account termination, data may be retained for a legally mandated period before secure deletion. Document files stored in object storage are governed by the storage provider's retention policies.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">7. No Cross-Organization Disclosure</h3>
              <p>
                We do not share, sell, or disclose your organization's data to any other organization using this System or to any third party, except as required by law or with your explicit written consent.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">8. Security Measures</h3>
              <p>
                We implement industry-standard security controls including encrypted storage, TLS in transit, JWT-based authentication, rate limiting, and per-tenant isolation. Despite these measures, no system is completely immune to security risks and you use this System at your own risk.
              </p>
            </section>

            <section>
              <h3 className="font-semibold mb-1">9. Your Rights</h3>
              <p>
                Subject to applicable law, you may request access to, correction of, or deletion of your personal data by contacting your organization administrator or the System administrator.
              </p>
            </section>

            <p className="text-xs text-muted-foreground border-t pt-3">© {CURRENT_YEAR} {OWNER}. All rights reserved.</p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
