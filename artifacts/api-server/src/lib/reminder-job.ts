// Due-date & workflow-SLA reminder job — extracted from app.ts (Phase: app/bootstrap separation).
// DEBT-010 Category-A: this job runs from a timer with NO request context, so a bare
// `db` would hit the pool with no RLS tenant context and (under the non-superuser
// edms_app role) RLS tables would return zero rows. It is therefore restructured to
// run PER ORG inside `withSystemTenantTx(orgId, …)` so RLS is enforced, WITHOUT
// changing which reminders get sent. External email I/O is collected inside each
// org's tx and sent AFTER that tx commits (never awaited while the tx is open).
import { db, withSystemTenantTx } from "@workspace/db";
import {
  tasksTable, meetingActionItemsTable, meetingsTable, notificationsTable, usersTable, projectsTable,
  wfInstancesTable, wfTemplateStagesTable, organizationsTable,
} from "@workspace/db";
import { and, eq, lt, isNotNull, sql, ne } from "drizzle-orm";
import { sendOverdueTaskEmail, sendWorkflowStageEmail } from "./email.js";
import { logger } from "./logger.js";

let _lastReminderDate = "";

export async function sendDueDateReminders() {
  const today = new Date().toISOString().slice(0, 10);
  if (_lastReminderDate === today) return; // already ran today
  _lastReminderDate = today;
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // `organizations` is NON-RLS — enumerate ONCE on the bare pool, outside any
    // tenant tx. Each org is then processed in its own short tenant tx below.
    const orgs = await db.select({ id: organizationsTable.id }).from(organizationsTable);

    for (const org of orgs) {
      // A failure processing one org must NOT abort the others, and each org gets
      // its own withSystemTenantTx so no context leaks to the next org.
      try {
        await processOrgReminders(org.id, now, yesterday);
      } catch (err) {
        logger.error({ err, orgId: org.id }, "Due-date reminder job failed for organization");
      }
    }

    logger.info("Due-date reminder job completed");
  } catch (err) {
    logger.error({ err }, "Due-date reminder job failed");
  }
}

/**
 * Process all reminder scans + notification inserts for a SINGLE org inside one
 * short tenant tx (RLS enforced under edms_app). Email payloads are collected and
 * returned via the outer scope, then sent AFTER the tx commits — external I/O is
 * never awaited while the tenant tx is open.
 */
