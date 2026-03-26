import nodemailer from "nodemailer";

// ─── SMTP Configuration ──────────────────────────────────────────────────────
// Configure via environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
// If not configured the service silently skips sending (dev mode).

function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

const FROM = process.env.SMTP_FROM ?? "noreply@edms.local";
const APP_URL = process.env.APP_URL ?? "https://your-edms.replit.app";

// ─── Generic Send ─────────────────────────────────────────────────────────────
export async function sendEmail(to: string | string[], subject: string, html: string, text?: string) {
  const transport = createTransport();
  if (!transport) {
    console.info(`[email] SMTP not configured — skipping email to ${Array.isArray(to) ? to.join(", ") : to}: ${subject}`);
    return { skipped: true };
  }
  try {
    const info = await transport.sendMail({ from: FROM, to, subject, html, text: text ?? subject });
    console.info(`[email] sent to ${Array.isArray(to) ? to.join(", ") : to}: ${subject} (${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err: any) {
    console.error(`[email] failed to send to ${to}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────
function baseLayout(content: string, title: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1e40af; color: #fff; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.8; }
    .body { padding: 32px; color: #374151; line-height: 1.6; }
    .body h2 { font-size: 18px; margin: 0 0 16px; color: #111827; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
    .info-row:last-child { border-bottom: none; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: 500; color: #111827; }
    .btn { display: inline-block; background: #1e40af; color: #fff !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 16px 0; }
    .btn-success { background: #059669; }
    .btn-danger { background: #dc2626; }
    .footer { padding: 16px 32px; background: #f8fafc; color: #9ca3af; font-size: 12px; text-align: center; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-gray { background: #f3f4f6; color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ArcScale EDMS</h1>
      <p>Engineering Document Management System</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">This is an automated notification from ArcScale EDMS. Please do not reply to this email.<br />
    <a href="${APP_URL}" style="color:#6b7280;">${APP_URL}</a></div>
  </div>
</body>
</html>`;
}

// ─── Review Submitted ─────────────────────────────────────────────────────────
export async function sendReviewSubmittedEmail(opts: {
  to: string[];
  documentNumber: string;
  documentTitle: string;
  revision: string;
  submittedBy: string;
  projectName: string;
  comment?: string;
  projectId: number;
  documentId: number;
}) {
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>Document Submitted for Review</h2>
    <p>A document has been submitted for your review in <strong>${opts.projectName}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document Number</span><span class="value">${opts.documentNumber}</span></div>
      <div class="info-row"><span class="label">Title</span><span class="value">${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Revision</span><span class="value">${opts.revision}</span></div>
      <div class="info-row"><span class="label">Submitted by</span><span class="value">${opts.submittedBy}</span></div>
      <div class="info-row"><span class="label">Status</span><span class="value"><span class="badge badge-blue">Under Review</span></span></div>
      ${opts.comment ? `<div class="info-row"><span class="label">Note</span><span class="value">${opts.comment}</span></div>` : ""}
    </div>
    <a class="btn" href="${url}">Review Document →</a>
    <p style="color:#6b7280;font-size:13px;">Click the button above to open the document in EDMS and submit your review.</p>
  `, "Document Submitted for Review");

  return sendEmail(opts.to, `[Review Required] ${opts.documentNumber} — ${opts.documentTitle}`, html);
}

// ─── Document Approved ────────────────────────────────────────────────────────
export async function sendDocumentApprovedEmail(opts: {
  to: string;
  documentNumber: string;
  documentTitle: string;
  revision: string;
  approvedBy: string;
  projectName: string;
  comment?: string;
  projectId: number;
}) {
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>Document Approved ✓</h2>
    <p>Your document has been <strong>approved</strong> in <strong>${opts.projectName}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document Number</span><span class="value">${opts.documentNumber}</span></div>
      <div class="info-row"><span class="label">Title</span><span class="value">${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Revision</span><span class="value">${opts.revision}</span></div>
      <div class="info-row"><span class="label">Approved by</span><span class="value">${opts.approvedBy}</span></div>
      <div class="info-row"><span class="label">Status</span><span class="value"><span class="badge badge-green">Approved</span></span></div>
      ${opts.comment ? `<div class="info-row"><span class="label">Comment</span><span class="value">${opts.comment}</span></div>` : ""}
    </div>
    <a class="btn btn-success" href="${url}">View Document →</a>
  `, "Document Approved");

  return sendEmail(opts.to, `[Approved] ${opts.documentNumber} — ${opts.documentTitle}`, html);
}

// ─── Document Rejected ────────────────────────────────────────────────────────
export async function sendDocumentRejectedEmail(opts: {
  to: string;
  documentNumber: string;
  documentTitle: string;
  revision: string;
  rejectedBy: string;
  projectName: string;
  comment?: string;
  projectId: number;
}) {
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>Document Rejected — Action Required</h2>
    <p>Your document has been <strong>rejected</strong> and requires revision in <strong>${opts.projectName}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document Number</span><span class="value">${opts.documentNumber}</span></div>
      <div class="info-row"><span class="label">Title</span><span class="value">${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Revision</span><span class="value">${opts.revision}</span></div>
      <div class="info-row"><span class="label">Rejected by</span><span class="value">${opts.rejectedBy}</span></div>
      <div class="info-row"><span class="label">Status</span><span class="value"><span class="badge badge-red">Rejected</span></span></div>
      ${opts.comment ? `<div class="info-row"><span class="label">Reason</span><span class="value">${opts.comment}</span></div>` : ""}
    </div>
    <a class="btn btn-danger" href="${url}">Revise &amp; Resubmit →</a>
    <p style="color:#6b7280;font-size:13px;">Please address the reviewer's comments and resubmit the document for review.</p>
  `, "Document Rejected");

  return sendEmail(opts.to, `[Rejected] ${opts.documentNumber} — ${opts.documentTitle}`, html);
}

// ─── Transmittal Sent ─────────────────────────────────────────────────────────
export async function sendTransmittalEmail(opts: {
  to: string | string[];
  transmittalNumber: string;
  subject: string;
  purpose: string;
  fromName: string;
  projectName: string;
  description?: string;
  dueDate?: string;
  accessLink: string;
}) {
  const html = baseLayout(`
    <h2>New Transmittal Received</h2>
    <p>You have received a new transmittal from <strong>${opts.fromName}</strong> at <strong>${opts.projectName}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Transmittal No.</span><span class="value">${opts.transmittalNumber}</span></div>
      <div class="info-row"><span class="label">Subject</span><span class="value">${opts.subject}</span></div>
      <div class="info-row"><span class="label">Purpose</span><span class="value">${opts.purpose.replace(/_/g, " ")}</span></div>
      <div class="info-row"><span class="label">From</span><span class="value">${opts.fromName}</span></div>
      ${opts.dueDate ? `<div class="info-row"><span class="label">Response Required By</span><span class="value">${opts.dueDate}</span></div>` : ""}
    </div>
    ${opts.description ? `<p style="color:#374151;">${opts.description}</p>` : ""}
    <a class="btn" href="${opts.accessLink}">View &amp; Acknowledge Transmittal →</a>
    <p style="color:#6b7280;font-size:13px;">Please review the attached transmittal and acknowledge receipt using the link above.</p>
  `, "New Transmittal");

  return sendEmail(opts.to, `[Transmittal] ${opts.transmittalNumber} — ${opts.subject}`, html);
}

// ─── Notification Email ───────────────────────────────────────────────────────
export async function sendNotificationEmail(opts: {
  to: string;
  title: string;
  message: string;
  link?: string;
  linkLabel?: string;
}) {
  const html = baseLayout(`
    <h2>${opts.title}</h2>
    <p>${opts.message}</p>
    ${opts.link ? `<a class="btn" href="${opts.link}">${opts.linkLabel ?? "View in EDMS →"}</a>` : ""}
  `, opts.title);

  return sendEmail(opts.to, `[EDMS] ${opts.title}`, html);
}

// ─── SMTP Config Test ─────────────────────────────────────────────────────────
export async function testSmtpConnection(): Promise<{ success: boolean; message: string }> {
  const transport = createTransport();
  if (!transport) {
    return { success: false, message: "SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables." };
  }
  try {
    await transport.verify();
    return { success: true, message: "SMTP connection verified successfully." };
  } catch (err: any) {
    return { success: false, message: `SMTP connection failed: ${err.message}` };
  }
}
