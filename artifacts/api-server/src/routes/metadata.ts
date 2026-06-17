import { Router } from "express";
import { db } from "@workspace/db";
import { metadataFieldsTable, documentTypesTable, normalizeDocTypeCode } from "@workspace/db";
import type { MetadataField } from "@workspace/db";
import { eq, and, or, isNull, isNotNull, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireOrgScope } from "../lib/org-scope.js";
import { requireInt } from "../lib/params";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * Build the WHERE conditions selecting metadata fields applicable to a given
 * document type: org-scoped + system-wide global fields (documentTypeId IS
 * NULL) UNION org-scoped fields specific to documentTypeId. Does not filter
 * on isActive.
 */
function metadataFieldConditions(orgId: number | null, documentTypeId: number | null) {
  const globalConditions = orgId
    ? or(
        and(eq(metadataFieldsTable.organizationId, orgId), isNull(metadataFieldsTable.documentTypeId)),
        and(isNull(metadataFieldsTable.organizationId), isNull(metadataFieldsTable.documentTypeId)),
      )
    : and(isNull(metadataFieldsTable.organizationId), isNull(metadataFieldsTable.documentTypeId));

  return documentTypeId != null && orgId
    ? or(globalConditions, and(eq(metadataFieldsTable.organizationId, orgId), eq(metadataFieldsTable.documentTypeId, documentTypeId)))
    : globalConditions;
}

/**
 * Resolve the set of active metadata fields applicable to a given document type.
 */
export async function resolveMetadataFields(orgId: number | null, documentTypeId: number | null) {
  return db
    .select()
    .from(metadataFieldsTable)
    .where(and(eq(metadataFieldsTable.isActive, true), metadataFieldConditions(orgId, documentTypeId)))
    .orderBy(metadataFieldsTable.id);
}

/**
 * Resolve ALL metadata fields (active and inactive) applicable to a given
 * document type. Used by validation to distinguish "disabled field" from
 * "truly unknown key".
 */
export async function resolveAllMetadataFields(orgId: number | null, documentTypeId: number | null) {
  return db
    .select()
    .from(metadataFieldsTable)
    .where(metadataFieldConditions(orgId, documentTypeId))
    .orderBy(metadataFieldsTable.id);
}

/**
 * Validate a single value against a resolved metadata field's type.
 * Returns an error message, or null if the value is valid.
 */
