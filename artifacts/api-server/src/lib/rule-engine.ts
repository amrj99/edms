/**
 * Rule Engine — evaluates admin-defined automation rules.
 *
 * Context shape (all optional):
 *   {
 *     type: "document" | "correspondence",
 *     projectId, documentType?, discipline?,
 *     subject?, senderUserId?, orgId
 *   }
 *
 * Matching rules (priority ASC — lower number = higher priority):
 *   1. All enabled rules whose appliesTo matches the context type are fetched.
 *   2. Each rule's conditions are AND-checked against the context.
 *   3. Matching rules execute their actions in priority order.
 */

import { db } from "@workspace/db";
import { rulesTable, notificationsTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { emitToUser } from "./socket.js";
import { logger } from "./logger.js";

export interface RuleContext {
  type: "document" | "correspondence";
  orgId: number;
  projectId: number;
  documentType?: string | null;
  discipline?: string | null;
  subject?: string | null;
  senderUserId?: number;
  entityId?: number;          // id of the created doc/corr (for task/notification refs)
  entityTitle?: string;
  triggeredByUserId: number;
}

export interface RuleActionResult {
  ruleId: number;
  ruleName: string;
  actions: string[];
}

export async function evaluateRules(ctx: RuleContext): Promise<RuleActionResult[]> {
  try {
    const rules = await db.select().from(rulesTable)
      .where(and(
        eq(rulesTable.organizationId, ctx.orgId),
        eq(rulesTable.isEnabled, true),
      ))
      .orderBy(asc(rulesTable.priority));

    const matchingRules = rules.filter(rule => {
      const appliesToMatch =
        rule.appliesTo === "both" ||
        rule.appliesTo === ctx.type;
      if (!appliesToMatch) return false;

      const conditions = (rule.conditions as Record<string, unknown>) ?? {};

      if (conditions.documentType && conditions.documentType !== ctx.documentType) return false;
      if (conditions.discipline && conditions.discipline !== ctx.discipline) return false;
      if (conditions.projectId && Number(conditions.projectId) !== ctx.projectId) return false;
      if (conditions.subjectContains) {
        const needle = String(conditions.subjectContains).toLowerCase();
        const haystack = (ctx.subject ?? "").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (conditions.senderUserId && Number(conditions.senderUserId) !== ctx.senderUserId) return false;

      return true;
    });

    const results: RuleActionResult[] = [];

    for (const rule of matchingRules) {
      const actions = (rule.actions as Record<string, unknown>[]) ?? [];
      const executedActions: string[] = [];

      for (const action of actions) {
        try {
          const actionType = action.type as string;
          const config = (action.config as Record<string, unknown>) ?? {};

          if (actionType === "assign_user") {
            const userId = Number(config.userId);
            if (userId) {
              await db.insert(tasksTable).values({
                title: `Rule: ${rule.name} — ${ctx.entityTitle ?? "New item"}`,
                description: `Auto-assigned by rule "${rule.name}"`,
                status: "pending",
                priority: "medium",
                projectId: ctx.projectId,
                assignedToId: userId,
                createdById: ctx.triggeredByUserId,
                sourceType: "manual",
                sourceId: ctx.entityId,
              });
              executedActions.push(`assign_user:${userId}`);

              // notify the assignee
              await db.insert(notificationsTable).values({
                userId,
                type: "task_assigned",
                title: `Auto-assigned: ${ctx.entityTitle ?? "New item"}`,
                message: `Rule "${rule.name}" assigned you to this item.`,
                projectId: ctx.projectId,
                entityType: ctx.type,
                entityId: ctx.entityId,
              });
              emitToUser(userId, "notification:new", {});
            }
          } else if (actionType === "assign_team") {
            // Team assignment — store as a note for now; teams can be extended later
            const teamName = String(config.teamName ?? config.teamId ?? "");
            executedActions.push(`assign_team:${teamName}`);
          } else if (actionType === "send_notification") {
            const message = String(config.message ?? `Rule triggered: ${rule.name}`);
            const userIds: number[] = Array.isArray(config.userIds) ? config.userIds.map(Number) : [];

            // If no explicit user list, notify the sender
            const targets = userIds.length > 0 ? userIds : [ctx.triggeredByUserId];
            await db.insert(notificationsTable).values(
              targets.map(uid => ({
                userId: uid,
                type: "system" as const,
                title: `Rule: ${rule.name}`,
                message,
                projectId: ctx.projectId,
                entityType: ctx.type,
                entityId: ctx.entityId,
              }))
            );
            for (const uid of targets) emitToUser(uid, "notification:new", {});
            executedActions.push(`send_notification:${targets.join(",")}`);
          }
        } catch (actionErr) {
          logger.warn({ err: actionErr, ruleId: rule.id, action }, "Rule action failed");
        }
      }

      if (executedActions.length > 0) {
        results.push({ ruleId: rule.id, ruleName: rule.name, actions: executedActions });
      }
    }

    if (results.length > 0) {
      logger.info({ ctx: { type: ctx.type, projectId: ctx.projectId }, results }, "Rules evaluated");
    }

    return results;
  } catch (err) {
    logger.warn({ err }, "Rule engine evaluation failed — skipping");
    return [];
  }
}
