-- =============================================================================
-- ArcScale EDMS — Full Safe Migration Script
-- Run this on the production database to bring it up to date.
-- Every statement uses IF NOT EXISTS / IF EXISTS so it is safe to re-run.
-- =============================================================================

-- ─── 1. ENUM TYPES ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('none','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rule_applies_to AS ENUM ('document','correspondence','both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE migration_job_status AS ENUM ('pending','analyzing','awaiting_review','executing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE migration_item_status AS ENUM ('pending','analyzing','analyzed','confirmed','skipped','imported','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add 'member' to user_role if missing
DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'member';
EXCEPTION WHEN others THEN NULL; END $$;

-- Add any missing values to notification_type
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'action_item_assigned';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_sla_reminder';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meeting_assigned';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meeting_reminder';
EXCEPTION WHEN others THEN NULL; END $$;

-- ─── 2. NEW COLUMNS ON EXISTING TABLES ────────────────────────────────────────

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS department            text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at     timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_version text;

-- documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source               text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issued_by            text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS direction            text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_confidential      boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS download_restricted  boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS watermark_text       text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_tags              jsonb DEFAULT '[]';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_priority          text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS additional_files     jsonb DEFAULT '[]';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_token          text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_expires_at     timestamp;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_password_hash  text;

-- transmittals
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS organization_id          integer REFERENCES organizations(id);
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS direction                text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS party_type               text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS review_code              text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS response_to_transmittal_id integer;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS review_outcome           text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_token              text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_expires_at         timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_password_hash      text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approval_status          approval_status NOT NULL DEFAULT 'none';
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approved_by_id           integer REFERENCES users(id);
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approval_comment         text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approved_at              timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS due_date                 timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS purpose                  text NOT NULL DEFAULT 'for_information';
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS to_external              text;

-- transmittal_items
ALTER TABLE transmittal_items ADD COLUMN IF NOT EXISTS review_code text;
ALTER TABLE transmittal_items ADD COLUMN IF NOT EXISTS purpose      text;

-- correspondence
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS scope               text NOT NULL DEFAULT 'project';
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS parent_id           integer;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS reference_number    text;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS assigned_to_id      integer REFERENCES users(id);
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS linked_document_id  integer;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS package_id          integer;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS direction           text;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS requires_response   boolean NOT NULL DEFAULT false;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS is_read             boolean NOT NULL DEFAULT false;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS first_read_at       timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS share_token         text;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS share_expires_at    timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS share_password_hash text;

-- org_config
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS subscription_tier       text DEFAULT 'free';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_provider             text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_model                text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_daily_limit          integer DEFAULT 0;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_monthly_token_limit  integer DEFAULT 0;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_type            text DEFAULT 's3';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_endpoint             text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_bucket               text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_region               text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_access_key           text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_secret_key           text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS system_name             text DEFAULT 'ArcScale EDMS';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS logo_url                text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS primary_color           text DEFAULT '#2563eb';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_quota_mb        integer DEFAULT 10240;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_path            text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS transmittal_prefix      text NOT NULL DEFAULT 'TRS';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS rfi_prefix              text NOT NULL DEFAULT 'RFI';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS submittal_prefix        text NOT NULL DEFAULT 'SUB';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ncr_prefix              text NOT NULL DEFAULT 'NCR';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS sla_defaults            jsonb NOT NULL DEFAULT '{"rfi":7,"submittal":14,"transmittal":5,"ncr":14}';

-- rules
ALTER TABLE rules ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS last_failed_at       timestamp;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS is_circuit_open      boolean NOT NULL DEFAULT false;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS applies_to           rule_applies_to NOT NULL DEFAULT 'both';

-- notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type     text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id       integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url      text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at         timestamp;

-- ─── 3. NEW TABLES ────────────────────────────────────────────────────────────

-- transmittal_history
CREATE TABLE IF NOT EXISTS transmittal_history (
  id              serial PRIMARY KEY,
  transmittal_id  integer NOT NULL REFERENCES transmittals(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  description     text NOT NULL,
  performed_by_name text,
  created_at      timestamp NOT NULL DEFAULT now()
);

-- correspondence_sequences (auto-numbering)
CREATE TABLE IF NOT EXISTS correspondence_sequences (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  scope           text NOT NULL,
  project_id      integer REFERENCES projects(id),
  year            integer NOT NULL,
  last_seq        integer NOT NULL DEFAULT 0,
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS correspondence_seq_uniq
  ON correspondence_sequences (organization_id, scope, project_id, year);

-- audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id              serial PRIMARY KEY,
  user_id         integer REFERENCES users(id),
  organization_id integer REFERENCES organizations(id),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       integer NOT NULL,
  entity_title    text,
  details         jsonb DEFAULT '{}',
  project_id      integer REFERENCES projects(id),
  ip_address      text,
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id ON audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id      ON audit_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at      ON audit_logs (created_at);

-- notification_event_types
CREATE TABLE IF NOT EXISTS notification_event_types (
  id                  serial PRIMARY KEY,
  event_key           text NOT NULL UNIQUE,
  label               text NOT NULL,
  description         text,
  is_mandatory        boolean NOT NULL DEFAULT false,
  is_scheduler_driven boolean NOT NULL DEFAULT false,
  default_enabled     boolean NOT NULL DEFAULT true,
  category            text NOT NULL DEFAULT 'general',
  created_at          timestamp NOT NULL DEFAULT now()
);

-- org_notification_settings
CREATE TABLE IF NOT EXISTS org_notification_settings (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key       text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  threshold_hours integer,
  updated_at      timestamp NOT NULL DEFAULT now(),
  updated_by_id   integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_org_notif_org ON org_notification_settings (organization_id);

-- scheduled_notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id              serial PRIMARY KEY,
  event_key       text NOT NULL,
  fire_at         timestamp NOT NULL,
  target_user_id  integer REFERENCES users(id) ON DELETE CASCADE,
  target_email    text,
  entity_type     text,
  entity_id       integer,
  metadata        jsonb,
  organization_id integer REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      integer REFERENCES projects(id) ON DELETE CASCADE,
  sent_at         timestamp,
  cancelled_at    timestamp,
  cancel_reason   text,
  created_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_notif_fire   ON scheduled_notifications (fire_at);
CREATE INDEX IF NOT EXISTS idx_sched_notif_entity ON scheduled_notifications (entity_type, entity_id);

-- notification_logs
CREATE TABLE IF NOT EXISTS notification_logs (
  id                serial PRIMARY KEY,
  event_key         text NOT NULL,
  recipient_user_id integer REFERENCES users(id),
  recipient_email   text,
  organization_id   integer REFERENCES organizations(id),
  entity_type       text,
  entity_id         integer,
  channel           text NOT NULL DEFAULT 'email',
  status            text NOT NULL,
  error_message     text,
  provider_id       text,
  created_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_recipient ON notification_logs (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_entity    ON notification_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_created   ON notification_logs (created_at);

-- delegations
CREATE TABLE IF NOT EXISTS delegations (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id),
  from_user_id        integer NOT NULL REFERENCES users(id),
  to_user_id          integer NOT NULL REFERENCES users(id),
  project_id          integer REFERENCES projects(id),
  reason              text NOT NULL,
  expires_at          timestamp NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  granted_by_user_id  integer NOT NULL REFERENCES users(id),
  granted_at          timestamp NOT NULL DEFAULT now(),
  revoked_at          timestamp,
  revoked_by_user_id  integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_delegations_org_id       ON delegations (organization_id);
CREATE INDEX IF NOT EXISTS idx_delegations_from_user_id ON delegations (from_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_to_user_id   ON delegations (to_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_project_id   ON delegations (project_id);
CREATE INDEX IF NOT EXISTS idx_delegations_expires_at   ON delegations (expires_at);

-- project_role_overrides
CREATE TABLE IF NOT EXISTS project_role_overrides (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id),
  project_id          integer NOT NULL REFERENCES projects(id),
  user_id             integer NOT NULL REFERENCES users(id),
  role_override       user_role NOT NULL,
  reason              text NOT NULL,
  expires_at          timestamp NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  granted_by_user_id  integer NOT NULL REFERENCES users(id),
  granted_at          timestamp NOT NULL DEFAULT now(),
  revoked_at          timestamp,
  revoked_by_user_id  integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_org_id     ON project_role_overrides (organization_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_project_id ON project_role_overrides (project_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_user_id    ON project_role_overrides (user_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_expires_at ON project_role_overrides (expires_at);

-- rule_execution_logs
CREATE TABLE IF NOT EXISTS rule_execution_logs (
  id              serial PRIMARY KEY,
  rule_id         integer NOT NULL REFERENCES rules(id),
  organization_id integer NOT NULL REFERENCES organizations(id),
  entity_type     text NOT NULL,
  entity_id       integer,
  actions_taken   jsonb NOT NULL DEFAULT '[]',
  success         boolean NOT NULL DEFAULT true,
  error_message   text,
  duration_ms     integer,
  executed_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_rule_id         ON rule_execution_logs (rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_organization_id ON rule_execution_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_executed_at     ON rule_execution_logs (executed_at);

-- system_settings
CREATE TABLE IF NOT EXISTS system_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- migration_jobs
CREATE TABLE IF NOT EXISTS migration_jobs (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id),
  project_id          integer NOT NULL REFERENCES projects(id),
  created_by_id       integer NOT NULL REFERENCES users(id),
  status              migration_job_status NOT NULL DEFAULT 'pending',
  plan                text NOT NULL DEFAULT 'basic',
  max_files           integer NOT NULL DEFAULT 200,
  storage_mode        text,
  base_url            text,
  imported_count      integer,
  skipped_count       integer,
  failed_count        integer,
  generated_registers jsonb DEFAULT '[]',
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

-- migration_items
CREATE TABLE IF NOT EXISTS migration_items (
  id                    serial PRIMARY KEY,
  job_id                integer NOT NULL REFERENCES migration_jobs(id),
  organization_id       integer NOT NULL REFERENCES organizations(id),
  file_path             text NOT NULL,
  file_name             text NOT NULL,
  file_size             integer,
  file_type             text,
  file_url              text,
  extracted_title       text,
  extracted_code        text,
  extracted_discipline  text,
  extracted_doc_type    text,
  extracted_revision    text,
  extracted_date        text,
  extracted_issuer      text,
  extracted_is_reply    integer DEFAULT 0,
  extracted_reply_to    text,
  confidence            integer NOT NULL DEFAULT 0,
  confidence_label      text,
  title                 text,
  code                  text,
  discipline            text,
  doc_type              text,
  revision              text,
  doc_date              text,
  issuer                text,
  status                migration_item_status NOT NULL DEFAULT 'pending',
  skip                  integer NOT NULL DEFAULT 0,
  imported_document_id  integer,
  error_message         text,
  analyzed_at           timestamp,
  imported_at           timestamp,
  created_at            timestamp NOT NULL DEFAULT now()
);

-- ─── 4. DONE ──────────────────────────────────────────────────────────────────
SELECT 'Migration complete.' AS result;
