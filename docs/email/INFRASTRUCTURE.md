# Email Infrastructure — ArcScale EDMS

> **Operational document.**
> Required reading before real user onboarding.
> Also useful as educational reference for SPF, DKIM, and DMARC.

---

## 1. Current State (as of May 2026)

| Variable | Status on VPS | Effect |
|---|---|---|
| `RESEND_API_KEY` | Configured | Resend client is initialized. Emails are attempted. |
| `FROM_EMAIL` | **Not set** | Falls back to `onboarding@resend.dev` (Resend sandbox mode) |
| `APP_URL` | **Not set** | Email links point to `https://your-edms.replit.app` (wrong) |
| `FROM_NAME` | Not set | Falls back to `ArcScale EDMS` (correct default) |

---

## 2. Which Email Flows Currently Work

The code at `artifacts/api-server/src/lib/email.ts` resolves the FROM address as:

```typescript
const FROM_ADDR = process.env.FROM_EMAIL ?? "onboarding@resend.dev";
```

When `FROM_EMAIL` is not set, the system uses Resend's sandbox address (`onboarding@resend.dev`). **Sandbox mode only delivers to email addresses you have manually verified in your Resend account dashboard.** Every other address is silently dropped.

| Flow | Trigger | Delivers in sandbox mode? | Why |
|---|---|---|---|
| Password reset | `POST /api/auth/forgot-password` | **Yes** — if the recipient's email is Resend-verified | You received this email because your email address was verified in your Resend account |
| Email verification | `POST /api/auth/register-org` | **No** — pilot users' emails are not Resend-verified | Silently dropped |
| Welcome email | `POST /api/auth/register` | **No** | Silently dropped |
| Document upload notification | Document upload | **No** | Silently dropped |
| Review submitted | Workflow submission | **No** | Silently dropped |
| Document approved/rejected | Workflow decision | **No** | Silently dropped |
| Correspondence delivery | Correspondence send | **No** | Silently dropped |
| Task assigned | Task creation | **No** | Silently dropped |
| Meeting invitations | Meeting creation | **No** | Silently dropped |

**Why you could receive the password reset:** Your personal email address was either explicitly added as a "verified email" in the Resend dashboard, or it was automatically verified when you signed up for Resend. All other email addresses in the system are unverified and will not receive emails from the sandbox address.

**The consequence for a pilot user:** When a pilot user registers via `/register-org`, the system creates their account and attempts to send a verification email. The email is silently dropped by Resend. The user never receives it. Their account exists but their email is unverified. They can still log in (email verification is not a login gate), but they will hit the email verification gate if it is enforced for file uploads.

---

## 3. Required Setup Before Pilot Onboarding

All four steps must be complete before inviting any real user to the system.

### Step 1: Add and verify your domain in Resend

1. Go to https://resend.com and log in.
2. Navigate to **Domains**.
3. Click **Add Domain**.
4. Enter your domain (e.g., `arcscale.com` or `yourdomain.com`).
5. Resend will give you a set of DNS records to add. Add all of them.
6. Click **Verify**. The status must show **Verified** before proceeding.

### Step 2: Add the DNS records (SPF, DKIM, DMARC)

Resend provides the exact DNS records after domain verification. You will add these in your DNS provider (Cloudflare, AWS Route 53, etc.).

Resend provides:
- One SPF record (TXT on your root domain or `@`)
- Two DKIM records (CNAME records on specific subdomains)
- You add DMARC yourself (one TXT record on `_dmarc.yourdomain.com`)

See Section 4 for a full explanation of what each record does.

**Start with a permissive DMARC policy:**

```
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com"
```

`p=none` means: monitor only, do not block anything. This lets you verify everything is working before enforcing. Move to `p=quarantine` after 2-4 weeks of clean reports, then `p=reject` after another 2-4 weeks.

### Step 3: Set environment variables on the VPS

Edit `/var/www/edms/.env`:

```
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME=ArcScale EDMS
APP_URL=https://yourdomain.com
```

`FROM_EMAIL` must be an address on the verified domain. `noreply@yourdomain.com` is the standard convention for transactional email senders that do not accept replies.

### Step 4: Restart the API and send a test email