async function processOrgReminders(orgId: number, now: Date, yesterday: Date) {
  // Collected email senders — populated inside the tenant tx, flushed after commit.
  const pendingEmails: Array<() => void> = [];

  await withSystemTenantTx(orgId, async () => {
    // F7: dedup existence check via the SECURITY DEFINER helper. A direct SELECT on
    // notifications is blind here (per-user RLS + no session user), so it re-inserted
    // duplicates every run. The helper answers boolean-only, fail-closed for users
    // outside the current session org, and never mutates the caller's context.
    const alreadySent = async (
      uid: number, type: string, entityType: string, entityId: number,
    ): Promise<boolean> => {
      const r: any = await db.execute(
        sql`SELECT app.recent_notification_exists(${uid}, ${type}, ${entityType}, ${entityId}, ${yesterday}) AS found`,
      );
      const rows = Array.isArray(r) ? r : r?.rows;
      return rows?.[0]?.found === true;
    };

    // Overdue tasks with an assignee (tasks is RLS; explicit org filter added too).
    const overdueTasks = await db
      .select({ id: tasksTable.id, title: tasksTable.title, assigneeId: tasksTable.assignedToId, projectId: tasksTable.projectId })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organizationId, orgId),
        isNotNull(tasksTable.dueDate),
        lt(tasksTable.dueDate, now),
        isNotNull(tasksTable.assignedToId),
        ne(tasksTable.status, "completed"),
      ));

    for (const task of overdueTasks) {
      if (!task.assigneeId) continue;
      // Check if we already sent a reminder in the last 24h
      if (await alreadySent(task.assigneeId, "task_overdue", "task", task.id)) continue;
      await db.insert(notificationsTable).values({
        userId: task.assigneeId,
        type: "task_overdue",
        title: "Task overdue",
        message: `Your task "${task.title}" is past its due date.`,
        projectId: task.projectId,
        entityType: "task",
        entityId: task.id,
        actionUrl: `/tasks`,
      });

      // Collect overdue email to assignee (fire-and-forget AFTER the tx commits)
      const [assignee] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, task.assigneeId)).limit(1);
      const [project] = task.projectId
        ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId)).limit(1)
        : [null];
      if (assignee?.email) {
        const to = assignee.email;
        const userName = `${assignee.firstName} ${assignee.lastName}`.trim();
        const taskTitle = task.title;
        const projectName = project?.name ?? null;
        pendingEmails.push(() => {
          sendOverdueTaskEmail({
            to,
            userName,
            taskTitle,
            taskType: "task",
            dueDate: "Overdue",
            projectName,
            taskLink: `${process.env.APP_URL ?? ""}/tasks`,
          }).catch(() => {});
        });
      }
    }

    // Overdue meeting action items with an assignee.
    // meeting_action_items / meetings are NON-RLS — scope explicitly by org.
    const overdueItems = await db
      .select({
        id: meetingActionItemsTable.id,
        title: meetingActionItemsTable.title,
        assignedToId: meetingActionItemsTable.assignedToId,
        meetingId: meetingActionItemsTable.meetingId,
        projectId: meetingsTable.projectId,
      })
      .from(meetingActionItemsTable)
      .leftJoin(meetingsTable, eq(meetingActionItemsTable.meetingId, meetingsTable.id))
      .where(and(
        eq(meetingActionItemsTable.organizationId, orgId),
        isNotNull(meetingActionItemsTable.dueDate),
        lt(meetingActionItemsTable.dueDate, now),
        isNotNull(meetingActionItemsTable.assignedToId),
        ne(meetingActionItemsTable.status, "done"),
      ));

    for (const item of overdueItems) {
      if (!item.assignedToId) continue;
      if (await alreadySent(item.assignedToId, "task_overdue", "action_item", item.id)) continue;
      await db.insert(notificationsTable).values({
        userId: item.assignedToId,
        type: "task_overdue",
        title: "Action item overdue",
        message: `Meeting action item "${item.title}" is past its due date.`,
        projectId: item.projectId ?? undefined,
        entityType: "action_item",
        entityId: item.id,
        actionUrl: `/meetings`,
      });
    }

    // ─── Workflow SLA: overdue stages ─────────────────────────────────────
    // wf_instances / wf_template_stages are NON-RLS — scope by org explicitly.
    const overdueInstances = await db
      .select({
        id: wfInstancesTable.id,
        organizationId: wfInstancesTable.organizationId,
        documentId: wfInstancesTable.documentId,
        currentStageId: wfInstancesTable.currentStageId,
        stageDueAt: wfInstancesTable.stageDueAt,
      })
      .from(wfInstancesTable)
      .where(and(
        eq(wfInstancesTable.organizationId, orgId),
        eq(wfInstancesTable.status, "active"),
        isNotNull(wfInstancesTable.stageDueAt),
        lt(wfInstancesTable.stageDueAt, now),
      ));

    for (const inst of overdueInstances) {
      if (!inst.currentStageId) continue;
      const [stage] = await db.select().from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1);
      if (!stage) continue;

      // Resolve recipients: specific user or org admins/PMs
      let recipientIds: number[] = [];
      if (stage.responsibleUserId) {
        recipientIds = [stage.responsibleUserId];
      } else {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.organizationId, inst.organizationId),
            eq(usersTable.isActive, true),
            sql`${usersTable.role} IN ('admin', 'project_manager', 'system_owner')`,
          ));
        recipientIds = admins.map(a => a.id);
      }

      for (const userId of recipientIds) {
        // Dedup: skip if we sent an overdue notification for this instance in last 24h
        if (await alreadySent(userId, "workflow_action_required", "workflow", inst.id)) continue;

        await db.insert(notificationsTable).values({
          userId,
          type: "workflow_action_required",
          title: `Workflow stage overdue: ${stage.name}`,
          message: `A document workflow has exceeded its SLA deadline at stage "${stage.name}".`,
          entityType: "workflow",
          entityId: inst.id,
          actionUrl: `/workflow-engine`,
        }).catch(() => {});

        // Collect email (sent AFTER the tx commits)
        const [recipient] = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (recipient?.email) {
          const to = recipient.email;
          const stageName = `${stage.name} (OVERDUE)`;
          const stageRole = stage.responsibleRole ?? undefined;
          const documentTitle = `Document #${inst.documentId}`;
          const instanceId = inst.id;
          pendingEmails.push(() => {
            sendWorkflowStageEmail({
              to,
              stageName,
              stageRole,
              documentTitle,
              documentNumber: "",
              workflowName: `Workflow Instance #${instanceId}`,
              submittedByName: "System",
              instanceId,
            }).catch(() => {});
          });
        }
      }
    }

    // ─── Workflow SLA: upcoming reminders ─────────────────────────────────
    // Find active wf_instances where due date is within reminderDays
    // (stageDueAt - reminderDays * 86400s <= now < stageDueAt)
    const upcomingInstances = await db
      .select({
        id: wfInstancesTable.id,
        organizationId: wfInstancesTable.organizationId,
        documentId: wfInstancesTable.documentId,
        currentStageId: wfInstancesTable.currentStageId,
        stageDueAt: wfInstancesTable.stageDueAt,
      })
      .from(wfInstancesTable)
      .where(and(
        eq(wfInstancesTable.organizationId, orgId),
        eq(wfInstancesTable.status, "active"),
        isNotNull(wfInstancesTable.stageDueAt),
        sql`${wfInstancesTable.stageDueAt} > ${now}`, // not yet overdue
      ));

    for (const inst of upcomingInstances) {
      if (!inst.currentStageId || !inst.stageDueAt) continue;
      const [stage] = await db.select().from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1);
      if (!stage?.reminderDays) continue; // no reminder configured

      // Check if due date is within reminderDays
      const dueMs = new Date(inst.stageDueAt).getTime();
      const reminderWindowMs = stage.reminderDays * 24 * 60 * 60 * 1000;
      if (dueMs - now.getTime() > reminderWindowMs) continue; // too far in future

      let recipientIds: number[] = [];
      if (stage.responsibleUserId) {
        recipientIds = [stage.responsibleUserId];
      } else {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.organizationId, inst.organizationId),
            eq(usersTable.isActive, true),
            sql`${usersTable.role} IN ('admin', 'project_manager', 'system_owner')`,
          ));
        recipientIds = admins.map(a => a.id);
      }

      for (const userId of recipientIds) {
        // Dedup: skip if we already sent an SLA reminder today for this instance
        if (await alreadySent(userId, "workflow_sla_reminder", "workflow", inst.id)) continue;

        const daysLeft = Math.ceil((dueMs - now.getTime()) / (24 * 60 * 60 * 1000));
        await db.insert(notificationsTable).values({
          userId,
          type: "workflow_sla_reminder",
          title: `Workflow SLA reminder: ${stage.name}`,
          message: `Document workflow stage "${stage.name}" is due in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.`,
          entityType: "workflow",
          entityId: inst.id,
          actionUrl: `/workflow-engine`,
        }).catch(() => {});
      }
    }
  });

  // External I/O OUTSIDE the tenant tx — flush collected emails after commit.
  for (const send of pendingEmails) send();
}
