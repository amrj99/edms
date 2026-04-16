/**
 * Search Service
 * Provides a unified search interface that uses Elasticsearch when an
 * ELASTICSEARCH_URL is configured, and gracefully falls back to SQL ILIKE
 * queries otherwise.  The rest of the application only imports this module
 * and is never aware of which backend is active.
 */
import { db } from "@workspace/db";
import {
  documentsTable,
  correspondenceTable,
  meetingsTable,
  projectsTable,
  usersTable,
  foldersTable,
} from "@workspace/db";
import { eq, ilike, or, and, desc } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Elasticsearch client (lazy, optional) ────────────────────────────────────
let esClient: any = null;
let esInitialised = false;

async function getEsClient() {
  if (esInitialised) return esClient;
  esInitialised = true;

  const url = process.env.ELASTICSEARCH_URL;
  if (!url) {
    logger.info("[search] ELASTICSEARCH_URL not set — using SQL fallback");
    return null;
  }

  try {
    const { Client } = await import("@elastic/elasticsearch");
    esClient = new Client({ node: url });
    await esClient.ping();
    logger.info({ url }, "[search] Connected to Elasticsearch");
  } catch (err: any) {
    logger.warn({ err: err.message }, "[search] Could not connect to Elasticsearch — falling back to SQL");
    esClient = null;
  }
  return esClient;
}

// ─── Index names ──────────────────────────────────────────────────────────────
const IDX = {
  documents: "edms_documents",
  correspondence: "edms_correspondence",
  meetings: "edms_meetings",
  projects: "edms_projects",
};