```bash
cd /var/www/edms
docker compose build api && docker compose up -d --force-recreate api
```

Wait for the API to start (check `docker logs edms_api --tail=20`). Look for:

```
[email] Configured — FROM: ArcScale EDMS <noreply@yourdomain.com>
```

If you see this line, FROM_EMAIL is set correctly. If you see the sandbox warning, FROM_EMAIL is still not set.

**Send a test:**

```bash
curl -X POST https://yourdomain.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"your-real-email@yourdomain.com"}'
```

You should receive a password reset email from `noreply@yourdomain.com` within 30 seconds.

---

## 4. SPF, DKIM, and DMARC — Plain Language Explanations

These three mechanisms are the foundation of email authentication. They work together. Understanding each one also helps you explain them to clients or in educational content.

---

### SPF — Sender Policy Framework

**What it is:**
SPF is a short text record in your domain's DNS that lists which mail servers are allowed to send email on your domain's behalf.

Think of it like a guest list for a building. When someone shows up claiming to be from your company, the security desk checks the list: is this server authorized to represent your domain? If not, something is wrong.

**What problem it solves:**
Without SPF, any mail server in the world can send email claiming to be from `noreply@yourdomain.com`. A phishing attacker could set up their own server and send emails "from" your domain to trick your users or clients. SPF makes it possible for receiving mail servers to detect and reject this.

**What happens if it's missing:**
Receiving mail servers cannot verify that your emails actually come from you. Your emails are more likely to be marked as spam. Phishing attackers can spoof your domain more easily, and you have no technical defense against it.

**Affects:** Both deliverability (spam scoring) and spoofing protection (unauthorized senders).

**What a Resend SPF record looks like:**
```
yourdomain.com  TXT  "v=spf1 include:amazonses.com ~all"
```
(Resend uses Amazon SES infrastructure. The exact record is shown in the Resend dashboard.)

