/**
 * Generates ArcScale_EDMS_Architecture_and_Recovery_State.docx
 * Run: node docs/exports/generate_docx.mjs
 */
import { createRequire } from "module";
const require = createRequire("/tmp/node_modules/docx/package.json");

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, UnderlineType, PageBreak,
  TableOfContents, StyleLevel, Header, Footer,
  PageNumber, NumberFormat, LevelFormat, convertInchesToTwip,
} = await import("/tmp/node_modules/docx/dist/index.mjs");

// ── Helpers ──────────────────────────────────────────────────────────────────

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, ...opts })],
    spacing: { after: 120 },
  });
}
function bold(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { after: 100 },
  });
}
function code(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: "Courier New", size: 18, color: "1F3864" })],
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.4) },
    shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level },
    spacing: { after: 80 },
  });
}
function warning(text) {
  return new Paragraph({
    children: [new TextRun({ text: `⚠  ${text}`, bold: true, color: "C00000", size: 22 })],
    spacing: { before: 100, after: 100 },
    indent: { left: convertInchesToTwip(0.3) },
  });
}
function spacer() {
  return new Paragraph({ text: "", spacing: { after: 120 } });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function kv(key, value) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${key}: `, bold: true, size: 22 }),
      new TextRun({ text: value, size: 22 }),
    ],
    spacing: { after: 80 },
  });
}

function simpleTable(headers, rows) {
  const headerCells = headers.map(h =>
    new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 20 })],
      })],
      shading: { type: ShadingType.CLEAR, fill: "1F3864" },
      width: { size: Math.floor(9000 / headers.length), type: WidthType.DXA },
    })
  );
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map(cell =>
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? ""), size: 20 })],
          })],
          shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? "FFFFFF" : "EEF2F7" },
          width: { size: Math.floor(9000 / row.length), type: WidthType.DXA },
        })
      ),
    })
  );
  return new Table({
    rows: [new TableRow({ children: headerCells, tableHeader: true }), ...dataRows],
    width: { size: 9000, type: WidthType.DXA },
  });
}

// ── Document sections ────────────────────────────────────────────────────────

const children = [

  // ── COVER PAGE ─────────────────────────────────────────────────────────────
  new Paragraph({
    children: [new TextRun({ text: "ArcScale EDMS", bold: true, size: 72, color: "1F3864" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 1440, after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Architecture & Recovery State", size: 40, color: "2E74B5" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Canonical Reference Document", size: 28, italics: true, color: "595959" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Version: Post-Recovery 2026-05-08", size: 24, color: "595959" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Commit: f66372c7f6cddc223af4504b05ae7599fc057c3e", size: 24, color: "595959", font: "Courier New" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Domain: https://www.arcscale.org", size: 24, color: "595959" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 1800 },
  }),
  warning("PRODUCTION DOCUMENT — Contains system architecture and recovery procedures. Do not distribute externally."),
  pageBreak(),

  // ── SECTION 1: PRODUCTION STATE ────────────────────────────────────────────
  h1("1. Current Production State"),
  simpleTable(
    ["Item", "Value"],
    [
      ["Domain", "https://www.arcscale.org"],
      ["Stack", "React + Vite, Express 5, PostgreSQL 16, Drizzle ORM 0.45.1"],
      ["Infrastructure", "Docker Compose, Hetzner VPS, Nginx + Cloudflare"],
      ["Storage", "Cloudflare R2 (global default)"],
      ["Production status", "Recovered and running"],
      ["API container", "Healthy (edms_api)"],
      ["PostgreSQL", "Healthy (edms_postgres)"],
      ["Frontend", "Healthy (edms_frontend)"],
      ["Latest recovery date", "2026-05-08"],
      ["Known-good commit", "f66372c"],
      ["VPS path", "/var/www/edms"],
    ]
  ),
  spacer(),
  pageBreak(),

  // ── SECTION 2: RECOVERY SUMMARY ────────────────────────────────────────────
  h1("2. Production Recovery Incident — 2026-05-08"),
  h2("2.1 Incident Summary"),
  p("The ArcScale EDMS API container entered a persistent restart loop on deployment. The HTTP server never started. Every container restart aborted during the Drizzle ORM migration phase in docker-entrypoint.sh. PostgreSQL remained healthy and data was intact throughout."),
  spacer(),
  h2("2.2 Symptoms"),
  bullet("edms_api container restarting in a loop"),
  bullet("Migration errors visible in docker compose logs before any API log lines"),
  bullet("Frontend running but all API calls returning connection errors"),
  bullet("PostgreSQL healthy; data intact"),
  bullet("Error: ERROR 42710 — duplicate_object: enum label \"expired\" already exists"),
  spacer(),
  h2("2.3 False Leads"),
  h3("False Lead 1 — Suspected 0004a_add_expired_enum_value.sql"),
  p("Multiple fixes were applied to 0004a (IF NOT EXISTS, then DO $$ EXCEPTION guard) — error persisted each time. The SQL in the error log used the schema-qualified form \"public\".\"subscription_status\" which never appeared in 0004a in any commit."),
  h3("False Lead 2 — Suspected Stale Docker Image Cache"),
  p("docker compose build --no-cache api was already in use. Layer cache was not the issue."),
  h3("False Lead 3 — Suspected Volume Bind Mount"),
  p("Only uploads_data:/app/uploads is mounted. No volume touches /app/lib/db/drizzle/."),
  spacer(),
  h2("2.4 Actual Root Cause"),
  warning("The failing SQL was in 0007_remarkable_ben_urich.sql — NOT in 0004a."),
  spacer(),
  p("0007 was auto-generated by drizzle-kit from the snapshot diff between 0003_snapshot (no 'expired') and 0007_snapshot (has 'expired'). Because 0004a was written manually without a matching snapshot, drizzle-kit did not know 'expired' had already been added and re-generated the raw ALTER TYPE."),
  spacer(),
  bold("The failing SQL (line 1 of 0007):"),
  code('ALTER TYPE "public"."subscription_status" ADD VALUE \'expired\';'),
  spacer(),
  p("ensureEnumValues() pre-commits 'expired' via pool.query() in autocommit mode before migrate() opens its outer BEGIN. When 0007 then ran ALTER TYPE ADD VALUE inside that transaction, PostgreSQL rejected it with 42710."),
  spacer(),
  h2("2.5 Fix Applied"),
  bold("File: lib/db/drizzle/0007_remarkable_ben_urich.sql"),
  p("Replaced line 1 with an idempotent DO $$ EXCEPTION block:"),
  code("DO $$"),
  code("BEGIN"),
  code('    ALTER TYPE "public"."subscription_status" ADD VALUE IF NOT EXISTS \'expired\';'),
  code("EXCEPTION"),
  code("    WHEN duplicate_object THEN NULL;"),
  code("END;"),
  code("$$;--> statement-breakpoint"),
  code("ALTER TABLE \"subscriptions\" ALTER COLUMN \"plan_id\" SET DEFAULT 'expired';--> statement-breakpoint"),
  code("ALTER TABLE \"subscriptions\" ALTER COLUMN \"status\" SET DEFAULT 'expired';"),
  spacer(),
  h2("2.6 Recovery Commits"),
  simpleTable(
    ["Commit", "Change"],
    [
      ["(earlier)", "PostgreSQL port — removed public 5432 binding"],
      ["(earlier)", "free → expired plan rename"],
      ["(earlier)", "DATABASE_URL underscore fix"],
      ["(earlier)", "Migration 0003 IF NOT EXISTS guard"],
      ["124dca4", "Fix missing ai_models table — CREATE TABLE IF NOT EXISTS in 0004b"],
      ["dfa8680", "Add ensureEnumValues() pre-migration step in migrate.ts"],
      ["32116dd", "Rewrite 0004a as DO $$ EXCEPTION block"],
      ["f66372c", "Fix 0007 — ACTUAL ROOT CAUSE — DO $$ EXCEPTION guard"],
    ]
  ),
  spacer(),
  h2("2.7 Validation"),
  p("After deploying f66372c, logs confirmed:"),
  code("[migrate] ensureEnumValues: committed subscription_status → 'expired'"),
  code("[migrate] All migrations applied successfully."),
  code("GET /api/health → 200 OK"),
  spacer(),
  p("drizzle.__drizzle_migrations contains 8 rows (entries 0000 through 0007). API, RLS, and seed jobs all completed successfully."),
  pageBreak(),

  // ── SECTION 3: ARCHITECTURE OVERVIEW ───────────────────────────────────────
  h1("3. Architecture Overview"),
  h2("3.1 Stack"),
  simpleTable(
    ["Layer", "Technology", "Notes"],
    [
      ["Frontend", "React + Vite", "SPA — served by Nginx"],
      ["API", "Express 5, TypeScript", "Node.js 22, esbuild bundle"],
      ["ORM", "Drizzle ORM 0.45.1", "Runtime migrator, no drizzle-kit in prod"],
      ["Database", "PostgreSQL 16 Alpine", "Internal Docker network only"],
      ["Reverse proxy", "Nginx + Cloudflare", "TLS termination at Cloudflare edge"],
      ["Container", "Docker Compose", "3 services: api, frontend, postgres"],
      ["Storage", "Cloudflare R2", "Global default; local /app/uploads as fallback"],
      ["VPS", "Hetzner", "Path: /var/www/edms"],
      ["Package manager", "pnpm 10 (monorepo)", "Workspace: lib/, artifacts/"],
    ]
  ),
  spacer(),
  h2("3.2 Monorepo Structure"),
  code("lib/"),
  code("  db/              ← Drizzle schema, migrations, drizzle.config.ts"),
  code("  api-spec/        ← OpenAPI spec"),
  code("  api-zod/         ← Zod validators"),
  code("  api-client-react/ ← React query hooks"),
  code("artifacts/"),
  code("  api-server/      ← Express API (src/, dist/)"),
  code("  edms/            ← React frontend"),
  spacer(),
  h2("3.3 Migration System"),
  p("Migrations run automatically on every container start via docker-entrypoint.sh → node dist/migrate.mjs. The sequence is:"),
  bullet("1. ensureBaseline() — creates drizzle.__drizzle_migrations if absent; baselines existing databases"),
  bullet("2. ensureEnumValues() — pre-commits enum values in autocommit mode before Drizzle's outer BEGIN"),
  bullet("3. migrate(db, { migrationsFolder }) — Drizzle runtime migrator applies pending .sql files"),
  spacer(),
  warning("drizzle-kit is NOT installed in production images. Only the runtime migrator is used."),
  spacer(),
  p("Migration files are located at: /app/lib/db/drizzle/ inside the container (copied by Dockerfile COPY lib/db/drizzle ./lib/db/drizzle)."),
  pageBreak(),

  // ── SECTION 4: MULTI-TENANT ARCHITECTURE ──────────────────────────────────
  h1("4. Multi-Tenant Architecture"),
  warning("Organization boundary = Security boundary. Project boundary = Workspace only. Never rely on project_id alone for tenant isolation."),
  spacer(),
  h2("4.1 Boundary Definitions"),
  simpleTable(
    ["Boundary", "Key", "Purpose", "Isolation Level"],
    [
      ["Organization", "organization_id", "Security boundary; all access scoped here", "Hard — server-enforced on every query"],
      ["Project", "project_id", "Business/workspace grouping within an org", "Soft — UX filter only, never security"],
    ]
  ),
  spacer(),
  h2("4.2 Enforcement Layers"),
  simpleTable(
    ["Layer", "Responsibility"],
    [
      ["RLS policies", "PostgreSQL row-level security; initialized on startup; scope to org"],
      ["API middleware", "Extracts organization_id from JWT; validated before every handler"],
      ["Service layer", "Passes organizationId to every DB call"],
      ["Frontend", "UX filtering only — never authoritative"],
    ]
  ),
  spacer(),
  h2("4.3 Required Query Pattern"),
  code("db.select().from(documents).where("),
  code("  and("),
  code("    eq(documents.organizationId, req.organizationId), // from validated JWT"),
  code("    eq(documents.projectId, projectId)                // UX filter only"),
  code("  )"),
  code(");"),
  spacer(),
  h2("4.4 Forbidden Patterns"),
  warning("FORBIDDEN — project_id only, no organization_id"),
  code("db.select().from(documents).where(eq(documents.projectId, projectId));"),
  warning("FORBIDDEN — trusting user-supplied org without validation"),
  code("db.select().from(documents).where(eq(documents.organizationId, req.body.orgId));"),
  pageBreak(),

  // ── SECTION 5: SECURITY MODEL ──────────────────────────────────────────────
  h1("5. Security Model"),
  h2("5.1 Permission Roles"),
  simpleTable(
    ["Role", "Capabilities"],
    [
      ["System owner", "Full system access, org management"],
      ["Admin", "Org-wide admin, user management"],
      ["Project manager", "Manage projects, assign roles"],
      ["Document controller", "Upload, transmit, issue documents"],
      ["Reviewer", "Review and comment"],
      ["Member", "Standard document access"],
      ["Viewer", "Read-only within assigned scope"],
      ["Read-only override", "Explicit read-only regardless of role"],
    ]
  ),
  spacer(),
  h2("5.2 Network Security"),
  simpleTable(
    ["Item", "Status"],
    [
      ["PostgreSQL port 5432", "Internal Docker network only — NOT publicly exposed"],
      ["DATABASE_URL", "Supplied via Compose environment override"],
      ["HTTP/HTTPS", "Protected by Nginx + Cloudflare"],
      ["JWT_SECRET", "Required in .env — never committed to git"],
      ["REFRESH_TOKEN_SECRET", "Required in .env — never committed to git"],
      ["RLS policies", "Initialized on API startup"],
      ["Secrets in git", "FORBIDDEN — use .env on VPS"],
    ]
  ),
  spacer(),
  h2("5.3 Enforcement Rule"),
  warning("Server-side enforcement is authoritative. UI hiding is not a security control."),
  pageBreak(),

  // ── SECTION 6: AI ROUTING ──────────────────────────────────────────────────
  h1("6. AI Routing Architecture"),
  simpleTable(
    ["Item", "Value"],
    [
      ["Routing mode", "Hybrid — credits-based"],
      ["Premium provider", "OpenRouter"],
      ["Premium model", "anthropic/claude-3.5-sonnet"],
      ["Fallback provider", "Cloudflare Workers AI"],
      ["Credit threshold", "50 credits"],
      ["Settings source", "Seeded on startup (ai_models table)"],
      ["Required env var", "OPENROUTER_API_KEY"],
    ]
  ),
  spacer(),
  h2("6.1 Routing Logic"),
  bullet("If org has ≥ 50 AI credits → route to OpenRouter (premium)"),
  bullet("If org has < 50 AI credits → route to Cloudflare Workers AI (free tier)"),
  bullet("AI cost and credit consumption must be tracked and monitored in production"),
  spacer(),
  warning("OPENROUTER_API_KEY must be present in VPS .env before deployment. Without it all premium AI calls will fail silently."),
  pageBreak(),

  // ── SECTION 7: BILLING AND SUBSCRIPTION ───────────────────────────────────
  h1("7. Billing and Subscription Architecture"),
  simpleTable(
    ["Status", "Meaning", "Access"],
    [
      ["expired", "Legacy free migrated; restricted fallback", "Minimal — upload blocked, AI blocked"],
      ["trialing", "Temporary paid-tier access", "Full features, time-limited"],
      ["active", "Paid, in good standing", "Full features"],
      ["past_due", "Payment failed", "Restricted; grace period applies"],
      ["canceled", "Subscription ended", "Restricted"],
    ]
  ),
  spacer(),
  h2("7.1 Notes"),
  bullet("Legacy 'free' status is being migrated to 'expired' (migrations 0004a–0004c)"),
  bullet("'expired' is the safe restricted fallback — not a deleted state"),
  bullet("Module entitlements reset to plan defaults on status change"),
  bullet("plans table is seeded during API startup via seed-wf-defaults.mjs"),
  bullet("Trial downgrade jobs must be monitored in production"),
  pageBreak(),

  // ── SECTION 8: STORAGE ARCHITECTURE ───────────────────────────────────────
  h1("8. Storage Architecture"),
  simpleTable(
    ["Item", "Value"],
    [
      ["Global default", "Cloudflare R2"],
      ["Local fallback", "/app/uploads"],
      ["Docker volume", "uploads_data:/app/uploads"],
      ["R2 credentials", "R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT, CF_ACCOUNT_ID"],
      ["DEFAULT_STORAGE_TYPE", "onpremise (observed in logs — review needed)"],
    ]
  ),
  spacer(),
  warning("DEFAULT_STORAGE_TYPE=onpremise observed in production logs while R2 is configured. Verify VPS .env and review storage routing logic."),
  pageBreak(),

  // ── SECTION 9: MIGRATION GOVERNANCE ───────────────────────────────────────
  h1("9. Migration Governance Rules"),
  warning("These rules exist because violating them caused the 2026-05-08 production outage."),
  spacer(),
  h2("9.1 Enum DDL Rules"),
  bold("Rule E1 — Never write raw ALTER TYPE ... ADD VALUE"),
  code("-- FORBIDDEN"),
  code("ALTER TYPE subscription_status ADD VALUE 'new_value';"),
  spacer(),
  bold("Rule E2 — Always use the DO $$ EXCEPTION pattern"),
  code("DO $$"),
  code("BEGIN"),
  code("    ALTER TYPE your_enum ADD VALUE IF NOT EXISTS 'new_value';"),
  code("EXCEPTION"),
  code("    WHEN duplicate_object THEN NULL;"),
  code("END;"),
  code("$$;"),
  spacer(),
  bold("Rule E3 — Inspect every drizzle-kit generated migration before deploying"),
  p("drizzle-kit generate always outputs raw ALTER TYPE without guards. Rewrite before deploying."),
  spacer(),
  h2("9.2 Manual Migration Rules"),
  bullet("After writing a manual migration, run: pnpm --filter @workspace/db generate and inspect the output"),
  bullet("Manual migrations must have a matching journal entry in meta/_journal.json"),
  bullet("Document why the migration was written manually"),
  bullet("Never edit drizzle.__drizzle_migrations except for emergency recovery (with backup)"),
  spacer(),
  h2("9.3 Pre-Deploy Checklist"),
  simpleTable(
    ["Check", "Action"],
    [
      ["Read all new .sql files", "Every file added since last deploy"],
      ["Search ALTER TYPE ADD VALUE", "Rewrite any without DO $$ EXCEPTION"],
      ["Check _journal.json", "Every .sql file has a matching entry"],
      ["Verify ensureEnumValues()", "Covers all new enum values"],
      ["Review git diff", "git diff lib/db/drizzle/"],
      ["Take database backup", "Before every migration deploy"],
    ]
  ),
  pageBreak(),

  // ── SECTION 10: DEPLOYMENT PROCEDURES ─────────────────────────────────────
  h1("10. Deployment Procedures"),
  h2("10.1 Standard Deploy"),
  code("cd /var/www/edms"),
  code("git pull"),
  code("docker compose build --no-cache api"),
  code("docker compose up -d --force-recreate api"),
  code("docker compose logs api --tail=200 -f"),
  spacer(),
  h2("10.2 Rebuild Frontend"),
  code("docker compose build --no-cache \\"),
  code('  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\'),
  code('  --build-arg GIT_HASH="$(git rev-parse --short HEAD)" \\'),
  code("  frontend"),
  code("docker compose up -d --force-recreate frontend"),
  spacer(),
  h2("10.3 Emergency Manual Migration"),
  code("docker exec -i edms_postgres psql -U edms -d edms < migrate_production.sql"),
  spacer(),
  h2("10.4 Health Check"),
  code("curl -sf http://localhost:8080/api/health"),
  spacer(),
  h2("10.5 Docker Services"),
  simpleTable(
    ["Service", "Container", "Port", "Exposure"],
    [
      ["API", "edms_api", "8080", "Internal only"],
      ["Frontend", "edms_frontend", "80, 443", "Public (via Nginx + Cloudflare)"],
      ["PostgreSQL", "edms_postgres", "5432", "Internal Docker network only"],
    ]
  ),
  pageBreak(),

  // ── SECTION 11: TECHNICAL DEBT ─────────────────────────────────────────────
  h1("11. Technical Debt Register"),
  simpleTable(
    ["ID", "Item", "Risk", "Priority"],
    [
      ["TD-01", "Enum drift between manual migrations and drizzle snapshots", "High", "High"],
      ["TD-02", "Legacy 'free' references in codebase", "Medium", "Medium"],
      ["TD-03", "Shadow enforcement: UI restricts but backend may not", "High", "High"],
      ["TD-04", "No CI migration validation step", "High", "High"],
      ["TD-05", "No test suite for tenant isolation", "High", "High"],
      ["TD-06", "No test suite for billing restrictions", "High", "Medium"],
      ["TD-07", "No test suite for RLS policies", "High", "Medium"],
      ["TD-08", "Obsolete version: field in docker-compose.yml", "Low", "Low"],
      ["TD-09", "DEFAULT_STORAGE_TYPE=onpremise while R2 is configured", "Medium", "Medium"],
    ]
  ),
  pageBreak(),

  // ── SECTION 12: MONITORING ROADMAP ────────────────────────────────────────
  h1("12. Monitoring Roadmap"),
  simpleTable(
    ["Item", "Priority", "Status"],
    [
      ["Uptime monitoring", "High", "TODO"],
      ["API health check alerting", "High", "TODO"],
      ["Database backup schedule", "High", "TODO"],
      ["R2 upload failure alerts", "Medium", "TODO"],
      ["AI usage / cost monitoring", "Medium", "TODO"],
      ["Trial downgrade job monitoring", "Medium", "TODO"],
      ["Migration failure alerting", "High", "TODO"],
      ["Disk usage monitoring", "Medium", "TODO"],
      ["SSL / Cloudflare checks", "Medium", "TODO"],
    ]
  ),
  pageBreak(),

  // ── SECTION 13: CI/CD STABILIZATION ───────────────────────────────────────
  h1("13. CI/CD Stabilization Roadmap"),
  simpleTable(
    ["Step", "Description"],
    [
      ["TypeScript typecheck", "tsc --noEmit on every PR"],
      ["ESLint", "Lint all packages"],
      ["Unit tests", "Core business logic"],
      ["API smoke tests", "Health, auth, document CRUD"],
      ["Migration dry-run", "Inspect generated SQL before deploy"],
      ["Docker build validation", "Build succeeds on CI"],
      ["Post-deploy health check", "Automated curl after deploy"],
      ["DB backup before migration", "Snapshot before every migration run"],
      ["Rollback procedure", "Documented and tested"],
    ]
  ),
  pageBreak(),

  // ── SECTION 14: BACKUP AND RECOVERY ──────────────────────────────────────
  h1("14. Backup and Recovery"),
  h2("14.1 Take a Backup"),
  code("docker exec edms_postgres pg_dump -U edms -d edms \\"),
  code('  > backup_$(date +%Y%m%d_%H%M%S).sql'),
  spacer(),
  h2("14.2 Restore a Backup"),
  code("docker exec -i edms_postgres psql -U edms -d edms < backup_YYYYMMDD_HHMMSS.sql"),
  spacer(),
  h2("14.3 Emergency Journal Correction"),
  p("If a migration was applied outside of Drizzle (e.g. via ensureEnumValues) and Drizzle keeps failing to apply it, mark it as applied manually:"),
  code("INSERT INTO drizzle.__drizzle_migrations (hash, created_at)"),
  code("SELECT '<sha256-of-file>', <journal-when-timestamp>"),
  code("WHERE NOT EXISTS ("),
  code("  SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = <timestamp>"),
  code(");"),
  spacer(),
  warning("Only perform journal correction after taking a verified backup. Log the operation in the incident record."),
  pageBreak(),

  // ── SECTION 15: KNOWN-GOOD STATE ─────────────────────────────────────────
  h1("15. Known-Good Production State"),
  simpleTable(
    ["Item", "Value"],
    [
      ["Last known-good commit", "f66372c7f6cddc223af4504b05ae7599fc057c3e"],
      ["Recovery date", "2026-05-08"],
      ["Recovery backup", "post_recovery_backup.sql (on VPS)"],
      ["API health", "200 OK"],
      ["Migrations", "All applied (0000–0007, 8 rows in drizzle.__drizzle_migrations)"],
      ["RLS", "Initialized on startup"],
      ["Seed jobs", "Completed"],
      ["AI settings", "Seeded (ai_models table populated)"],
    ]
  ),
  spacer(),
  h2("15.1 AI Collaboration Workflow"),
  simpleTable(
    ["Tool", "Role"],
    [
      ["Replit", "Code execution, file editing, workflow management"],
      ["Claude", "Engineering consultation, code review, implementation"],
      ["ChatGPT", "Architecture review, production recovery reasoning, technical PM, documentation, cross-checking"],
    ]
  ),
  spacer(),
  warning("Major production changes require root-cause analysis before execution. Never apply a fix without first confirming the cause."),
];

// ── Build and write document ─────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Calibri", size: 22, color: "2E2E2E" },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        run: { bold: true, size: 32, color: "1F3864" },
        paragraph: { spacing: { before: 400, after: 200 } },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        run: { bold: true, size: 26, color: "2E74B5" },
        paragraph: { spacing: { before: 300, after: 150 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        run: { bold: true, size: 22, color: "2E74B5" },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.2),
          },
        },
      },
      children,
    },
  ],
});

const outPath = path.join(__dirname, "ArcScale_EDMS_Architecture_and_Recovery_State.docx");
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log("Generated:", outPath, `(${(buffer.length / 1024).toFixed(1)} KB)`);
