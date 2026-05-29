/**
 * Recipient Resolvers
 *
 * Functions that return NotificationRecipient lists based on
 * project roles, org roles, or explicit user lists.
 * Add new resolvers here as new event types are connected.
 */

import { db } from "@workspace/db";
import { usersTable, projectMembersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import type { NotificationRecipient } from "./index.js";

/**
 * All active members of a project whose system role is in `roles`.
 * Typical use: notify admins + project_managers on document_uploaded.
 */
export async function getProjectRecipientsByRole(
  projectId: number,
  roles: string[],
): Promise<NotificationRecipient[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        inArray(usersTable.role, roles as any[]),
        eq(usersTable.isActive, true),
      ),
    );

  return rows.map(r => ({
    userId: r.id,
    email: r.email,
    name: `${r.firstName} ${r.lastName}`.trim(),
  }));
}

/**
 * All active members of a project (any role).
 */
export async function getAllProjectRecipients(projectId: number): Promise<NotificationRecipient[]> {
  return getProjectRecipientsByRole(projectId, [
    "admin",
    "project_manager",
    "document_controller",
    "reviewer",
    "engineer",
    "viewer",
  ]);
}

/**
 * Build a single recipient from a user row already in memory.
 */
export function recipientFromUser(user: {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}): NotificationRecipient {
  return {
    userId: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`.trim(),
  };
}
