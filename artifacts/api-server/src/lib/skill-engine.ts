/**
 * Skill Engine — executes automation skills and logs results.
 *
 * Built-in skill dispatch table (triggerType:handlerType):
 *   scheduled_weekly:generate_report   → weeklyDocumentReport
 *   scheduled_daily:send_notification  → unapprovedCorrespondenceReminder
 *   scheduled_interval:send_notification → technicalDocumentReminder
 *   task_completed:change_status       → autoProjectStatusChange
 */

import { and, desc, eq, inArray, lt, notInArray, ne, sql } from "drizzle-orm";
import {
  db,
  skillDefinitionsTable, skillExecutionsTable,
  documentsTable, correspondenceTable,
  tasksTable, projectsTable, projectMembersTable, notificationsTable, usersTable,
  type SkillDefinition,
} from "@workspace/db";
import { sendEmail } from "./email.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillContext {
  triggeredByType: "cron" | "event" | "manual";
  triggeredById?: number;
  eventData?: Record<string, unknown>;
}

type SkillHandler = (skill: SkillDefinition, context: SkillContext) => Promise<unknown>;

// ─── Dispatch table ───────────────────────────────────────────────────────────

const HANDLERS: Record<string, SkillHandler> = {
  "scheduled_weekly:generate_report":    handleWeeklyDocumentReport,
  "scheduled_daily:send_notification":   handleUnapprovedCorrespondenceReminder,
  "scheduled_interval:send_notification": handleTechnicalDocumentReminder,
  "task_completed:change_status":        handleAutoProjectStatusChange,
};

// ─── Core execution ───────────────────────────────────────────────────────────

/**
 * Execute a single skill and write the result to skill_executions.
 * Never throws — captures all errors in the execution log.
 */
export async function executeSkill(skillId: number, context: SkillContext): Promise<void> {
  const [skill] = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.id, skillId))
    .limit(1);

  // Manual triggers bypass the isEnabled check so admins can test disabled skills
  if (!skill) return;
  if (!skill.isEnabled && context.triggeredByType !== "manual") return;

  // Insert a running row
  const [exec] = await db
    .insert(skillExecutionsTable)
    .values({
      skillId:         skill.id,
      organizationId:  skill.organizationId,
      triggeredByType: context.triggeredByType,
      triggeredById:   context.triggeredById ?? null,
      status:          "running",
      executedAt:      new Date(),
    })
    .returning();

  const key    = `${skill.triggerType}:${skill.handlerType}`;
  const handler = HANDLERS[key];
  const start  = Date.now();

  if (!handler) {
    await db
      .update(skillExecutionsTable)
      .set({ status: "failed", errorMessage: `No handler for key "${key}"`, durationMs: 0 })
      .where(eq(skillExecutionsTable.id, exec.id));
    return;
  }

  try {
    const result = await handler(skill, context);
    await db
      .update(skillExecutionsTable)
      .set({ status: "success", result: result as any, durationMs: Date.now() - start })
      .where(eq(skillExecutionsTable.id, exec.id));
  } catch (err: any) {
    logger.warn({ err, skillId, key }, "skill-engine: execution error");
    await db
      .update(skillExecutionsTable)
      .set({ status: "failed", errorMessage: err?.message ?? String(err), durationMs: Date.now() - start })
      .where(eq(skillExecutionsTable.id, exec.id));
  }
}

// ─── Scheduled runner (called by cron every hour) ─────────────────────────────

export async function runScheduledSkills(): Promise<void> {
  const skills = await db
    .select()
    .from(skillDefinitionsTable)
    .where(
      and(
        eq(skillDefinitionsTable.isEnabled, true),
        inArray(skillDefinitionsTable.triggerType, [
          "scheduled_daily",
          "scheduled_weekly",
          "scheduled_interval",
        ]),
      ),
    );

  for (const skill of skills) {
    const due = await isScheduledSkillDue(skill);
    if (!due) continue;

    // Fire-and-forget with error capture
    executeSkill(skill.id, { triggeredByType: "cron" }).catch((err) =>
      logger.warn({ err, skillId: skill.id }, "skill-engine: cron fire failed"),
    );
  }
}

// ─── Event trigger (called from route handlers) ───────────────────────────────