**Reading the record:**
- `v=spf1` — this is an SPF record
- `include:amazonses.com` — any server authorized to send for amazonses.com is also authorized for your domain
- `~all` — for all other servers: soft fail (treat as suspicious but don't hard reject)

---

### DKIM — DomainKeys Identified Mail

**What it is:**
DKIM adds a cryptographic signature to every outgoing email. When Resend sends an email for you, it signs it with a private key that only Resend holds. Your DNS record contains the corresponding public key. Receiving mail servers download your public key and verify the signature.

Think of it like a wax seal on a letter. The seal proves the letter came from the person who owns the signet ring, and that the letter hasn't been opened and resealed by someone else.

**What problem it solves:**
DKIM proves two things simultaneously:
1. **Authentication:** The email actually came from the domain it claims. If the signature is valid, Resend (using your domain) genuinely sent it.
2. **Integrity:** The email content was not changed in transit. If any part of the email (headers, body) is modified after signing, the signature becomes invalid.

A man-in-the-middle attacker who intercepts and rewrites the email breaks the signature. A receiving server that detects a broken signature knows the email was tampered with.

**What happens if it's missing:**
No cryptographic proof of origin or integrity. Mail servers (especially Gmail, Microsoft 365, and Yahoo) increasingly treat DKIM-unsigned email from custom domains as suspicious. Without DKIM, your emails are more likely to land in spam. DMARC also requires DKIM (or SPF alignment) to pass — without DKIM, DMARC enforcement cannot work correctly.

**Affects:** Both deliverability (major providers require it) and tampering protection (integrity assurance).

**What a Resend DKIM record looks like:**
```
resend._domainkey.yourdomain.com  CNAME  yourdomain.resend.com.dkim.amazonses.com
```
(Resend gives you two of these to add. The exact subdomains are shown in the dashboard.)

---

### DMARC — Domain-based Message Authentication, Reporting and Conformance

**What it is:**
DMARC sits on top of SPF and DKIM. It tells receiving mail servers what to do when an email fails authentication checks, and it enables reporting so you can see how your domain is being used in email worldwide.

Think of it as the enforcement policy and the surveillance system. SPF and DKIM are the authentication checks at the door. DMARC is the rule that says what to do when someone fails the check — let them in anyway, put them in a holding room, or turn them away — and the camera system that sends you daily reports of everyone who tried to enter.

**What problem it solves:**
Without DMARC, failing SPF or DKIM authentication does not automatically result in the email being blocked. The receiving mail server makes its own decision, and many let suspicious emails through rather than risk blocking legitimate mail. DMARC is what makes authentication failures actionable. It also gives you visibility: you receive aggregate reports showing all emails that claimed to come from your domain, whether they passed or failed authentication. This is how you detect if someone is actively spoofing your domain.

**What happens if it's missing:**
Even if SPF and DKIM are correctly configured, there is no enforcement policy. A spoofing attacker whose emails fail SPF and DKIM may still reach recipients, because receiving servers have no instruction to block them. DMARC is also increasingly required by major email providers (Google and Yahoo announced in 2024 that bulk senders must have DMARC configured).

**Affects:** Both deliverability (required for bulk sending) and spoofing protection (makes authentication failures have consequences).

**What the record looks like:**
```
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com"
```

**Reading the record:**
- `v=DMARC1` — this is a DMARC record
- `p=none` — policy for failing emails: monitor only (do nothing). Start here.
- `p=quarantine` — policy upgrade: move failing emails to spam folder
- `p=reject` — policy upgrade: block failing emails entirely (highest protection)
- `rua=mailto:...` — send aggregate reports to this address

**Recommended rollout timeline:**

| Week | Policy | Why |
|---|---|---|
| Week 1-4 | `p=none` | Confirm all legitimate senders pass. Read the reports. |
| Week 5-8 | `p=quarantine` | Failing emails go to spam. Monitor for false positives. |
| Week 9+ | `p=reject` | Full enforcement. Spoofed emails are blocked. |

---

### Summary Comparison

| | SPF | DKIM | DMARC |
|---|---|---|---|
| **What it checks** | Which servers can send for your domain | Email came from your domain and wasn't modified | Policy: what to do when checks fail |
| **DNS record type** | TXT on root domain | CNAME on subdomain | TXT on `_dmarc` subdomain |
| **Protects against** | Unauthorized sending servers | Impersonation and tampering | Makes protections enforceable |
| **Deliverability impact** | Important | Very important | Required for high-volume senders |
| **Spoofing protection** | Basic (server-level) | Strong (cryptographic) | Enforcement + visibility |
| **Can work without the others** | Yes, partially | Yes, partially | No — depends on SPF and/or DKIM |

All three are required. SPF and DKIM without DMARC means authentication checks run but failures have no enforcement. DMARC without SPF and DKIM has nothing to enforce.

---

## 5. Verifying the Setup

After adding all DNS records and setting environment variables:

```bash
# Check SPF
dig TXT yourdomain.com | grep spf

# Check DKIM (subdomain varies — check Resend dashboard for exact name)
dig CNAME resend._domainkey.yourdomain.com

# Check DMARC
dig TXT _dmarc.yourdomain.com
```

Or use an online tool: https://mxtoolbox.com/EmailHeaders.aspx — paste a raw email header and it shows pass/fail for all three.

**After sending a real email:**
Check the email headers in your mail client (Gmail: "Show original", Outlook: "View message source"). Look for:

```
Authentication-Results: mx.google.com;
  dkim=pass header.i=@yourdomain.com;
  spf=pass smtp.mailfrom=yourdomain.com;
  dmarc=pass (p=none) action=none header.from=yourdomain.com
```

All three showing `pass` means the setup is complete and correct.

---

## 6. Email Flows After Setup

Once `FROM_EMAIL`, `APP_URL`, and domain verification are complete, all email flows become fully functional:

| Flow | Recipient | Trigger |
|---|---|---|
| Email verification | New org admin | `POST /register-org` |
| Password reset | Any user | `POST /forgot-password` |
| Welcome | New user | `POST /register` |
| Document upload notification | Project members | Document uploaded |
| Review requested | Assigned reviewers | Document submitted for review |
| Document approved/rejected | Document owner | Workflow decision |
| Correspondence delivery | To/CC recipients | Correspondence sent |
| Task assigned | Assignee | Task created |
| Meeting invitation | Attendees | Meeting created |
| Overdue task reminder | Task owner | Scheduler (nightly) |
| Workflow stage notification | Stage assignee | Workflow advances |