// ─── Document indexing ────────────────────────────────────────────────────────
export async function indexDocument(doc: {
  id: number;
  title: string;
  documentNumber?: string | null;
  discipline?: string | null;
  documentType?: string | null;
  description?: string | null;
  projectId?: number | null;
  revision?: string | null;
  status?: string | null;
  fileUrl?: string | null;
}) {
  const es = await getEsClient();
  if (!es) return;
  try {
    await es.index({
      index: IDX.documents,
      id: String(doc.id),
      document: {
        ...doc,
        indexedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.warn({ err: err.message, docId: doc.id }, "[search] Failed to index document");
  }
}

export async function deleteDocumentIndex(id: number) {
  const es = await getEsClient();
  if (!es) return;
  try {
    await es.delete({ index: IDX.documents, id: String(id) });
  } catch { /* not found is fine */ }
}

// ─── Reindex all documents from DB → Elasticsearch ────────────────────────────
export async function reindexAll(): Promise<{ indexed: number; errors: number }> {
  const es = await getEsClient();
  if (!es) return { indexed: 0, errors: 0 };

  let indexed = 0;
  let errors = 0;

  const docs = await db.select().from(documentsTable).limit(10_000);
  const body: any[] = [];
  for (const doc of docs) {
    body.push({ index: { _index: IDX.documents, _id: String(doc.id) } });
    body.push({
      id: doc.id,
      title: doc.title,
      documentNumber: doc.documentNumber,
      discipline: doc.discipline,
      documentType: doc.documentType,
      description: doc.description,
      projectId: doc.projectId,
      revision: doc.revision,
      status: doc.status,
    });
  }

  if (body.length > 0) {
    const result = await es.bulk({ body });
    for (const item of result.items ?? []) {
      if (item.index?.error) errors++;
      else indexed++;
    }
  }

  logger.info({ indexed, errors }, "[search] Reindex complete");
  return { indexed, errors };
}

// ─── Search types ─────────────────────────────────────────────────────────────
export interface SearchParams {
  q: string;
  projectId?: number;
  organizationId?: number;
  type?: "document" | "correspondence" | "meeting" | "project" | "all";
  discipline?: string;
  status?: string;
}

export interface SearchResults {
  documents: any[];
  correspondence: any[];
  meetings: any[];
  projects: any[];
  total: number;
  engine: "elasticsearch" | "sql";
}

// ─── Main search function ─────────────────────────────────────────────────────
export async function search(params: SearchParams): Promise<SearchResults> {
  const es = await getEsClient();
  if (es) {
    try {
      return await elasticsearchSearch(es, params);
    } catch (err: any) {
      logger.warn({ err: err.message }, "[search] ES query failed — falling back to SQL");
    }
  }
  return sqlSearch(params);
}

// ─── Elasticsearch backend ────────────────────────────────────────────────────
async function elasticsearchSearch(es: any, params: SearchParams): Promise<SearchResults> {
  const { q, projectId, type, discipline, status } = params;

  const mustClause: any[] = [
    {
      multi_match: {
        query: q,
        fields: ["title^3", "documentNumber^2", "discipline", "documentType", "description", "subject", "body", "agenda", "name", "code"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    },
  ];

  if (projectId) {
    mustClause.push({ term: { projectId } });
  }

  const filterClause: any[] = [];
  if (discipline) filterClause.push({ term: { discipline } });
  if (status) filterClause.push({ term: { status } });

  const query = {
    bool: {
      must: mustClause,
      filter: filterClause.length > 0 ? filterClause : undefined,
    },
  };

  const searches: Array<{ index: string; results: any[] }> = [];

  const indicesToSearch: string[] = [];
  if (!type || type === "document" || type === "all") indicesToSearch.push(IDX.documents);
  if (!type || type === "correspondence" || type === "all") indicesToSearch.push(IDX.correspondence);
  if (!type || type === "meeting" || type === "all") indicesToSearch.push(IDX.meetings);
  if (!type || type === "project" || type === "all") indicesToSearch.push(IDX.projects);

  const body: any[] = [];
  for (const index of indicesToSearch) {
    body.push({ index });
    body.push({ query, size: 20, _source: true });
  }

  if (body.length === 0) {
    return { documents: [], correspondence: [], meetings: [], projects: [], total: 0, engine: "elasticsearch" };
  }

  const msearchResult = await es.msearch({ body });
  const responses = msearchResult.responses ?? [];

  const resultMap: Record<string, any[]> = {};
  for (let i = 0; i < indicesToSearch.length; i++) {
    const idx = indicesToSearch[i];
    const hits = responses[i]?.hits?.hits ?? [];
    resultMap[idx] = hits.map((h: any) => ({ ...h._source, _score: h._score, resultType: idx.replace("edms_", "") }));
  }

  const documents = resultMap[IDX.documents] ?? [];
  const correspondence = resultMap[IDX.correspondence] ?? [];
  const meetings = resultMap[IDX.meetings] ?? [];
  const projects = resultMap[IDX.projects] ?? [];

  return {
    documents,
    correspondence,
    meetings,
    projects,
    total: documents.length + correspondence.length + meetings.length + projects.length,
    engine: "elasticsearch",
  };
}

// ─── SQL fallback backend ─────────────────────────────────────────────────────
async function sqlSearch(params: SearchParams): Promise<SearchResults> {
  const { q, projectId, organizationId, type, discipline, status } = params;
  const pat = `%${q}%`;
  const pId = projectId ?? undefined;
  // organizationId=undefined → system_owner cross-tenant view (no filter)
  const orgFilter = organizationId ?? undefined;

  let documents: any[] = [];
  let correspondence: any[] = [];
  let meetings: any[] = [];
  let projects: any[] = [];

  if (!type || type === "document" || type === "all") {
    const rows = await db
      .select({
        doc: documentsTable,
        createdBy: usersTable,
        folder: foldersTable,
        project: {
          id: projectsTable.id,
          name: projectsTable.name,
          code: projectsTable.code,
        },
      })
      .from(documentsTable)
      .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
      .leftJoin(foldersTable, eq(documentsTable.folderId, foldersTable.id))
      .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
      .where(
        and(
          pId ? eq(documentsTable.projectId, pId) : undefined,
          orgFilter ? eq(documentsTable.organizationId, orgFilter) : undefined,
          or(
            ilike(documentsTable.title, pat),
            ilike(documentsTable.documentNumber, pat),
            ilike(documentsTable.discipline, pat),
            ilike(documentsTable.documentType, pat),
            ilike(documentsTable.description, pat),
          ),
        ),
      )
      .orderBy(desc(documentsTable.updatedAt))
      .limit(20);

    let filtered = rows;
    if (discipline) filtered = filtered.filter((r) => r.doc.discipline === discipline);
    if (status) filtered = filtered.filter((r) => r.doc.status === status);

    documents = filtered.map(({ doc, createdBy, folder, project }) => ({
      ...doc,
      createdByName: createdBy ? `${createdBy.firstName} ${createdBy.lastName}` : undefined,
      folderName: folder?.name,
      project: project?.id ? project : undefined,
      resultType: "document",
    }));
  }

  if (!type || type === "correspondence" || type === "all") {
    const rows = await db
      .select({
        corr: correspondenceTable,
        project: {
          id: projectsTable.id,
          name: projectsTable.name,
          code: projectsTable.code,
        },
      })
      .from(correspondenceTable)
      .leftJoin(projectsTable, eq(correspondenceTable.projectId, projectsTable.id))
      .where(
        and(
          pId ? eq(correspondenceTable.projectId, pId) : undefined,
          orgFilter ? eq(correspondenceTable.organizationId, orgFilter) : undefined,
          or(
            ilike(correspondenceTable.subject, pat),
            ilike(correspondenceTable.body, pat),
            ilike(correspondenceTable.referenceNumber, pat),
          ),
        ),
      )
      .orderBy(desc(correspondenceTable.updatedAt))
      .limit(20);

    correspondence = rows.map(({ corr, project }) => ({
      ...corr,
      project: project?.id ? project : undefined,
      toUserIds: [],
      toUserNames: [],
      attachments: [],
      fromUserName: undefined,
      resultType: "correspondence",
    }));
  }

  if (!type || type === "meeting" || type === "all") {
    const rows = await db
      .select({
        meeting: meetingsTable,
        project: {
          id: projectsTable.id,
          name: projectsTable.name,
          code: projectsTable.code,
        },
      })
      .from(meetingsTable)
      .leftJoin(projectsTable, eq(meetingsTable.projectId, projectsTable.id))
      .where(
        and(
          pId ? eq(meetingsTable.projectId, pId) : undefined,
          orgFilter ? eq(meetingsTable.organizationId, orgFilter) : undefined,
          or(
            ilike(meetingsTable.title, pat),
            ilike(meetingsTable.agenda, pat),
            ilike(meetingsTable.location, pat),
            ilike(meetingsTable.referenceNumber, pat),
            ilike(meetingsTable.minutes, pat),
          ),
        ),
      )
      .orderBy(desc(meetingsTable.meetingDate))
      .limit(20);

    meetings = rows.map(({ meeting, project }) => ({
      ...meeting,
      project,
      resultType: "meeting",
    }));
  }

  if (!type || type === "project" || type === "all") {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          orgFilter ? eq(projectsTable.organizationId, orgFilter) : undefined,
          or(
            ilike(projectsTable.name, pat),
            ilike(projectsTable.code, pat),
            ilike(projectsTable.description, pat),
          ),
        ),
      )
      .orderBy(desc(projectsTable.updatedAt))
      .limit(10);

    projects = rows.map((p) => ({ ...p, resultType: "project" }));
  }

  return {
    documents,
    correspondence,
    meetings,
    projects,
    total: documents.length + correspondence.length + meetings.length + projects.length,
    engine: "sql",
  };
}