export async function triggerSkillEvent(
  eventType: "task_completed" | "document_uploaded" | "project_status_changed",
  eventData: Record<string, unknown>,
): Promise<void> {
  const orgId = eventData.organizationId as number | undefined;
  if (!orgId) return;

  const skills = await db
    .select()
    .from(skillDefinitionsTable)
    .where(
      and(
        eq(skillDefinitionsTable.isEnabled, true),
        eq(skillDefinitionsTable.triggerType, eventType),
        eq(skillDefinitionsTable.organizationId, orgId),
      ),
    );

  for (const skill of skills) {
    executeSkill(skill.id, { triggeredByType: "event", eventData }).catch((err) =>
      logger.warn({ err, skillId: skill.id, eventType }, "skill-engine: event fire failed"),
    );
  }
}

// ─── Scheduling helpers ────────────────────────────────────────────────────────

async function isScheduledSkillDue(skill: SkillDefinition): Promise<boolean> {
  const [last] = await db
    .select({ executedAt: skillExecutionsTable.executedAt })
    .from(skillExecutionsTable)
    .where(
      and(
        eq(skillExecutionsTable.skillId, skill.id),
        eq(skillExecutionsTable.status, "success"),
      ),
    )
    .orderBy(desc(skillExecutionsTable.executedAt))
    .limit(1);

  const lastMs = last?.executedAt?.getTime() ?? 0;
  const now    = Date.now();

  if (skill.triggerType === "scheduled_daily") {
    return now - lastMs > 24 * 60 * 60 * 1000;
  }

  if (skill.triggerType === "scheduled_weekly") {
    const cfg       = skill.config as { dayOfWeek?: number };
    const dayOfWeek = cfg.dayOfWeek ?? 1; // 1 = Monday
    if (new Date().getDay() !== dayOfWeek) return false;
    return now - lastMs > 6 * 24 * 60 * 60 * 1000; // at least 6d gap (avoid double-fire same day)
  }

  if (skill.triggerType === "scheduled_interval") {
    const cfg        = skill.config as { intervalDays?: number };
    const intervalMs = (cfg.intervalDays ?? 2) * 24 * 60 * 60 * 1000;
    return now - lastMs > intervalMs;
  }

  return false;
}

// ─── Skill helpers ─────────────────────────────────────────────────────────────

async function resolveRecipients(
  recipientIds: number[],
): Promise<Array<{ id: number; email: string; name: string }>> {
  if (!recipientIds.length) return [];
  const users = await db
    .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(inArray(usersTable.id, recipientIds));
  return users.map((u) => ({ id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }));
}

async function insertNotification(
  userId: number,
  title: string,
  message: string,
  entityType = "skill",
  entityId?: number,
): Promise<void> {
  await db.insert(notificationsTable).values({
    userId,
    type: "system" as const,
    title,
    message,
    entityType,
    entityId,
  });
}

// ─── Handler 1: Weekly Document Report ────────────────────────────────────────

interface WeeklyReportConfig {
  dayOfWeek?: number;
  timeOfDay?: string;
  recipients?: number[];
  projectIds?: number[];
}