function validateFieldValue(field: MetadataField, value: unknown): string | null {
  switch (field.fieldType) {
    case "text":
      return typeof value === "string" ? null : `${field.label} must be text`;
    case "number":
      return typeof value === "number" && !Number.isNaN(value) ? null : `${field.label} must be a number`;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : `${field.label} must be a date (YYYY-MM-DD)`;
    case "boolean":
      return typeof value === "boolean" ? null : `${field.label} must be true or false`;
    case "select":
      return (field.options ?? []).includes(value as string) ? null : `${field.label} must be one of: ${(field.options ?? []).join(", ")}`;
    case "multiselect": {
      if (!Array.isArray(value)) return `${field.label} must be a list`;
      for (const v of value) {
        if (!(field.options ?? []).includes(v)) return `${field.label} contains an invalid option: ${v}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validate a document's `metadata` payload against the metadata fields resolved
 * for its document type. If the document type doesn't map to a known, active
 * `document_types` row, validation is skipped entirely (legacy/unmapped types).
 *
 * Principle: validate only what changed, grandfather the rest. When `oldMetadata`
 * is provided (updating an existing document), keys whose value is identical to
 * `oldMetadata` are not re-validated against current field definitions, so
 * disabling a field, narrowing options, or making a field required afterwards
 * does not break documents that already hold the old value. When `oldMetadata`
 * is null (creating a new document), every key is validated normally.
 */
export async function validateDocumentMetadata(
  orgId: number | null,
  documentType: string | null | undefined,
  metadata: Record<string, unknown>,
  oldMetadata: Record<string, unknown> | null = null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!orgId || !documentType) return { ok: true };

  const normalizedCode = normalizeDocTypeCode(documentType);
  const [docType] = await db
    .select()
    .from(documentTypesTable)
    .where(and(eq(documentTypesTable.organizationId, orgId), eq(documentTypesTable.code, normalizedCode), eq(documentTypesTable.isActive, true)));
  if (!docType) return { ok: true };

  const activeFields = await resolveMetadataFields(orgId, docType.id);
  const allFields = await resolveAllMetadataFields(orgId, docType.id);
  const activeByName = new Map(activeFields.map((f) => [f.name, f]));
  const allByName = new Map(allFields.map((f) => [f.name, f]));

  const isChanged = (key: string) => oldMetadata === null || JSON.stringify(metadata[key]) !== JSON.stringify(oldMetadata[key]);

  for (const field of activeFields) {
    if (!isChanged(field.name)) continue;
    const value = metadata[field.name];
    if (field.required && (value === undefined || value === null || value === "")) {
      return { ok: false, message: `${field.label} is required` };
    }
    if (value !== undefined && value !== null) {
      const err = validateFieldValue(field, value);
      if (err) return { ok: false, message: err };
    }
  }

  for (const key of Object.keys(metadata)) {
    if (activeByName.has(key)) continue;
    if (!isChanged(key)) continue;
    const field = allByName.get(key);
    if (field) {
      return { ok: false, message: `${field.label} is disabled and cannot be modified` };
    }
    return { ok: false, message: `Unknown metadata field: ${key}` };
  }

  return { ok: true };
}

router.get("/", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const orgId = req.orgId ?? null;
  const documentTypeIdRaw = req.query.documentTypeId;

  if (documentTypeIdRaw != null) {
    const documentTypeId = requireInt(documentTypeIdRaw as string);
    if (!orgId) {
      res.status(400).json({ error: "Bad Request", message: "documentTypeId requires an organization context" });
      return;
    }
    const [docType] = await db
      .select()
      .from(documentTypesTable)
      .where(and(eq(documentTypesTable.id, documentTypeId), eq(documentTypesTable.organizationId, orgId)));
    if (!docType) {
      res.status(400).json({ error: "Bad Request", message: "documentTypeId does not exist for this organization" });
      return;
    }
    const fields = await resolveMetadataFields(orgId, documentTypeId);
    res.json({ fields });
    return;
  }

  const fields = await db
    .select()
    .from(metadataFieldsTable)
    .where(
      and(
        eq(metadataFieldsTable.isActive, true),
        orgId
          ? or(
              eq(metadataFieldsTable.organizationId, orgId),
              isNull(metadataFieldsTable.organizationId),
            )
          : isNull(metadataFieldsTable.organizationId),
      ),
    )
    .orderBy(metadataFieldsTable.name);
  res.json({ fields });
});

router.post("/", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const { name, label, fieldType, options, required, appliesTo, documentTypeId } = req.body;
  if (!name || !label || !fieldType) {
    res.status(400).json({ error: "Bad Request", message: "name, label, fieldType required" });
    return;
  }
  const orgId = req.orgId ?? null;

  let resolvedDocumentTypeId: number | null = null;
  if (documentTypeId != null) {
    if (!orgId) {
      res.status(400).json({ error: "Bad Request", message: "documentTypeId requires an organization context" });
      return;
    }
    const [docType] = await db
      .select()
      .from(documentTypesTable)
      .where(and(eq(documentTypesTable.id, documentTypeId), eq(documentTypesTable.organizationId, orgId)));
    if (!docType) {
      res.status(400).json({ error: "Bad Request", message: "documentTypeId does not exist for this organization" });
      return;
    }
    resolvedDocumentTypeId = docType.id;
  }

  if (orgId) {
    // Same scope (including disabled fields): a field name is reserved within its
    // scope once created. Reuse must happen via PATCH isActive:true (reactivation),
    // never by creating a new field row with the same name.
    const samePartitionMatch = await db
      .select({ id: metadataFieldsTable.id, isActive: metadataFieldsTable.isActive })
      .from(metadataFieldsTable)
      .where(
        and(
          eq(metadataFieldsTable.organizationId, orgId),
          eq(metadataFieldsTable.name, name),
          resolvedDocumentTypeId === null
            ? isNull(metadataFieldsTable.documentTypeId)
            : eq(metadataFieldsTable.documentTypeId, resolvedDocumentTypeId),
        ),
      )
      .limit(1);
    if (samePartitionMatch.length > 0) {
      const message = samePartitionMatch[0].isActive
        ? `A field named "${name}" already exists and applies to this document type`
        : `A field named "${name}" already exists in this scope but is disabled. Reactivate it instead of creating a new field.`;
      res.status(409).json({ error: "Conflict", message });
      return;
    }

    // Cross-partition (global vs type-specific) collision, including disabled fields.
    const crossPartitionMatch = await db
      .select({ id: metadataFieldsTable.id, isActive: metadataFieldsTable.isActive })
      .from(metadataFieldsTable)
      .where(
        and(
          eq(metadataFieldsTable.organizationId, orgId),
          eq(metadataFieldsTable.name, name),
          resolvedDocumentTypeId === null
            ? isNotNull(metadataFieldsTable.documentTypeId)
            : isNull(metadataFieldsTable.documentTypeId),
        ),
      )
      .limit(1);
    if (crossPartitionMatch.length > 0) {
      const message = crossPartitionMatch[0].isActive
        ? `A field named "${name}" already exists and applies to this document type`
        : `A field named "${name}" already exists in this scope but is disabled. Reactivate it instead of creating a new field.`;
      res.status(409).json({ error: "Conflict", message });
      return;
    }
  }

  try {
    const [field] = await db
      .insert(metadataFieldsTable)
      .values({
        organizationId: orgId,
        name,
        label,
        fieldType,
        options: options || [],
        required: required ?? false,
        appliesTo: appliesTo || "document",
        documentTypeId: resolvedDocumentTypeId,
      })
      .returning();
    res.status(201).json(field);
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") {
      res.status(409).json({ error: "Conflict", message: `A field named "${name}" already exists and applies to this document type` });
      return;
    }
    logger.error({ err }, "[metadata] POST / error");
    res.status(500).json({ error: "Failed to create metadata field" });
  }
});

router.patch("/:id", requireAuth, requireOrgScope, async (req, res): Promise<void> => {
  const id = requireInt(req.params.id);
  const orgId = req.orgId ?? null;
  const { name, fieldType, label, options, required, isActive, documentTypeId } = req.body;

  if (name !== undefined || fieldType !== undefined) {
    res.status(400).json({ error: "Bad Request", message: "Metadata field name and fieldType cannot be changed after creation" });
    return;
  }

  const where = orgId
    ? and(eq(metadataFieldsTable.id, id), eq(metadataFieldsTable.organizationId, orgId))
    : and(eq(metadataFieldsTable.id, id), isNull(metadataFieldsTable.organizationId));

  const [existing] = await db.select().from(metadataFieldsTable).where(where);
  if (!existing) {
    res.status(404).json({ error: "Not Found", message: "Metadata field not found" });
    return;
  }

  const updates: Partial<typeof metadataFieldsTable.$inferInsert> = {};
  if (label !== undefined) {
    if (!label?.trim()) {
      res.status(400).json({ error: "Bad Request", message: "label cannot be empty" });
      return;
    }
    updates.label = label.trim();
  }
  if (options !== undefined) updates.options = options;
  if (required !== undefined) updates.required = required;
  if (isActive !== undefined) updates.isActive = isActive;

  let resolvedDocumentTypeId: number | null | undefined = undefined;
  if (documentTypeId !== undefined) {
    if (documentTypeId === null) {
      resolvedDocumentTypeId = null;
    } else {
      if (!orgId) {
        res.status(400).json({ error: "Bad Request", message: "documentTypeId requires an organization context" });
        return;
      }
      const [docType] = await db
        .select()
        .from(documentTypesTable)
        .where(and(eq(documentTypesTable.id, documentTypeId), eq(documentTypesTable.organizationId, orgId)));
      if (!docType) {
        res.status(400).json({ error: "Bad Request", message: "documentTypeId does not exist for this organization" });
        return;
      }
      resolvedDocumentTypeId = docType.id;
    }
    updates.documentTypeId = resolvedDocumentTypeId;
  }

  if (orgId && resolvedDocumentTypeId !== undefined && resolvedDocumentTypeId !== existing.documentTypeId) {
    const crossPartitionMatch = await db
      .select({ id: metadataFieldsTable.id, isActive: metadataFieldsTable.isActive })
      .from(metadataFieldsTable)
      .where(
        and(
          eq(metadataFieldsTable.organizationId, orgId),
          eq(metadataFieldsTable.name, existing.name),
          ne(metadataFieldsTable.id, id),
          resolvedDocumentTypeId === null
            ? isNotNull(metadataFieldsTable.documentTypeId)
            : isNull(metadataFieldsTable.documentTypeId),
        ),
      )
      .limit(1);
    if (crossPartitionMatch.length > 0) {
      const message = crossPartitionMatch[0].isActive
        ? `A field named "${existing.name}" already exists and applies to this document type`
        : `A field named "${existing.name}" already exists in this scope but is disabled. Reactivate it instead of creating a new field.`;
      res.status(409).json({ error: "Conflict", message });
      return;
    }
  }

  try {
    const [field] = await db
      .update(metadataFieldsTable)
      .set(updates)
      .where(eq(metadataFieldsTable.id, id))
      .returning();
    res.json(field);
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") {
      res.status(409).json({ error: "Conflict", message: `A field named "${existing.name}" already exists and applies to this document type` });
      return;
    }
    logger.error({ err }, "[metadata] PATCH /:id error");
    res.status(500).json({ error: "Failed to update metadata field" });
  }
});

export default router;
