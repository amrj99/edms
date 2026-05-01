/**
 * Tasks AI — priority scoring, bottleneck detection, notification urgency.
 */
import { callAI, logAiAction } from "./ai-core.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number;
  reasoning: string;
  isBottleneck: boolean;
  suggestedAssignee?: string;
  suggestedDueDate?: string;
}

export interface TaskListInsights {
  tasks: TaskPriorityInsight[];
  overallRisk: "low" | "medium" | "high" | "critical";
  bottlenecks: string[];
  topRecommendations: string[];
}

// ─── prioritizeTasks ──────────────────────────────────────────────────────────

export async function prioritizeTasks(tasks: Array<{
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: Date | null;
  sourceType?: string | null;
}>, userId?: number, organizationId?: number | null): Promise<TaskListInsights> {
  if (tasks.length === 0) {
    return { tasks: [], overallRisk: "low", bottlenecks: [], topRecommendations: [] };
  }

  const start = Date.now();
  const tasksJson = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split("T")[0] : null,
    source: t.sourceType ?? "manual",
  }));

  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
      `Analyze and prioritize these engineering project tasks. Today's date: ${new Date().toISOString().split("T")[0]}

Tasks: ${JSON.stringify(tasksJson, null, 2)}

Respond with JSON only.`,
      `You are an expert project manager AI. Analyze task lists and identify priorities, bottlenecks, and risks.
Respond ONLY with valid JSON in this exact schema:
{
  "tasks": [
    {
      "taskId": <number>,
      "aiPriority": "low|medium|high|urgent",
      "aiScore": <0-100>,
      "reasoning": "brief reason",
      "isBottleneck": true/false
    }
  ],
  "overallRisk": "low|medium|high|critical",
  "bottlenecks": ["bottleneck1", "bottleneck2"],
  "topRecommendations": ["action1", "action2", "action3"]
}`,
      "smart",
      true,
      organizationId,
    );

    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      provider, model, tokensUsed,
      latencyMs: Date.now() - start, success: true,
    });

    return result as TaskListInsights;
  } catch (err) {
    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── scoreNotificationUrgency ─────────────────────────────────────────────────

export async function scoreNotificationUrgency(notifications: Array<{
  id: number | string;
  type: string;
  message: string;
  createdAt?: Date;
}>): Promise<Array<{ id: number | string; urgency: number; reason: string }>> {
  if (notifications.length === 0) return [];

  const { data: result } = await callAI(
    `Score the urgency of these engineering project notifications (0=not urgent, 100=critical):
${JSON.stringify(notifications.map(n => ({ id: n.id, type: n.type, message: n.message })))},

Respond with JSON only.`,
    `You are an engineering project AI assistant. Score notification urgency.
Respond ONLY with JSON: {"scores": [{"id": <id>, "urgency": <0-100>, "reason": "<brief>"}]}`,
  );

  return (result as any).scores ?? [];
}