async function handleWeeklyDocumentReport(
  skill: SkillDefinition,
  _context: SkillContext,
): Promise<unknown> {
  const cfg = skill.config as WeeklyReportConfig;
  const recipientIds = cfg.recipients ?? [];
  const orgId        = skill.organizationId;

  // Query: count documents per project per status
  const rows = await db
    .select({
      projectId:   documentsTable.projectId,
      projectName: projectsTable.name,
      status:      documentsTable.status,
      count:        sql<number>`count(*)`.as("count"),
    })
    .from(documentsTable)
    .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(documentsTable.organizationId, orgId),
        cfg.projectIds?.length
          ? inArray(documentsTable.projectId, cfg.projectIds as number[])
          : undefined,
      ),
    )
    .groupBy(documentsTable.projectId, projectsTable.name, documentsTable.status);

  // Pivot into { projectId → { projectName, statusCounts } }
  const byProject = new Map<
    number,
    { projectName: string; counts: Record<string, number> }
  >();
  for (const row of rows) {
    const pid = row.projectId ?? 0;
    if (!byProject.has(pid)) byProject.set(pid, { projectName: row.projectName ?? "(No project)", counts: {} });
    byProject.get(pid)!.counts[row.status] = Number(row.count);
  }

  if (!byProject.size) return { message: "No documents found", recipients: recipientIds.length };

  const recipients = await resolveRecipients(recipientIds);
  const weekStr    = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // Build email HTML
  let rows_html = "";
  for (const [, p] of byProject) {
    const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
    rows_html += `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${p.projectName}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.counts["draft"] ?? 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.counts["under_review"] ?? 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${(p.counts["approved"] ?? 0) + (p.counts["approved_with_comments"] ?? 0)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.counts["for_revision"] ?? 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;">${total}</td>
      </tr>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;">
      <h2 style="color:#1e40af;">📋 Weekly Document Report</h2>
      <p style="color:#6b7280;">${weekStr}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px;text-align:left;">Project</th>
            <th style="padding:10px;text-align:center;">Draft</th>
            <th style="padding:10px;text-align:center;">Under Review</th>
            <th style="padding:10px;text-align:center;">Approved</th>
            <th style="padding:10px;text-align:center;">For Revision</th>
            <th style="padding:10px;text-align:center;">Total</th>
          </tr>
        </thead>
        <tbody>${rows_html}</tbody>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated report from ArcScale EDMS.</p>
    </div>`;

  const emailAddresses = recipients.map((r) => r.email).filter(Boolean);
  if (emailAddresses.length) {
    await sendEmail(emailAddresses, `Weekly Document Report — ${weekStr}`, html).catch(() => {});
  }

  // In-app notifications
  for (const r of recipients) {
    await insertNotification(r.id, "Weekly Document Report", `Your weekly document report is ready. ${byProject.size} project(s) included.`);
  }

  return { projectCount: byProject.size, recipientCount: recipients.length };
}

// ─── Handler 2: Unapproved Correspondence Reminder ────────────────────────────

interface UnapprovedCorrConfig {
  checkAfterHours?: number;
  recipients?: number[];
  repeatDaily?: boolean;
}

async function handleUnapprovedCorrespondenceReminder(
  skill: SkillDefinition,
  _context: SkillContext,
): Promise<unknown> {
  const cfg          = skill.config as UnapprovedCorrConfig;
  const hoursAgo     = cfg.checkAfterHours ?? 48;
  const recipientIds = cfg.recipients ?? [];
  const orgId        = skill.organizationId;

  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  // Find correspondence not yet responded or closed, older than cutoff
  const pending = await db
    .select({ id: correspondenceTable.id, subject: correspondenceTable.subject, createdAt: correspondenceTable.createdAt })
    .from(correspondenceTable)
    .where(
      and(
        eq(correspondenceTable.organizationId, orgId),
        notInArray(correspondenceTable.status, ["responded", "closed"]),
        lt(correspondenceTable.createdAt, cutoff),
      ),
    );

  if (!pending.length) return { pendingCount: 0, message: "No pending correspondence" };

  const recipients = await resolveRecipients(recipientIds);
  const listText   = pending.slice(0, 10).map((c) => `<li>${c.subject} (since ${c.createdAt.toLocaleDateString()})</li>`).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#dc2626;">⚠️ Unapproved Correspondence Reminder</h2>
      <p>The following <strong>${pending.length}</strong> correspondence item(s) have been pending for more than ${hoursAgo} hours:</p>
      <ul style="color:#374151;">${listText}${pending.length > 10 ? `<li>...and ${pending.length - 10} more</li>` : ""}</ul>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Automated reminder from ArcScale EDMS.</p>
    </div>`;

  const emailAddresses = recipients.map((r) => r.email).filter(Boolean);
  if (emailAddresses.length) {
    await sendEmail(emailAddresses, `Reminder: ${pending.length} Correspondence Pending Action`, html).catch(() => {});
  }

  for (const r of recipients) {
    await insertNotification(r.id, "Correspondence Pending Action", `${pending.length} correspondence item(s) have been pending for over ${hoursAgo} hours.`);
  }

  return { pendingCount: pending.length, recipientCount: recipients.length };
}

// ─── Handler 3: Technical Document Reminder ───────────────────────────────────

interface TechDocConfig {
  intervalDays?: number;
  documentTypes?: string[];
  recipients?: number[];
}

async function handleTechnicalDocumentReminder(
  skill: SkillDefinition,
  _context: SkillContext,
): Promise<unknown> {
  const cfg          = skill.config as TechDocConfig;
  const intervalDays = cfg.intervalDays ?? 2;
  const docTypes     = cfg.documentTypes ?? [];
  const recipientIds = cfg.recipients ?? [];
  const orgId        = skill.organizationId;

  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

  const pending = await db
    .select({ id: documentsTable.id, title: documentsTable.title, documentType: documentsTable.documentType, updatedAt: documentsTable.updatedAt })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.organizationId, orgId),
        eq(documentsTable.status, "under_review"),
        lt(documentsTable.updatedAt, cutoff),
        docTypes.length ? inArray(documentsTable.documentType, docTypes) : undefined,
      ),
    );

  if (!pending.length) return { pendingCount: 0, message: "No pending technical documents" };

  const recipients = await resolveRecipients(recipientIds);
  const listText   = pending.slice(0, 10).map(
    (d) => `<li>${d.title} (${d.documentType ?? "—"}, since ${d.updatedAt.toLocaleDateString()})</li>`,
  ).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#d97706;">📄 Technical Document Review Reminder</h2>
      <p>The following <strong>${pending.length}</strong> document(s) have been pending review for more than ${intervalDays} day(s):</p>
      <ul style="color:#374151;">${listText}${pending.length > 10 ? `<li>...and ${pending.length - 10} more</li>` : ""}</ul>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Automated reminder from ArcScale EDMS.</p>
    </div>`;

  const emailAddresses = recipients.map((r) => r.email).filter(Boolean);
  if (emailAddresses.length) {
    await sendEmail(emailAddresses, `Reminder: ${pending.length} Document(s) Pending Review`, html).catch(() => {});
  }

  for (const r of recipients) {
    await insertNotification(r.id, "Documents Pending Review", `${pending.length} document(s) have been pending review for over ${intervalDays} day(s).`);
  }

  return { pendingCount: pending.length, recipientCount: recipients.length };
}

