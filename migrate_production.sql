-- =============================================================================
-- ArcScale EDMS — COMPLETE Safe Migration Script (v4 — definitive)
-- =============================================================================
-- Covers EVERY table and column in the current schema.
-- Safe to run multiple times — all statements use IF NOT EXISTS.
-- Run as:
--   docker exec -i edms_postgres psql -U edms -d edms < migrate_production.sql
-- =============================================================================

-- ─── SECTION 1: ENUM TYPES ────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE approval_status          AS ENUM ('none','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE rule_applies_to          AS ENUM ('document','correspondence','both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE migration_job_status     AS ENUM ('pending','analyzing','awaiting_review','executing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE migration_item_status    AS ENUM ('pending','analyzing','analyzed','confirmed','skipped','imported','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE subscription_status      AS ENUM ('free','active','trialing','past_due','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE task_status              AS ENUM ('pending','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE task_priority            AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE task_source_type         AS ENUM ('manual','workflow','correspondence');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE metadata_field_type      AS ENUM ('text','number','date','select','multiselect','boolean');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE metadata_applies_to      AS ENUM ('document','correspondence','all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE chat_group_type          AS ENUM ('project','department','general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE chat_member_role         AS ENUM ('admin','member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE meeting_status           AS ENUM ('scheduled','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE deliverable_status       AS ENUM ('not_started','in_progress','submitted','approved','rejected','on_hold','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ai_module                AS ENUM ('documents','correspondence','tasks','search','notifications','meetings','inspections');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add values to existing enums (safe — IF NOT EXISTS per value)
DO $$ BEGIN ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'member'; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'action_item_assigned';  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_sla_reminder'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meeting_assigned';      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meeting_reminder';      EXCEPTION WHEN others THEN NULL; END $$;

-- ─── SECTION 2: NEW COLUMNS ON EXISTING TABLES ────────────────────────────────

-- organizations
-- Enum for organization type (must exist before the column is added)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_type') THEN
    CREATE TYPE organization_type AS ENUM ('client', 'consultant', 'contractor', 'subcontractor');
  END IF;
END $$;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS code                       text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_code_unique'
  ) THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_code_unique UNIQUE (code);
  END IF;
END $$;

-- Add type as nullable first, back-fill, then enforce NOT NULL
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS type organization_type;
UPDATE organizations SET type = 'contractor' WHERE type IS NULL;
ALTER TABLE organizations ALTER COLUMN type SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN type SET DEFAULT 'contractor';

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email              text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone              text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address                    text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_tier          text          DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storage_used_mb            integer       NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS corr_unread_reminder_hours integer       NOT NULL DEFAULT 48;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS corr_no_response_hours     integer       NOT NULL DEFAULT 72;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS corr_sla_due_soon_hours    integer       NOT NULL DEFAULT 24;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at                 timestamp     NOT NULL DEFAULT now();

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS department             text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at      timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_version  text;

-- refresh_tokens
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at      timestamp;

-- password_reset_tokens
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);

-- documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source               text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issued_by            text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS direction            text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_confidential      boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS download_restricted  boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS watermark_text       text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_tags              jsonb   DEFAULT '[]';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_priority          text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS additional_files     jsonb   DEFAULT '[]';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_token          text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_expires_at     timestamp;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_password_hash  text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS organization_id      integer REFERENCES organizations(id);

-- folders
ALTER TABLE folders ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);

-- transmittals
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS organization_id              integer REFERENCES organizations(id);
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS to_external                  text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS due_date                     timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS purpose                      text NOT NULL DEFAULT 'for_information';
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_token                  text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_expires_at             timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS share_password_hash          text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approval_status              approval_status NOT NULL DEFAULT 'none';
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approved_by_id               integer REFERENCES users(id);
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approval_comment             text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS approved_at                  timestamp;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS direction                    text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS party_type                   text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS review_code                  text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS response_to_transmittal_id   integer;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS review_outcome               text;

-- transmittal_items
ALTER TABLE transmittal_items ADD COLUMN IF NOT EXISTS review_code text;
ALTER TABLE transmittal_items ADD COLUMN IF NOT EXISTS purpose      text;

-- correspondence
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS scope               text    NOT NULL DEFAULT 'project';
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
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS recalled_at         timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS recalled_by_id      integer REFERENCES users(id);
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS due_date            timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS sent_at             timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS closed_at           timestamp;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS updated_at          timestamp NOT NULL DEFAULT now();

-- notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type     text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id       integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url      text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at         timestamp;

-- org_config
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS transmittal_prefix      text    NOT NULL DEFAULT 'TRS';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS rfi_prefix              text    NOT NULL DEFAULT 'RFI';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS submittal_prefix        text    NOT NULL DEFAULT 'SUB';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ncr_prefix              text    NOT NULL DEFAULT 'NCR';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS sla_defaults            jsonb   NOT NULL DEFAULT '{"rfi":7,"submittal":14,"transmittal":5,"ncr":14}';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS system_name             text    DEFAULT 'ArcScale EDMS';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS logo_url                text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS primary_color           text    DEFAULT '#2563eb';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_quota_mb        integer DEFAULT 10240;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_path            text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS storage_type            text    DEFAULT 's3';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_endpoint             text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_bucket               text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_region               text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_access_key           text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS s3_secret_key           text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS subscription_tier       text    DEFAULT 'free';
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_provider             text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_model                text;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_daily_limit          integer DEFAULT 0;
ALTER TABLE org_config ADD COLUMN IF NOT EXISTS ai_monthly_token_limit  integer DEFAULT 0;

-- rules
ALTER TABLE rules ADD COLUMN IF NOT EXISTS consecutive_failures integer        NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS last_failed_at       timestamp;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS is_circuit_open      boolean        NOT NULL DEFAULT false;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS applies_to           rule_applies_to NOT NULL DEFAULT 'both';

-- ─── SECTION 3: NEW TABLES ────────────────────────────────────────────────────

-- correspondence_cc  (was missing from original migration)
CREATE TABLE IF NOT EXISTS correspondence_cc (
  id                  serial   PRIMARY KEY,
  correspondence_id   integer  NOT NULL REFERENCES correspondence(id),
  user_id             integer  NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_correspondence_cc_corr_id ON correspondence_cc (correspondence_id);
CREATE INDEX IF NOT EXISTS idx_correspondence_cc_user_id ON correspondence_cc (user_id);

-- transmittal_history
CREATE TABLE IF NOT EXISTS transmittal_history (
  id               serial      PRIMARY KEY,
  transmittal_id   integer     NOT NULL REFERENCES transmittals(id) ON DELETE CASCADE,
  event_type       text        NOT NULL,
  description      text        NOT NULL,
  performed_by_name text,
  created_at       timestamp   NOT NULL DEFAULT now()
);

-- correspondence_sequences
CREATE TABLE IF NOT EXISTS correspondence_sequences (
  id               serial      PRIMARY KEY,
  organization_id  integer     NOT NULL REFERENCES organizations(id),
  scope            text        NOT NULL,
  project_id       integer     REFERENCES projects(id),
  year             integer     NOT NULL,
  last_seq         integer     NOT NULL DEFAULT 0,
  updated_at       timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS correspondence_seq_uniq
  ON correspondence_sequences (organization_id, scope, project_id, year);

-- audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id               serial      PRIMARY KEY,
  user_id          integer     REFERENCES users(id),
  organization_id  integer     REFERENCES organizations(id),
  action           text        NOT NULL,
  entity_type      text        NOT NULL,
  entity_id        integer     NOT NULL,
  entity_title     text,
  details          jsonb       DEFAULT '{}',
  project_id       integer     REFERENCES projects(id),
  ip_address       text,
  created_at       timestamp   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id ON audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id      ON audit_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at      ON audit_logs (created_at);

-- notification_event_types
CREATE TABLE IF NOT EXISTS notification_event_types (
  id                   serial    PRIMARY KEY,
  event_key            text      NOT NULL UNIQUE,
  label                text      NOT NULL,
  description          text,
  is_mandatory         boolean   NOT NULL DEFAULT false,
  is_scheduler_driven  boolean   NOT NULL DEFAULT false,
  default_enabled      boolean   NOT NULL DEFAULT true,
  category             text      NOT NULL DEFAULT 'general',
  created_at           timestamp NOT NULL DEFAULT now()
);

-- org_notification_settings
CREATE TABLE IF NOT EXISTS org_notification_settings (
  id               serial    PRIMARY KEY,
  organization_id  integer   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key        text      NOT NULL,
  enabled          boolean   NOT NULL DEFAULT true,
  threshold_hours  integer,
  updated_at       timestamp NOT NULL DEFAULT now(),
  updated_by_id    integer   REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_org_notif_org ON org_notification_settings (organization_id);

-- scheduled_notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id               serial    PRIMARY KEY,
  event_key        text      NOT NULL,
  fire_at          timestamp NOT NULL,
  target_user_id   integer   REFERENCES users(id) ON DELETE CASCADE,
  target_email     text,
  entity_type      text,
  entity_id        integer,
  metadata         jsonb,
  organization_id  integer   REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       integer   REFERENCES projects(id) ON DELETE CASCADE,
  sent_at          timestamp,
  cancelled_at     timestamp,
  cancel_reason    text,
  created_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_notif_fire   ON scheduled_notifications (fire_at);
CREATE INDEX IF NOT EXISTS idx_sched_notif_entity ON scheduled_notifications (entity_type, entity_id);

-- notification_logs
CREATE TABLE IF NOT EXISTS notification_logs (
  id                 serial    PRIMARY KEY,
  event_key          text      NOT NULL,
  recipient_user_id  integer   REFERENCES users(id),
  recipient_email    text,
  organization_id    integer   REFERENCES organizations(id),
  entity_type        text,
  entity_id          integer,
  channel            text      NOT NULL DEFAULT 'email',
  status             text      NOT NULL,
  error_message      text,
  provider_id        text,
  created_at         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_recipient ON notification_logs (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_entity    ON notification_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_created   ON notification_logs (created_at);

-- delegations
CREATE TABLE IF NOT EXISTS delegations (
  id                  serial    PRIMARY KEY,
  organization_id     integer   NOT NULL REFERENCES organizations(id),
  from_user_id        integer   NOT NULL REFERENCES users(id),
  to_user_id          integer   NOT NULL REFERENCES users(id),
  project_id          integer   REFERENCES projects(id),
  reason              text      NOT NULL,
  expires_at          timestamp NOT NULL,
  is_active           boolean   NOT NULL DEFAULT true,
  granted_by_user_id  integer   NOT NULL REFERENCES users(id),
  granted_at          timestamp NOT NULL DEFAULT now(),
  revoked_at          timestamp,
  revoked_by_user_id  integer   REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_delegations_org_id       ON delegations (organization_id);
CREATE INDEX IF NOT EXISTS idx_delegations_from_user_id ON delegations (from_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_to_user_id   ON delegations (to_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_project_id   ON delegations (project_id);
CREATE INDEX IF NOT EXISTS idx_delegations_expires_at   ON delegations (expires_at);

-- project_role_overrides
CREATE TABLE IF NOT EXISTS project_role_overrides (
  id                  serial     PRIMARY KEY,
  organization_id     integer    NOT NULL REFERENCES organizations(id),
  project_id          integer    NOT NULL REFERENCES projects(id),
  user_id             integer    NOT NULL REFERENCES users(id),
  role_override       user_role  NOT NULL,
  reason              text       NOT NULL,
  expires_at          timestamp  NOT NULL,
  is_active           boolean    NOT NULL DEFAULT true,
  granted_by_user_id  integer    NOT NULL REFERENCES users(id),
  granted_at          timestamp  NOT NULL DEFAULT now(),
  revoked_at          timestamp,
  revoked_by_user_id  integer    REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_org_id     ON project_role_overrides (organization_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_project_id ON project_role_overrides (project_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_user_id    ON project_role_overrides (user_id);
CREATE INDEX IF NOT EXISTS idx_proj_role_overrides_expires_at ON project_role_overrides (expires_at);

-- rule_execution_logs
CREATE TABLE IF NOT EXISTS rule_execution_logs (
  id               serial    PRIMARY KEY,
  rule_id          integer   NOT NULL REFERENCES rules(id),
  organization_id  integer   NOT NULL REFERENCES organizations(id),
  entity_type      text      NOT NULL,
  entity_id        integer,
  actions_taken    jsonb     NOT NULL DEFAULT '[]',
  success          boolean   NOT NULL DEFAULT true,
  error_message    text,
  duration_ms      integer,
  executed_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_rule_id         ON rule_execution_logs (rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_organization_id ON rule_execution_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_logs_executed_at     ON rule_execution_logs (executed_at);

-- system_settings
CREATE TABLE IF NOT EXISTS system_settings (
  key        text      PRIMARY KEY,
  value      text      NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      serial               PRIMARY KEY,
  organization_id         integer              NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                 text                 NOT NULL DEFAULT 'free',
  stripe_customer_id      text,
  stripe_subscription_id  text,
  stripe_price_id         text,
  status                  subscription_status  NOT NULL DEFAULT 'free',
  current_period_start    timestamp,
  current_period_end      timestamp,
  seats_count             integer              NOT NULL DEFAULT 1,
  payment_failed_at       timestamp,
  created_at              timestamp            NOT NULL DEFAULT now(),
  updated_at              timestamp            NOT NULL DEFAULT now()
);

-- user_preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id                  serial    PRIMARY KEY,
  user_id             integer   NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organization_id     integer   REFERENCES organizations(id),
  dashboard_widgets   jsonb,
  dashboard_layout    jsonb,
  saved_filters       jsonb,
  column_prefs        jsonb,
  notification_prefs  jsonb,
  updated_at          timestamp NOT NULL DEFAULT now()
);

-- tasks
CREATE TABLE IF NOT EXISTS tasks (
  id              serial             PRIMARY KEY,
  title           text               NOT NULL,
  description     text,
  status          task_status        NOT NULL DEFAULT 'pending',
  priority        task_priority      NOT NULL DEFAULT 'medium',
  assigned_to_id  integer            REFERENCES users(id),
  created_by_id   integer            NOT NULL REFERENCES users(id),
  project_id      integer            REFERENCES projects(id),
  organization_id integer            REFERENCES organizations(id),
  source_type     task_source_type   NOT NULL DEFAULT 'manual',
  source_id       integer,
  due_date        timestamp,
  completed_at    timestamp,
  created_at      timestamp          NOT NULL DEFAULT now(),
  updated_at      timestamp          NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_organization_id ON tasks (organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id      ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_id  ON tasks (assigned_to_id);

-- deliverables
CREATE TABLE IF NOT EXISTS deliverables (
  id                  serial              PRIMARY KEY,
  deliverable_id      text                NOT NULL,
  title               text                NOT NULL,
  type                text,
  planned_date        timestamp,
  actual_date         timestamp,
  status              deliverable_status  NOT NULL DEFAULT 'not_started',
  responsible         text,
  linked_document_id  integer,
  remarks             text,
  project_id          integer             NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id       integer             NOT NULL REFERENCES users(id),
  created_at          timestamp           NOT NULL DEFAULT now(),
  updated_at          timestamp           NOT NULL DEFAULT now()
);

-- metadata_fields
CREATE TABLE IF NOT EXISTS metadata_fields (
  id               serial                 PRIMARY KEY,
  organization_id  integer                REFERENCES organizations(id),
  name             text                   NOT NULL,
  label            text                   NOT NULL,
  field_type       metadata_field_type    NOT NULL,
  options          text[],
  required         boolean                NOT NULL DEFAULT false,
  applies_to       metadata_applies_to    NOT NULL DEFAULT 'document',
  created_at       timestamp              NOT NULL DEFAULT now()
);

-- wf_templates
CREATE TABLE IF NOT EXISTS wf_templates (
  id               serial    PRIMARY KEY,
  organization_id  integer   NOT NULL REFERENCES organizations(id),
  name             text      NOT NULL,
  document_type    text      NOT NULL,
  description      text,
  is_active        boolean   NOT NULL DEFAULT true,
  created_by_id    integer   NOT NULL REFERENCES users(id),
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

-- wf_template_stages
CREATE TABLE IF NOT EXISTS wf_template_stages (
  id                   serial    PRIMARY KEY,
  template_id          integer   NOT NULL REFERENCES wf_templates(id) ON DELETE CASCADE,
  stage_order          integer   NOT NULL,
  name                 text      NOT NULL,
  description          text,
  responsible_role     text,
  responsible_user_id  integer   REFERENCES users(id),
  is_terminal          boolean   NOT NULL DEFAULT false,
  sla_days             integer,
  reminder_days        integer,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

-- wf_instances
CREATE TABLE IF NOT EXISTS wf_instances (
  id                serial    PRIMARY KEY,
  organization_id   integer   NOT NULL REFERENCES organizations(id),
  project_id        integer   REFERENCES projects(id),
  document_id       integer   NOT NULL REFERENCES documents(id),
  template_id       integer   NOT NULL REFERENCES wf_templates(id),
  current_stage_id  integer   REFERENCES wf_template_stages(id),
  status            text      NOT NULL DEFAULT 'active',
  initiated_by_id   integer   NOT NULL REFERENCES users(id),
  stage_due_at      timestamp,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

-- wf_instance_transitions
CREATE TABLE IF NOT EXISTS wf_instance_transitions (
  id             serial    PRIMARY KEY,
  instance_id    integer   NOT NULL REFERENCES wf_instances(id) ON DELETE CASCADE,
  from_stage_id  integer   REFERENCES wf_template_stages(id),
  to_stage_id    integer   REFERENCES wf_template_stages(id),
  action         text      NOT NULL,
  actor_id       integer   NOT NULL REFERENCES users(id),
  comment        text,
  created_at     timestamp NOT NULL DEFAULT now()
);

-- migration_jobs
CREATE TABLE IF NOT EXISTS migration_jobs (
  id                   serial                PRIMARY KEY,
  organization_id      integer               NOT NULL REFERENCES organizations(id),
  project_id           integer               NOT NULL REFERENCES projects(id),
  created_by_id        integer               NOT NULL REFERENCES users(id),
  status               migration_job_status  NOT NULL DEFAULT 'pending',
  plan                 text                  NOT NULL DEFAULT 'basic',
  max_files            integer               NOT NULL DEFAULT 200,
  storage_mode         text,
  base_url             text,
  imported_count       integer,
  skipped_count        integer,
  failed_count         integer,
  generated_registers  jsonb                 DEFAULT '[]',
  created_at           timestamp             NOT NULL DEFAULT now(),
  updated_at           timestamp             NOT NULL DEFAULT now()
);

-- migration_items
CREATE TABLE IF NOT EXISTS migration_items (
  id                     serial                 PRIMARY KEY,
  job_id                 integer                NOT NULL REFERENCES migration_jobs(id),
  organization_id        integer                NOT NULL REFERENCES organizations(id),
  file_path              text                   NOT NULL,
  file_name              text                   NOT NULL,
  file_size              integer,
  file_type              text,
  file_url               text,
  extracted_title        text,
  extracted_code         text,
  extracted_discipline   text,
  extracted_doc_type     text,
  extracted_revision     text,
  extracted_date         text,
  extracted_issuer       text,
  extracted_is_reply     integer                DEFAULT 0,
  extracted_reply_to     text,
  confidence             integer                NOT NULL DEFAULT 0,
  confidence_label       text,
  title                  text,
  code                   text,
  discipline             text,
  doc_type               text,
  revision               text,
  doc_date               text,
  issuer                 text,
  status                 migration_item_status  NOT NULL DEFAULT 'pending',
  skip                   integer                NOT NULL DEFAULT 0,
  imported_document_id   integer,
  error_message          text,
  analyzed_at            timestamp,
  imported_at            timestamp,
  created_at             timestamp              NOT NULL DEFAULT now()
);

-- meetings
CREATE TABLE IF NOT EXISTS meetings (
  id                serial          PRIMARY KEY,
  title             text            NOT NULL,
  project_id        integer         REFERENCES projects(id),
  organization_id   integer         REFERENCES organizations(id),
  organized_by_id   integer         NOT NULL REFERENCES users(id),
  status            meeting_status  NOT NULL DEFAULT 'scheduled',
  location          text,
  meeting_link      text,
  meeting_date      timestamp       NOT NULL,
  duration          integer,
  agenda            text,
  minutes           text,
  reference_number  text,
  created_at        timestamp       NOT NULL DEFAULT now(),
  updated_at        timestamp       NOT NULL DEFAULT now()
);

-- meeting_attendees
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id               serial    PRIMARY KEY,
  meeting_id       integer   NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  organization_id  integer   REFERENCES organizations(id),
  user_id          integer   REFERENCES users(id),
  name             text,
  email            text,
  attended         boolean   NOT NULL DEFAULT false
);

-- meeting_action_items
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id                serial    PRIMARY KEY,
  meeting_id        integer   NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  organization_id   integer   REFERENCES organizations(id),
  title             text      NOT NULL,
  assigned_to_id    integer   REFERENCES users(id),
  assigned_to_name  text,
  due_date          timestamp,
  status            text      NOT NULL DEFAULT 'open',
  priority          text      NOT NULL DEFAULT 'medium',
  notes             text,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

-- meeting_attachments
CREATE TABLE IF NOT EXISTS meeting_attachments (
  id               serial    PRIMARY KEY,
  meeting_id       integer   NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  organization_id  integer   REFERENCES organizations(id),
  file_name        text      NOT NULL,
  file_url         text      NOT NULL,
  file_size        integer,
  uploaded_at      timestamp NOT NULL DEFAULT now()
);

-- chat_groups
CREATE TABLE IF NOT EXISTS chat_groups (
  id               serial           PRIMARY KEY,
  name             text             NOT NULL,
  description      text,
  type             chat_group_type  NOT NULL DEFAULT 'general',
  organization_id  integer          NOT NULL REFERENCES organizations(id),
  project_id       integer          REFERENCES projects(id),
  department       text,
  created_by_id    integer          NOT NULL REFERENCES users(id),
  is_archived      boolean          NOT NULL DEFAULT false,
  created_at       timestamp        NOT NULL DEFAULT now(),
  updated_at       timestamp        NOT NULL DEFAULT now()
);

-- chat_group_members
CREATE TABLE IF NOT EXISTS chat_group_members (
  id         serial            PRIMARY KEY,
  group_id   integer           NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id    integer           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       chat_member_role  NOT NULL DEFAULT 'member',
  joined_at  timestamp         NOT NULL DEFAULT now()
);

-- chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id            serial    PRIMARY KEY,
  group_id      integer   NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id       integer   NOT NULL REFERENCES users(id),
  content       text      NOT NULL,
  parent_id     integer,
  message_type  text      NOT NULL DEFAULT 'text',
  file_url      text,
  file_name     text,
  file_size     integer,
  is_deleted    boolean   NOT NULL DEFAULT false,
  edited_at     timestamp,
  created_at    timestamp NOT NULL DEFAULT now()
);

-- chat_message_reads
CREATE TABLE IF NOT EXISTS chat_message_reads (
  id          serial    PRIMARY KEY,
  message_id  integer   NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     integer   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     timestamp NOT NULL DEFAULT now()
);

-- conversations (legacy direct messaging)
CREATE TABLE IF NOT EXISTS conversations (
  id          serial    PRIMARY KEY,
  created_at  timestamp NOT NULL DEFAULT now()
);

-- messages (legacy direct messaging)
CREATE TABLE IF NOT EXISTS messages (
  id               serial    PRIMARY KEY,
  conversation_id  integer   REFERENCES conversations(id),
  sender_id        integer   REFERENCES users(id),
  content          text,
  created_at       timestamp NOT NULL DEFAULT now()
);

-- ai_settings
CREATE TABLE IF NOT EXISTS ai_settings (
  id               serial     PRIMARY KEY,
  organization_id  integer    REFERENCES organizations(id),
  module           ai_module  NOT NULL,
  enabled          boolean    NOT NULL DEFAULT true,
  updated_at       timestamp  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module)
);

-- ai_cache
CREATE TABLE IF NOT EXISTS ai_cache (
  id               serial    PRIMARY KEY,
  organization_id  integer   REFERENCES organizations(id),
  entity_type      text      NOT NULL,
  entity_id        integer   NOT NULL,
  analysis_type    text      NOT NULL,
  result           jsonb     NOT NULL,
  model            text      NOT NULL DEFAULT 'gpt-4o-mini',
  expires_at       timestamp NOT NULL,
  created_at       timestamp NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, entity_id, analysis_type)
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_organization_id ON ai_cache (organization_id);

-- ai_logs
CREATE TABLE IF NOT EXISTS ai_logs (
  id               serial     PRIMARY KEY,
  organization_id  integer    REFERENCES organizations(id),
  user_id          integer,
  module           ai_module  NOT NULL,
  action           text       NOT NULL,
  entity_type      text,
  entity_id        integer,
  provider         text,
  model            text,
  tokens_used      integer,
  latency_ms       integer,
  success          boolean    NOT NULL DEFAULT true,
  error_message    text,
  created_at       timestamp  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_organization_id ON ai_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id         ON ai_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_module          ON ai_logs (module);

-- ai_analysis
CREATE TABLE IF NOT EXISTS ai_analysis (
  id               serial    PRIMARY KEY,
  organization_id  integer   REFERENCES organizations(id),
  entity_type      text      NOT NULL,
  entity_id        integer   NOT NULL,
  entity_revision  text,
  analysis_type    text      NOT NULL,
  result           jsonb     NOT NULL,
  provider         text,
  model            text,
  tokens_used      integer,
  latency_ms       integer,
  triggered_by     integer   REFERENCES users(id),
  is_latest        boolean   NOT NULL DEFAULT true,
  created_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_entity          ON ai_analysis (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_org             ON ai_analysis (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_latest          ON ai_analysis (entity_type, entity_id, analysis_type, is_latest);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_org_type_latest ON ai_analysis (organization_id, entity_type, is_latest);

-- skill_definitions (if present in schema)
CREATE TABLE IF NOT EXISTS skill_definitions (
  id           serial    PRIMARY KEY,
  name         text      NOT NULL,
  description  text,
  version      text,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

-- skill_executions (if present in schema)
CREATE TABLE IF NOT EXISTS skill_executions (
  id            serial    PRIMARY KEY,
  skill_id      integer   REFERENCES skill_definitions(id),
  user_id       integer   REFERENCES users(id),
  input         jsonb,
  output        jsonb,
  status        text,
  error         text,
  created_at    timestamp NOT NULL DEFAULT now()
);

-- ─── SECTION 5: Transmittal email fields ──────────────────────────────────────
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS external_emails text;
ALTER TABLE transmittals ADD COLUMN IF NOT EXISTS cc_emails text;

-- ─── SECTION 6: Document numbering ────────────────────────────────────────────

-- document_number column (added when numbered-document feature landed).
-- Step 1: Add nullable so existing rows don't violate NOT NULL.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number text;

-- Step 2: Back-fill existing rows so they each get a unique placeholder.
UPDATE documents SET document_number = 'DOC-' || id::text WHERE document_number IS NULL;

-- Step 3: Enforce NOT NULL now that every row has a value.
ALTER TABLE documents ALTER COLUMN document_number SET NOT NULL;
ALTER TABLE documents ALTER COLUMN document_number SET DEFAULT '';

-- Step 4: Unique constraint (project_id, document_number) — safe because data is now unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_project_number_unique'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_project_number_unique UNIQUE (project_id, document_number);
  END IF;
END $$;

-- document_sequences: tracks per-project/org/discipline/doctype auto-increment sequences.
CREATE TABLE IF NOT EXISTS document_sequences (
  id              serial PRIMARY KEY,
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id),
  discipline      text    NOT NULL DEFAULT '',
  doc_type        text    NOT NULL DEFAULT '',
  last_seq        integer NOT NULL DEFAULT 0
);

-- document_files: additional file attachments on a document.
CREATE TABLE IF NOT EXISTS document_files (
  id              serial PRIMARY KEY,
  organization_id integer REFERENCES organizations(id),
  document_id     integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_name       text    NOT NULL,
  file_url        text    NOT NULL,
  file_size       integer,
  file_type       text,
  uploaded_by_id  integer REFERENCES users(id),
  created_at      timestamp NOT NULL DEFAULT now()
);

-- document_revisions: file_carried_forward column (added with revision UX improvements).
ALTER TABLE document_revisions ADD COLUMN IF NOT EXISTS file_carried_forward boolean NOT NULL DEFAULT false;

-- ─── SECTION 6: DONE ──────────────────────────────────────────────────────────

-- ─── SECTION 7: Submission Chains ─────────────────────────────────────────────

-- Enums (safe — only created if they don't already exist).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_chain_status') THEN
    CREATE TYPE submission_chain_status AS ENUM (
      'draft', 'active', 'returned', 'approved', 'approved_with_comments', 'closed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chain_step_action') THEN
    CREATE TYPE chain_step_action AS ENUM ('forward', 'return');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chain_step_status') THEN
    CREATE TYPE chain_step_status AS ENUM ('pending', 'under_review', 'reviewed', 'actioned');
  END IF;
END $$;

-- submission_chains: the top-level workflow entity.
CREATE TABLE IF NOT EXISTS submission_chains (
  id                      serial PRIMARY KEY,
  chain_number            text NOT NULL UNIQUE,
  title                   text NOT NULL,
  description             text,
  project_id              integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  originating_org_id      integer NOT NULL REFERENCES organizations(id),
  current_org_id          integer NOT NULL REFERENCES organizations(id),
  current_status          submission_chain_status NOT NULL DEFAULT 'draft',
  active_revision_cycle   integer NOT NULL DEFAULT 1,
  current_step_started_at timestamp NOT NULL DEFAULT now(),
  auto_closed_at          timestamp,
  created_by_id           integer NOT NULL REFERENCES users(id),
  created_at              timestamp NOT NULL DEFAULT now(),
  updated_at              timestamp NOT NULL DEFAULT now()
);

-- submission_chain_allowed_parties: organisations allowed in the chain and their step order.
CREATE TABLE IF NOT EXISTS submission_chain_allowed_parties (
  id                  serial PRIMARY KEY,
  chain_id            integer NOT NULL REFERENCES submission_chains(id) ON DELETE CASCADE,
  org_id              integer NOT NULL REFERENCES organizations(id),
  step_order          integer NOT NULL,
  label               text,
  default_assignee_id integer REFERENCES users(id)
);

-- submission_chain_steps: one row per forward/return movement event.
CREATE TABLE IF NOT EXISTS submission_chain_steps (
  id                  serial PRIMARY KEY,
  chain_id            integer NOT NULL REFERENCES submission_chains(id) ON DELETE CASCADE,
  step_number         integer NOT NULL,
  revision_cycle      integer NOT NULL,
  action              chain_step_action NOT NULL,
  from_org_id         integer NOT NULL REFERENCES organizations(id),
  to_org_id           integer NOT NULL REFERENCES organizations(id),
  actioned_by_id      integer REFERENCES users(id),
  step_status         chain_step_status NOT NULL DEFAULT 'pending',
  review_code         text,
  comments            text,
  reviewed_by_id      integer REFERENCES users(id),
  reviewed_at         timestamp,
  transmittal_id      integer REFERENCES transmittals(id),
  assigned_to_user_id integer REFERENCES users(id),
  reassigned_at       timestamp,
  reassigned_by_id    integer REFERENCES users(id),
  created_at          timestamp NOT NULL DEFAULT now()
);

-- submission_chain_documents: tracks which revision of each document is in scope per cycle.
CREATE TABLE IF NOT EXISTS submission_chain_documents (
  id             serial PRIMARY KEY,
  chain_id       integer NOT NULL REFERENCES submission_chains(id) ON DELETE CASCADE,
  document_id    integer NOT NULL REFERENCES documents(id),
  revision_id    integer NOT NULL REFERENCES document_revisions(id),
  revision_cycle integer NOT NULL,
  added_by_id    integer REFERENCES users(id),
  added_at       timestamp NOT NULL DEFAULT now()
);

-- ─── SECTION 7: DONE ──────────────────────────────────────────────────────────

-- ─── SECTION 8: Migration Wizard — Revision Matching + Completeness Flagging ──
-- New columns added to support conflict detection and post-import cleanup.

-- migration_jobs: track revised and incomplete document counts
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS incomplete_count integer;
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS revised_count    integer;

-- migration_items: conflict detection fields (populated after AI analysis)
ALTER TABLE migration_items ADD COLUMN IF NOT EXISTS conflict_document_id       integer;
ALTER TABLE migration_items ADD COLUMN IF NOT EXISTS conflict_document_title    text;
ALTER TABLE migration_items ADD COLUMN IF NOT EXISTS conflict_document_revision text;
ALTER TABLE migration_items ADD COLUMN IF NOT EXISTS import_mode                text DEFAULT 'new_document';

-- ─── SECTION 8: DONE ──────────────────────────────────────────────────────────

-- ─── SECTION 9: Missing tables (packages, correspondence sub-tables, registers) ─
-- These tables are defined in the Drizzle schema but were omitted from earlier
-- migration sections. Using CREATE TABLE IF NOT EXISTS so safe to run on any DB.

-- packages (project document packages / WBS groupings)
CREATE TABLE IF NOT EXISTS packages (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  code          text NOT NULL,
  description   text,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id integer NOT NULL REFERENCES users(id),
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- correspondence_recipients (To: recipients for a correspondence item)
CREATE TABLE IF NOT EXISTS correspondence_recipients (
  id                serial PRIMARY KEY,
  correspondence_id integer NOT NULL REFERENCES correspondence(id) ON DELETE CASCADE,
  user_id           integer NOT NULL REFERENCES users(id)
);

-- correspondence_attachments (file attachments on correspondence items)
CREATE TABLE IF NOT EXISTS correspondence_attachments (
  id                serial PRIMARY KEY,
  correspondence_id integer NOT NULL REFERENCES correspondence(id) ON DELETE CASCADE,
  file_name         text NOT NULL,
  file_url          text NOT NULL,
  file_size         integer,
  uploaded_at       timestamp NOT NULL DEFAULT now()
);

-- correspondence_documents (many-to-many: correspondence ↔ documents)
CREATE TABLE IF NOT EXISTS correspondence_documents (
  id                serial PRIMARY KEY,
  correspondence_id integer NOT NULL REFERENCES correspondence(id) ON DELETE CASCADE,
  document_id       integer NOT NULL REFERENCES documents(id)     ON DELETE CASCADE,
  created_at        timestamp NOT NULL DEFAULT now(),
  created_by_id     integer REFERENCES users(id),
  note              text
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'correspondence_documents_uniq'
  ) THEN
    CREATE UNIQUE INDEX correspondence_documents_uniq
      ON correspondence_documents (correspondence_id, document_id);
  END IF;
END $$;

-- ─── Registers: ENUMs ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE inspection_type   AS ENUM ('itr','mir');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inspection_status AS ENUM ('pending','scheduled','in_progress','passed','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ncr_type   AS ENUM ('ncr','sor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ncr_status AS ENUM ('open','in_progress','closed','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE noc_status AS ENUM ('pending','approved','rejected','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- inspection_requests (ITR / MIR)
CREATE TABLE IF NOT EXISTS inspection_requests (
  id                    serial PRIMARY KEY,
  request_number        text NOT NULL,
  type                  inspection_type   NOT NULL DEFAULT 'itr',
  description           text,
  location              text,
  date                  timestamp,
  status                inspection_status NOT NULL DEFAULT 'pending',
  contractor            text,
  linked_correspondence_id integer,
  linked_document_id    integer REFERENCES documents(id),
  remarks               text,
  direction             text,
  party_type            text,
  review_code           text,
  organization_id       integer REFERENCES organizations(id),
  project_id            integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id         integer NOT NULL REFERENCES users(id),
  approval_status       approval_status NOT NULL DEFAULT 'none',
  approved_by_id        integer REFERENCES users(id),
  approval_comment      text,
  approved_at           timestamp,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);

-- ncr_records (Non-Conformance Reports / Site Observation Reports)
CREATE TABLE IF NOT EXISTS ncr_records (
  id                       serial PRIMARY KEY,
  report_number            text NOT NULL,
  type                     ncr_type   NOT NULL DEFAULT 'ncr',
  description              text,
  location                 text,
  raised_by                text,
  status                   ncr_status NOT NULL DEFAULT 'open',
  corrective_action        text,
  close_date               timestamp,
  linked_document_id       integer REFERENCES documents(id),
  linked_correspondence_id integer,
  remarks                  text,
  direction                text,
  party_type               text,
  review_code              text,
  organization_id          integer REFERENCES organizations(id),
  project_id               integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id            integer NOT NULL REFERENCES users(id),
  approval_status          approval_status NOT NULL DEFAULT 'none',
  approved_by_id           integer REFERENCES users(id),
  approval_comment         text,
  approved_at              timestamp,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);

-- noc_records (No-Objection Certificates)
CREATE TABLE IF NOT EXISTS noc_records (
  id                       serial PRIMARY KEY,
  noc_number               text NOT NULL,
  authority                text,
  date                     timestamp,
  status                   noc_status NOT NULL DEFAULT 'pending',
  linked_document_id       integer REFERENCES documents(id),
  linked_correspondence_id integer,
  remarks                  text,
  direction                text,
  party_type               text,
  organization_id          integer REFERENCES organizations(id),
  project_id               integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id            integer NOT NULL REFERENCES users(id),
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);

-- ─── SECTION 9: DEPARTMENT SYSTEM (Phase A/B) ────────────────────────────────

-- departments
CREATE TABLE IF NOT EXISTS departments (
  id              SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  parent_id       INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_org_code_unique
  ON departments(organization_id, code);
CREATE INDEX IF NOT EXISTS idx_departments_org
  ON departments(organization_id);

-- user_departments
CREATE TABLE IF NOT EXISTS user_departments (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  joined_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_user_departments_user
  ON user_departments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_departments_dept
  ON user_departments(department_id);

-- document_departments
CREATE TABLE IF NOT EXISTS document_departments (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_dept_unique
  ON document_departments(document_id, department_id);
CREATE INDEX IF NOT EXISTS idx_doc_departments_doc
  ON document_departments(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_departments_dept
  ON document_departments(department_id);

-- project_departments
CREATE TABLE IF NOT EXISTS project_departments (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS proj_dept_unique
  ON project_departments(project_id, department_id);
CREATE INDEX IF NOT EXISTS idx_proj_departments_proj
  ON project_departments(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_departments_dept
  ON project_departments(department_id);

-- ─── SECTION 10: ACCESS CONTROL (Phase C) ─────────────────────────────────────

-- document_access_rules  (explicit per-department allow/deny overrides)
CREATE TABLE IF NOT EXISTS document_access_rules (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  rule_type     TEXT NOT NULL,          -- 'allow' | 'deny'
  granted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_access_rule_uniq
  ON document_access_rules(document_id, department_id, rule_type);
CREATE INDEX IF NOT EXISTS idx_doc_access_rules_doc
  ON document_access_rules(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_access_rules_dept
  ON document_access_rules(department_id);

-- document_confidential_access  (allowlist for confidential documents)
CREATE TABLE IF NOT EXISTS document_confidential_access (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  granted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMP,
  reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_doc_conf_doc
  ON document_confidential_access(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_conf_user
  ON document_confidential_access(user_id);
CREATE INDEX IF NOT EXISTS idx_doc_conf_dept
  ON document_confidential_access(department_id);

-- access_shadow_log  (audit log for shadow resolver — no FK on doc/project so records survive deletion)
CREATE TABLE IF NOT EXISTS access_shadow_log (
  id                 SERIAL PRIMARY KEY,
  document_id        INTEGER,
  user_id            INTEGER NOT NULL,
  user_role          TEXT NOT NULL,
  project_id         INTEGER,
  system_allowed     BOOLEAN NOT NULL,
  resolver_allowed   BOOLEAN NOT NULL,
  resolver_reasons   TEXT[]  NOT NULL DEFAULT '{}',
  rule_path          TEXT NOT NULL,
  diverges           BOOLEAN NOT NULL,
  user_dept_ids      INTEGER[] NOT NULL DEFAULT '{}',
  doc_dept_ids       INTEGER[] NOT NULL DEFAULT '{}',
  has_confidential   BOOLEAN NOT NULL DEFAULT false,
  has_deny_rule      BOOLEAN NOT NULL DEFAULT false,
  has_workflow_grant BOOLEAN NOT NULL DEFAULT false,
  evaluated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shadow_doc
  ON access_shadow_log(document_id);
CREATE INDEX IF NOT EXISTS idx_shadow_user
  ON access_shadow_log(user_id);
CREATE INDEX IF NOT EXISTS idx_shadow_diverges
  ON access_shadow_log(diverges);
CREATE INDEX IF NOT EXISTS idx_shadow_evaluated_at
  ON access_shadow_log(evaluated_at);

-- ─── EXTERNAL CONTACTS ────────────────────────────────────────────────────────
-- Lightweight contact book for external parties (clients, contractors, consultants).
-- No login; used for display in transmittals, correspondence, and future share links.
CREATE TABLE IF NOT EXISTS external_contacts (
  id              SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  company         TEXT,
  job_title       TEXT,
  phone           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ext_contacts_org
  ON external_contacts(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_contacts_org_email
  ON external_contacts(organization_id, email);

-- ─── DONE ─────────────────────────────────────────────────────────────────────

SELECT 'Migration complete — all tables and columns are up to date.' AS result;
