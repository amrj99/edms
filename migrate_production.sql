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

-- ─── SECTION 5: DONE ──────────────────────────────────────────────────────────
SELECT 'Migration complete — all tables and columns are up to date.' AS result;