// ─── Handler 4: Auto Project Status Change ────────────────────────────────────

async function handleAutoProjectStatusChange(
  skill: SkillDefinition,
  context: SkillContext,
): Promise<unknown> {
  const projectId = context.eventData?.projectId as number | undefined;
  if (!projectId) return { skipped: true, reason: "No projectId in event data" };

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project || project.organizationId !== skill.organizationId) return { skipped: true };

  const results: string[] = [];

  // Rule 1: All tasks completed → mark project completed
  if (project.status !== "completed" && project.status !== "cancelled") {
    const allTasks = await db
      .select({ id: tasksTable.id, status: tasksTable.status })
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), ne(tasksTable.status, "cancelled")));

    if (allTasks.length > 0 && allTasks.every((t) => t.status === "completed")) {
      await db
        .update(projectsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));

      results.push("Project marked as completed (all tasks done)");

      // Notify project managers (role = 'manager' or 'project_manager' in project_members)
      const managers = await db
        .select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(
          and(
            eq(projectMembersTable.projectId, projectId),
            inArray(projectMembersTable.role as any, ["manager", "project_manager", "owner"]),
          ),
        );
      for (const m of managers) {
        await insertNotification(
          m.userId,
          `Project completed: ${project.name}`,
          `All tasks in project "${project.name}" are complete — project status set to Completed.`,
          "project",
          project.id,
        );
      }
    }
  }

  // Rule 2: Past end date + still active → set to on_hold + notify project members
  if (
    project.endDate &&
    new Date(project.endDate) < new Date() &&
    project.status === "active"
  ) {
    await db
      .update(projectsTable)
      .set({ status: "on_hold", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));

    results.push("Project set to on_hold (past end date)");

    const managers = await db
      .select({ userId: projectMembersTable.userId })
      .from(projectMembersTable)
      .where(
        and(
          eq(projectMembersTable.projectId, projectId),
          inArray(projectMembersTable.role as any, ["manager", "project_manager", "owner"]),
        ),
      );
    for (const m of managers) {
      await insertNotification(
        m.userId,
        `Project overdue: ${project.name}`,
        `Project "${project.name}" has passed its end date and has been put on hold.`,
        "project",
        project.id,
      );
    }
  }

  return { projectId, actions: results };
}
