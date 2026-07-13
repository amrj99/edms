/**
 * document-file-write.ts — B2.3a Document File Upload Atomicity
 *
 * Small, named seams for the document-file upload write path so that:
 *   1. a single document_files row can be inserted inside the caller's
 *      transaction (insertDocumentFileRow), and
 *   2. every storage object written for a request can be compensated (deleted)
 *      when that transaction rolls back (compensateStorage).
 *
 * Both are deliberately isolated, named exports so failure-injection tests can
 * mock them to force a DB insert failure at a precise point, or a compensation
 * delete failure, without touching the real request pipeline.
 */

import { db, documentFilesTable } from "@workspace/db";
import { deleteStoredObject, type StorageMode } from "./orgStorage.js";

/** A db handle or an open transaction — anything that can .insert() a table. */
type FileWriteExecutor = Pick<typeof db, "insert">;

type DocumentFileInsert = typeof documentFilesTable.$inferInsert;
type DocumentFileRow = typeof documentFilesTable.$inferSelect;

/** A storage object written during an upload request — enough to delete it. */
export interface WrittenObject {
  mode: StorageMode;
  objectPath: string;
  organizationId: number | null;
}

/**
 * Insert ONE document_files row using the caller's executor (a transaction in
 * the upload path). Named + exported so tests can force a precise insert
 * failure. Returns the inserted row.
 */
export async function insertDocumentFileRow(
  exec: FileWriteExecutor,
  values: DocumentFileInsert,
): Promise<DocumentFileRow> {
  const [row] = await exec.insert(documentFilesTable).values(values).returning();
  return row;
}

/** An object that could NOT be deleted during compensation → potential orphan. */
export interface CompensationResidual {
  objectPath: string;
  mode: StorageMode;
  reason: string;
}

/**
 * Best-effort, idempotent deletion of every storage object written during a
 * request whose DB transaction rolled back.
 *
 * Returns the list of objects that could NOT be deleted so the caller can log
 * their storage keys for reconciliation. This function NEVER throws — a failed
 * deletion becomes a returned residual, not an exception, so one un-deletable
 * object does not prevent compensating the rest.
 *
 * Honesty boundary: compensation covers the common failure (DB fails after a
 * successful storage write). It does NOT make the operation a distributed
 * transaction — a process crash between the storage write and this call can
 * still leave an orphan, which is why residuals are surfaced for an
 * out-of-band Storage Reconciliation / Orphan Reaper (tracked follow-up).
 */
export async function compensateStorage(written: WrittenObject[]): Promise<CompensationResidual[]> {
  const residual: CompensationResidual[] = [];
  for (const obj of written) {
    try {
      await deleteStoredObject(obj);
    } catch (err) {
      residual.push({
        objectPath: obj.objectPath,
        mode: obj.mode,
        reason: (err as Error)?.message ?? String(err),
      });
    }
  }
  return residual;
}
