import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";

export async function createAuditLog(params: {
  userId?: number;
  organizationId?: number;
  action: string;
  entityType: string;
  entityId: number;
  entityTitle?: string;
  details?: Record<string, unknown>;
  projectId?: number;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: params.userId,
      organizationId: params.organizationId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      entityTitle: params.entityTitle,
      details: params.details ?? {},
      projectId: params.projectId,
      ipAddress: params.ipAddress,
    });
  } catch {
    // Audit logs should never break the main flow
  }
}
