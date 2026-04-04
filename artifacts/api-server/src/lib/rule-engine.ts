/**
 * Rule Engine — evaluates admin-defined automation rules.
 *
 * Circuit Breaker:
 *   - CLOSED  (isCircuitOpen=false): normal execution.
 *   - OPEN    (isCircuitOpen=true, within cooldown): rule is skipped.
 *   - HALF-OPEN (isCircuitOpen=true, cooldown elapsed): one attempt allowed;
 *               success → CLOSED, failure → remain OPEN with fresh cooldown.
 *
 * Thresholds:
 *   FAILURE_THRESHOLD = 5 consecutive failures → trip (OPEN)
 *   COOLDOWN_MS       = 30 minutes before half-open retry
 */

import { db } from "@workspace/db";
import { rulesTable, ruleExecutionLogsTable, notificationsTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { emitToUser } from "./socket.js";
import { logger } from "./logger.js";

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export interface RuleContext {
  type: "document" | "correspondence";
  orgId: number;
  projectId: number;
  documentType?: string | null;
  discipline?: string | null;
  subject?: string | null;
  senderUserId?: number;
  entityId?: number;
  entityTitle?: string;
  triggeredByUserId: number;
}

export interface RuleActionResult {
  ruleId: number;
  ruleName: string;
  actions: string[];
}

/** Determine circuit state for a given rule row. */
function circuitState(rule: typeof rulesTable.$inferSelect): "closed" | "open" | "half-open" {
  if (!rule.isCircuitOpen) return "closed";
  const elapsed = rule.lastFailedAt ? Date.now() - new Date(rule.lastFailedAt).getTime() : Infinity;
  return elapsed >= COOLDOWN_MS ? "half-open" : "open";
}

/** Update circuit breaker columns after a rule execution. */
async function updateCircuitState(
  ruleId: number,
  succeeded: boolean,
  prevConsecutiveFailures: number,
): Promise<void> {
  if (succeeded) {
    await db.update(rulesTable).set({
      consecutiveFailures: 0,
      isCircuitOpen: false,
      lastFailedAt: null,
      updatedAt: new Date(),
    }).where(eq(rulesTable.id, ruleId));
  } else {
    const newFailures = prevConsecutiveFailures + 1;
    const tripCircuit = newFailures >= FAILURE_THRESHOLD;
    await db.update(rulesTable).set({
      consecutiveFailures: newFailures,
      isCircuitOpen: tripCircuit,
      lastFailedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(rulesTable.id, ruleId));
    if (tripCircuit) {
      logger.warn({ ruleId, newFailures }, "Circuit breaker TRIPPED — rule suspended for 30 min");
    }
  }
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
      // ── Circuit Breaker check ────────────────────────────────────────────────
      const state = circuitState(rule);

      if (state === "open") {
        const minutesLeft = rule.lastFailedAt
          ? Math.ceil((COOLDOWN_MS - (Date.now() - new Date(rule.lastFailedAt).getTime())) / 60000)
          : 0;
        logger.info({ ruleId: rule.id, minutesLeft }, "Circuit OPEN — skipping rule");

        await db.insert(ruleExecutionLogsTable).values({
          ruleId: rule.id,
          organizationId: ctx.orgId,
          entityType: ctx.type,
          entityId: ctx.entityId ?? null,
          actionsTaken: [],
          success: false,
          errorMessage: `Circuit breaker OPEN — skipped (cooldown: ${minutesLeft}min remaining)`,
          durationMs: 0,
        }).catch(() => {});
        continue;
      }

      if (state === "half-open") {
        logger.info({ ruleId: rule.id }, "Circuit HALF-OPEN — attempting one execution");
      }

      // ── Execute the rule ─────────────────────────────────────────────────────
      const ruleStart = Date.now();
      const actions = (rule.actions as Record<string, unknown>[]) ?? [];
      const executedActions: string[] = [];
      let ruleSuccess = true;
      let ruleErrorMsg: string | null = null;

      for (const action of actions) {
        try {
          const actionType = action.type as string;
          const config = (action.config as Record<string, unknown>) ?? {};

          if (actionType === "assign_user") {
            const userId = Number(config.userId);
            if (userId) {
              const [assignee] = await db.select({ id: usersTable.id, organizationId: usersTable.organizationId })
                .from(usersTable)
                .where(eq(usersTable.id, userId))
                .limit(1);

              if (!assignee || assignee.organizationId !== ctx.orgId) {
                logger.warn({ ruleId: rule.id, userId, orgId: ctx.orgId }, "assign_user skipped — user not in rule org");
              } else {
                await db.insert(tasksTable).values({
                  title: `Rule: ${rule.name} — ${ctx.entityTitle ?? "New item"}`,
                  description: `Auto-assigned by rule "${rule.name}"`,
                  status: "pending",
                  priority: "medium",
                  projectId: ctx.projectId,
                  organizationId: ctx.orgId,
                  assignedToId: userId,
                  createdById: ctx.triggeredByUserId,
                  sourceType: "manual",
                  sourceId: ctx.entityId,
                });
                executedActions.push(`assign_user:${userId}`);

                await db.insert(notificationsTable).values({
                  userId,
                  organizationId: ctx.orgId,
                  type: "task_assigned",
                  title: `Auto-assigned: ${ctx.entityTitle ?? "New item"}`,
                  message: `Rule "${rule.name}" assigned you to this item.`,
                  projectId: ctx.projectId,
                  entityType: ctx.type,
                  entityId: ctx.entityId,
                });
                emitToUser(userId, "notification:new", {});
              }
            }
          } else if (actionType === "assign_team") {
            const teamName = String(config.teamName ?? config.teamId ?? "");
            executedActions.push(`assign_team:${teamName}`);
          } else if (actionType === "send_notification") {
            const message = String(config.message ?? `Rule triggered: ${rule.name}`);
            const rawUserIds: number[] = Array.isArray(config.userIds) ? config.userIds.map(Number).filter(Boolean) : [];

            let targets: number[];

            if (rawUserIds.length > 0) {
              const validUsers = await db
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(
                  and(
                    inArray(usersTable.id, rawUserIds),
                    eq(usersTable.organizationId, ctx.orgId),
                  )
                );

              const validIds = new Set(validUsers.map(u => u.id));
              const rejected = rawUserIds.filter(id => !validIds.has(id));
              if (rejected.length > 0) {
                logger.warn(
                  { ruleId: rule.id, rejected, orgId: ctx.orgId },
                  "send_notification: dropped cross-org userIds from rule action",
                );
              }
              targets = [...validIds];
            } else {
              targets = [ctx.triggeredByUserId];
            }

            if (targets.length > 0) {
              await db.insert(notificationsTable).values(
                targets.map(uid => ({
                  userId: uid,
                  organizationId: ctx.orgId,
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
          }
        } catch (actionErr) {
          ruleSuccess = false;
          ruleErrorMsg = String(actionErr);
          logger.warn({ err: actionErr, ruleId: rule.id, action }, "Rule action failed");
        }
      }

      // ── Log execution ────────────────────────────────────────────────────────
      const durationMs = Date.now() - ruleStart;
      await db.insert(ruleExecutionLogsTable).values({
        ruleId: rule.id,
        organizationId: ctx.orgId,
        entityType: ctx.type,
        entityId: ctx.entityId ?? null,
        actionsTaken: executedActions,
        success: ruleSuccess,
        errorMessage: ruleErrorMsg,
        durationMs,
      }).catch((logErr) => {
        logger.warn({ err: logErr, ruleId: rule.id }, "Failed to write rule execution log");
      });

      // ── Update circuit state ─────────────────────────────────────────────────
      await updateCircuitState(rule.id, ruleSuccess, rule.consecutiveFailures).catch(() => {});

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
