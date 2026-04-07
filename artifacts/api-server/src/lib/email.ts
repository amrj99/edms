import { Resend } from "resend";

// ─── Transport ────────────────────────────────────────────────────────────────
// Email is sent via Resend (RESEND_API_KEY env var).
// If the key is absent the service logs and skips — no silent data loss.

const FROM = "ArcScale EDMS <onboarding@resend.dev>";
export const APP_URL = process.env.APP_URL ?? "https://your-edms.replit.app";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ─── Generic Send ─────────────────────────────────────────────────────────────
export async function sendEmail(to: string | string[], subject: string, html: string, text?: string) {
  const client = getResend();
  if (!client) {
    console.info(`[email] RESEND_API_KEY not configured — skipping email to ${Array.isArray(to) ? to.join(", ") : to}: ${subject}`);
    return { skipped: true };
  }
  try {
    const toArr = Array.isArray(to) ? to : [to];
    const { data, error } = await client.emails.send({
      from: FROM,
      to: toArr,
      subject,
      html,
      ...(text && { text }),
    });
    if (error) {
      console.error(`[email] Resend error for "${subject}":`, error.message);
      return { sent: false, error: error.message };
    }
    console.info(`[email] sent via Resend to ${toArr.join(", ")}: ${subject} (id=${data?.id})`);
    return { sent: true, id: data?.id };
  } catch (err: any) {
    console.error(`[email] send failed: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── Base HTML Layout ─────────────────────────────────────────────────────────
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

// ─── Welcome ──────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  organizationName?: string;
}) {
  const html = baseLayout(`
    <h2>Welcome to ArcScale EDMS!</h2>
    <p>Hi ${opts.firstName}, your account has been created${opts.organizationName ? ` for <strong>${opts.organizationName}</strong>` : ""}. You can now log in and start managing your engineering documents.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Platform</span><span class="value">ArcScale EDMS</span></div>
      ${opts.organizationName ? `<div class="info-row"><span class="label">Organization</span><span class="value">${opts.organizationName}</span></div>` : ""}
    </div>
    <a class="btn" href="${APP_URL}">Log In to EDMS →</a>
    <p style="color:#6b7280;font-size:13px;">If you did not create this account, please ignore this email.</p>
  `, "Welcome to ArcScale EDMS");

  return sendEmail(opts.to, "Welcome to ArcScale EDMS", html);
}

// ─── Password Reset ───────────────────────────────────────────────────────────
export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetUrl: string;
}) {
  const html = baseLayout(`
    <h2>Reset Your Password</h2>
    <p>Hi ${opts.firstName}, we received a request to reset your ArcScale EDMS password.</p>
    <a class="btn" href="${opts.resetUrl}">Reset Password →</a>
    <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour. If you did not request a password reset, please ignore this email — your password will remain unchanged.</p>
  `, "Reset Your Password");

  return sendEmail(opts.to, "Reset your ArcScale EDMS password", html);
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

// ─── Document Uploaded ────────────────────────────────────────────────────────
export async function sendDocumentUploadedEmail(opts: {
  to: string | string[];
  documentNumber: string;
  documentTitle: string;
  revision: string;
  uploadedBy: string;
  projectName: string;
  documentType?: string;
  discipline?: string;
  projectId: number;
}) {
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>New Document Uploaded</h2>
    <p>A new document has been uploaded to <strong>${opts.projectName}</strong> by <strong>${opts.uploadedBy}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document Number</span><span class="value">${opts.documentNumber}</span></div>
      <div class="info-row"><span class="label">Title</span><span class="value">${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Revision</span><span class="value">${opts.revision}</span></div>
      ${opts.documentType ? `<div class="info-row"><span class="label">Type</span><span class="value">${opts.documentType}</span></div>` : ""}
      ${opts.discipline ? `<div class="info-row"><span class="label">Discipline</span><span class="value">${opts.discipline}</span></div>` : ""}
      <div class="info-row"><span class="label">Status</span><span class="value"><span class="badge badge-gray">Draft</span></span></div>
    </div>
    <a class="btn" href="${url}">View Document →</a>
  `, "New Document Uploaded");

  return sendEmail(opts.to, `[Uploaded] ${opts.documentNumber} — ${opts.documentTitle}`, html);
}

// ─── Correspondence Received ──────────────────────────────────────────────────
export async function sendCorrespondenceReceivedEmail(opts: {
  to: string | string[];
  subject: string;
  correspondenceType: string;
  senderName: string;
  priority?: string;
  projectName?: string;
  referenceNumber?: string;
  projectId: number;
}) {
  const priorityBadge: Record<string, string> = {
    high: '<span class="badge badge-red">High</span>',
    medium: '<span class="badge badge-blue">Medium</span>',
    low: '<span class="badge badge-gray">Low</span>',
  };
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>New Correspondence Received</h2>
    <p>You have received new correspondence from <strong>${opts.senderName}</strong>.</p>
    <div class="info-box">
      ${opts.referenceNumber ? `<div class="info-row"><span class="label">Reference</span><span class="value">${opts.referenceNumber}</span></div>` : ""}
      <div class="info-row"><span class="label">Subject</span><span class="value">${opts.subject}</span></div>
      <div class="info-row"><span class="label">Type</span><span class="value">${opts.correspondenceType.replace(/_/g, " ")}</span></div>
      ${opts.projectName ? `<div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>` : ""}
      ${opts.priority ? `<div class="info-row"><span class="label">Priority</span><span class="value">${priorityBadge[opts.priority] ?? opts.priority}</span></div>` : ""}
    </div>
    <a class="btn" href="${url}">View Correspondence →</a>
  `, "New Correspondence Received");

  return sendEmail(opts.to, `[Correspondence] ${opts.subject}`, html);
}

// ─── Meeting Created ──────────────────────────────────────────────────────────
export async function sendMeetingCreatedEmail(opts: {
  to: string | string[];
  meetingTitle: string;
  organizerName: string;
  meetingDate: string;
  location?: string;
  meetingLink?: string;
  projectName?: string;
  referenceNumber?: string;
  agenda?: string;
}) {
  const html = baseLayout(`
    <h2>Meeting Invitation</h2>
    <p>You have been invited to a meeting by <strong>${opts.organizerName}</strong>.</p>
    <div class="info-box">
      ${opts.referenceNumber ? `<div class="info-row"><span class="label">Reference</span><span class="value">${opts.referenceNumber}</span></div>` : ""}
      <div class="info-row"><span class="label">Title</span><span class="value">${opts.meetingTitle}</span></div>
      <div class="info-row"><span class="label">Date</span><span class="value">${opts.meetingDate}</span></div>
      ${opts.location ? `<div class="info-row"><span class="label">Location</span><span class="value">${opts.location}</span></div>` : ""}
      ${opts.meetingLink ? `<div class="info-row"><span class="label">Link</span><span class="value"><a href="${opts.meetingLink}">${opts.meetingLink}</a></span></div>` : ""}
      ${opts.projectName ? `<div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>` : ""}
    </div>
    ${opts.agenda ? `<p style="color:#374151;"><strong>Agenda:</strong> ${opts.agenda}</p>` : ""}
    <a class="btn" href="${APP_URL}/meetings">View Meeting →</a>
  `, "Meeting Invitation");

  return sendEmail(opts.to, `[Meeting] ${opts.meetingTitle}`, html);
}

// ─── Action Item Assigned ─────────────────────────────────────────────────────
export async function sendActionItemAssignedEmail(opts: {
  to: string;
  assigneeName: string;
  assignerName: string;
  actionItemTitle: string;
  meetingTitle: string;
  dueDate?: string;
  priority?: string;
}) {
  const priorityBadge: Record<string, string> = {
    high: '<span class="badge badge-red">High</span>',
    medium: '<span class="badge badge-blue">Medium</span>',
    low: '<span class="badge badge-gray">Low</span>',
  };
  const html = baseLayout(`
    <h2>Action Item Assigned</h2>
    <p>Hi ${opts.assigneeName}, <strong>${opts.assignerName}</strong> assigned you an action item from a meeting.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Action Item</span><span class="value">${opts.actionItemTitle}</span></div>
      <div class="info-row"><span class="label">Meeting</span><span class="value">${opts.meetingTitle}</span></div>
      ${opts.priority ? `<div class="info-row"><span class="label">Priority</span><span class="value">${priorityBadge[opts.priority] ?? opts.priority}</span></div>` : ""}
      ${opts.dueDate ? `<div class="info-row"><span class="label">Due Date</span><span class="value">${opts.dueDate}</span></div>` : ""}
    </div>
    <a class="btn" href="${APP_URL}/meetings">View Action Items →</a>
    <p style="color:#6b7280;font-size:13px;">Please complete this action item by the due date and update its status in EDMS.</p>
  `, "Action Item Assigned");

  return sendEmail(opts.to, `[Action Item] ${opts.actionItemTitle}`, html);
}

// ─── Record Submitted (ITR / NCR / NOC) ───────────────────────────────────────
export async function sendRecordSubmittedEmail(opts: {
  to: string | string[];
  recordType: "ITR" | "NCR" | "NOC";
  recordNumber: string;
  submittedByName: string;
  projectName: string;
  description?: string;
  projectId: number;
}) {
  const typeLabels: Record<string, string> = {
    ITR: "Inspection Test Request",
    NCR: "Non-Conformance Report",
    NOC: "Notice of Commencement",
  };
  const url = `${APP_URL}/projects/${opts.projectId}`;
  const html = baseLayout(`
    <h2>${typeLabels[opts.recordType] ?? opts.recordType} Submitted</h2>
    <p>A <strong>${typeLabels[opts.recordType] ?? opts.recordType}</strong> has been submitted for review in <strong>${opts.projectName}</strong> by <strong>${opts.submittedByName}</strong>.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Record Number</span><span class="value">${opts.recordNumber}</span></div>
      <div class="info-row"><span class="label">Type</span><span class="value">${typeLabels[opts.recordType] ?? opts.recordType}</span></div>
      <div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>
      <div class="info-row"><span class="label">Status</span><span class="value"><span class="badge badge-blue">Pending Review</span></span></div>
      ${opts.description ? `<div class="info-row"><span class="label">Description</span><span class="value">${opts.description}</span></div>` : ""}
    </div>
    <a class="btn" href="${url}">Review Record →</a>
  `, `${opts.recordType} Submitted`);

  return sendEmail(opts.to, `[${opts.recordType}] ${opts.recordNumber} submitted for review`, html);
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

// ─── Generic Notification ─────────────────────────────────────────────────────
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

// ─── Task Assigned ────────────────────────────────────────────────────────────
export async function sendTaskAssignedEmail(opts: {
  to: string;
  assigneeName: string;
  assignerName: string;
  taskTitle: string;
  taskDescription?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  projectName?: string | null;
  taskLink: string;
}) {
  const priorityBadge: Record<string, string> = {
    high: '<span class="badge badge-red">High</span>',
    medium: '<span class="badge badge-blue">Medium</span>',
    low: '<span class="badge badge-gray">Low</span>',
  };

  const html = baseLayout(
    `
    <h2>You have been assigned a task</h2>
    <p>Hi ${opts.assigneeName}, <strong>${opts.assignerName}</strong> assigned you a new task.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Task</span><span class="value">${opts.taskTitle}</span></div>
      ${opts.projectName ? `<div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>` : ""}
      ${opts.priority ? `<div class="info-row"><span class="label">Priority</span><span class="value">${priorityBadge[opts.priority] ?? opts.priority}</span></div>` : ""}
      ${opts.dueDate ? `<div class="info-row"><span class="label">Due Date</span><span class="value">${opts.dueDate}</span></div>` : ""}
    </div>
    ${opts.taskDescription ? `<p style="color:#374151;">${opts.taskDescription}</p>` : ""}
    <a class="btn" href="${opts.taskLink}">View Task →</a>
  `,
    "New Task Assigned",
  );
  return sendEmail(opts.to, `[Task] ${opts.taskTitle}`, html);
}

// ─── Overdue Task Reminder ────────────────────────────────────────────────────
export async function sendOverdueTaskEmail(opts: {
  to: string;
  userName: string;
  taskTitle: string;
  taskType: "task" | "action_item";
  dueDate: string;
  projectName?: string | null;
  taskLink: string;
}) {
  const label = opts.taskType === "action_item" ? "Meeting Action Item" : "Task";
  const html = baseLayout(
    `
    <h2>${label} Overdue</h2>
    <p>Hi ${opts.userName}, the following ${label.toLowerCase()} is past its due date and still open.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">${label}</span><span class="value">${opts.taskTitle}</span></div>
      ${opts.projectName ? `<div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>` : ""}
      <div class="info-row"><span class="label">Due Date</span><span class="value" style="color:#dc2626;">${opts.dueDate}</span></div>
    </div>
    <a class="btn btn-danger" href="${opts.taskLink}">View &amp; Update →</a>
    <p style="color:#6b7280;font-size:13px;">Please update the status or reach out to your team lead if you need assistance.</p>
  `,
    `Overdue ${label}`,
  );
  return sendEmail(opts.to, `[Overdue] ${opts.taskTitle}`, html);
}

// ─── Workflow Approval Request ────────────────────────────────────────────────
export async function sendWorkflowApprovalEmail(opts: {
  to: string | string[];
  reviewerName: string;
  submitterName: string;
  documentNumber: string;
  documentTitle: string;
  revision: string;
  projectName: string;
  comment?: string | null;
  reviewLink: string;
}) {
  const html = baseLayout(
    `
    <h2>Document Approval Required</h2>
    <p>Hi ${opts.reviewerName}, <strong>${opts.submitterName}</strong> has requested your approval on a document.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document</span><span class="value">${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Number</span><span class="value">${opts.documentNumber}</span></div>
      <div class="info-row"><span class="label">Revision</span><span class="value">${opts.revision}</span></div>
      <div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>
    </div>
    ${opts.comment ? `<p style="color:#374151;"><strong>Comment:</strong> ${opts.comment}</p>` : ""}
    <a class="btn" href="${opts.reviewLink}">Review Document →</a>
    <p style="color:#6b7280;font-size:13px;">Please review and approve or reject this document at your earliest convenience.</p>
  `,
    "Document Approval Required",
  );
  return sendEmail(opts.to, `[Approval] ${opts.documentNumber} — ${opts.documentTitle}`, html);
}

// ─── Workflow Stage Notification ──────────────────────────────────────────────
export async function sendWorkflowStageEmail(opts: {
  to: string | string[];
  stageName: string;
  stageRole?: string;
  documentTitle: string;
  documentNumber: string;
  workflowName: string;
  submittedByName: string;
  comment?: string;
  projectName?: string;
  instanceId: number;
}) {
  const url = `${APP_URL}/workflow-engine`;
  const html = baseLayout(`
    <h2>Workflow Action Required</h2>
    <p>A document has reached <strong>${opts.stageName}</strong>${opts.stageRole ? ` (${opts.stageRole})` : ""} and requires your approval.</p>
    <div class="info-box">
      <div class="info-row"><span class="label">Document</span><span class="value">${opts.documentNumber} — ${opts.documentTitle}</span></div>
      <div class="info-row"><span class="label">Workflow</span><span class="value">${opts.workflowName}</span></div>
      <div class="info-row"><span class="label">Current Stage</span><span class="value"><span class="badge badge-blue">${opts.stageName}</span></span></div>
      ${opts.stageRole ? `<div class="info-row"><span class="label">Responsible</span><span class="value">${opts.stageRole}</span></div>` : ""}
      ${opts.projectName ? `<div class="info-row"><span class="label">Project</span><span class="value">${opts.projectName}</span></div>` : ""}
      ${opts.submittedByName ? `<div class="info-row"><span class="label">Moved by</span><span class="value">${opts.submittedByName}</span></div>` : ""}
      ${opts.comment ? `<div class="info-row"><span class="label">Comment</span><span class="value">${opts.comment}</span></div>` : ""}
    </div>
    <a class="btn" href="${url}">Review in Workflow Dashboard →</a>
    <p style="color:#6b7280;font-size:13px;">Please log in to ArcScale EDMS to review and take action on this document.</p>
  `, "Workflow Action Required");

  return sendEmail(opts.to, `[Workflow] Action required — ${opts.documentNumber} at ${opts.stageName}`, html);
}

// ─── Email / Resend Connection Test ──────────────────────────────────────────
export async function testSmtpConnection(): Promise<{ success: boolean; message: string }> {
  const client = getResend();
  if (!client) {
    return { success: false, message: "RESEND_API_KEY is not configured. Add it to your environment secrets." };
  }
  try {
    // Resend doesn't have a verify() endpoint, so we probe the domains list as a lightweight check
    const { error } = await client.domains.list();
    if (error) return { success: false, message: `Resend API error: ${error.message}` };
    return { success: true, message: "Resend connection verified successfully." };
  } catch (err: any) {
    return { success: false, message: `Resend connection failed: ${err.message}` };
  }
}
