import { db } from "@workspace/db";
import { documentsTable, documentRevisionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ReviewDecision =
  | "approved"
  | "approved_with_comments"
  | "for_revision"
  | "rejected";

const VALID_DECISIONS: ReadonlySet<string> = new Set([
  "approved",
  "approved_with_comments",
  "for_revision",
  "rejected",
]);

export function isValidReviewDecision(d: unknown): d is ReviewDecision {
  return typeof d === "string" && VALID_DECISIONS.has(d);
}

export function decisionToDocumentStatus(decision: ReviewDecision): string {
  switch (decision) {
    case "approved":              return "approved";
    case "approved_with_comments": return "approved_with_comments";
    case "for_revision":          return "for_revision";
    case "rejected":              return "rejected";
  }
}

export function decisionLabel(decision: ReviewDecision): string {
  switch (decision) {
    case "approved":              return "Approved";
    case "approved_with_comments": return "Approved with Comments";
    case "for_revision":          return "Revise";
    case "rejected":              return "Rejected";
  }
}

/**
 * Determines the most conservative (worst-case) decision from a list.
 * Priority: rejected > for_revision > approved_with_comments > approved
 */
export function consolidateDecisions(decisions: ReviewDecision[]): ReviewDecision {
  if (decisions.includes("rejected"))              return "rejected";
  if (decisions.includes("for_revision"))          return "for_revision";
  if (decisions.includes("approved_with_comments")) return "approved_with_comments";
  return "approved";
}

/**
 * Applies a reviewer's decision to a document:
 *  1. Updates the document's status
 *  2. Inserts a revision-history entry capturing the reviewer's name, decision, and date
 *
 * Returns the updated document row, or null if the document was not found.
 */
export async function applyDocumentReviewDecision({
  documentId,
  projectId,
  decision,
  reviewerId,
  reviewerName,
  comment,
}: {
  documentId: number;
  projectId?: number;
  decision: ReviewDecision;
  reviewerId: number;
  reviewerName: string;
  comment?: string | null;
}): Promise<(typeof documentsTable.$inferSelect) | null> {
  const newStatus = decisionToDocumentStatus(decision);

  const whereClause = projectId
    ? eq(documentsTable.id, documentId)
    : eq(documentsTable.id, documentId);

  const [doc] = await db
    .update(documentsTable)
    .set({ status: newStatus as any, updatedAt: new Date() })
    .where(whereClause)
    .returning();

  if (!doc) return null;

  const decisionText = decisionLabel(decision);
  const entryComment =
    comment
      ? `${decisionText} — ${comment}`
      : decisionText;

  await db.insert(documentRevisionsTable).values({
    documentId,
    revision: doc.revision,
    status: newStatus,
    comment: entryComment,
    createdById: reviewerId,
    reviewDecision: decision,
    reviewerName,
  });

  return doc;
}
