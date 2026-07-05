/**
 * recipientOrganizationId — Phase 6B
 *
 * Pure utility. Returns the organizationId of the transmittal's intended
 * recipient, or null if none is specified.
 *
 * No database calls. The caller is responsible for pre-fetching the toUser's
 * organizationId before calling this function.
 *
 * Usage in route handlers:
 *
 *   let toUserOrgId: number | null | undefined;
 *   if (trs.toUserId) {
 *     const [u] = await db.select({ organizationId: usersTable.organizationId })
 *       .from(usersTable).where(eq(usersTable.id, trs.toUserId));
 *     toUserOrgId = u?.organizationId;
 *   }
 *   const recipientOrgId = recipientOrganizationId(trs.toUserId, toUserOrgId);
 *   const isRecipient = recipientOrgId === caller.organizationId;
 */
export function recipientOrganizationId(
  toUserId: number | null,
  toUserOrganizationId: number | null | undefined,
): number | null {
  if (!toUserId) return null;
  return toUserOrganizationId ?? null;
}
