-- =============================================================================
-- ArcScale EDMS — VPS Schema Diagnostic Query
-- =============================================================================
-- Run this to see exactly which tables and columns are missing:
--   docker exec -i edms_postgres psql -U edms -d edms < diagnose.sql
-- =============================================================================

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' ArcScale EDMS — Schema Diagnostic'
\echo '════════════════════════════════════════════════════════════════'

-- ── 1. Tables that must exist ─────────────────────────────────────────────────
\echo ''
\echo '── [1] Missing Tables ─────────────────────────────────────'

SELECT t.table_name AS missing_table
FROM (VALUES
  ('organizations'), ('users'), ('projects'), ('project_members'),
  ('packages'), ('documents'), ('folders'), ('document_revisions'), ('document_files'),
  ('transmittals'), ('transmittal_items'), ('transmittal_history'),
  ('correspondence'), ('correspondence_recipients'),
  ('correspondence_cc'), ('correspondence_attachments'), ('correspondence_sequences'),
  ('notifications'), ('scheduled_notifications'), ('notification_event_types'),
  ('org_notification_settings'), ('notification_logs'),
  ('audit_logs'), ('delegations'), ('project_role_overrides'),
  ('rules'), ('rule_execution_logs'), ('org_config'), ('system_settings'),
  ('refresh_tokens'), ('password_reset_tokens'),
  ('subscriptions'), ('user_preferences'),
  ('tasks'), ('deliverables'), ('metadata_fields'),
  ('wf_templates'), ('wf_template_stages'), ('wf_instances'), ('wf_instance_transitions'),
  ('meetings'), ('meeting_attendees'), ('meeting_action_items'), ('meeting_attachments'),
  ('chat_groups'), ('chat_group_members'), ('chat_messages'), ('chat_message_reads'),
  ('migration_jobs'), ('migration_items'),
  ('ai_settings'), ('ai_cache'), ('ai_logs'), ('ai_analysis'),
  -- Phase A/B: department system
  ('departments'), ('user_departments'), ('document_departments'), ('project_departments'),
  -- Phase C: access control
  ('document_access_rules'), ('document_confidential_access'), ('access_shadow_log')
) AS t(table_name)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = t.table_name
)
ORDER BY 1;

-- ── 2. Critical columns ────────────────────────────────────────────────────────
\echo ''
\echo '── [2] Missing Columns (critical tables only) ──────────────'

SELECT col.table_name, col.column_name
FROM (VALUES
  -- organizations
  ('organizations', 'contact_email'),
  ('organizations', 'contact_phone'),
  ('organizations', 'address'),
  ('organizations', 'subscription_tier'),
  ('organizations', 'storage_used_mb'),
  ('organizations', 'corr_unread_reminder_hours'),
  ('organizations', 'corr_no_response_hours'),
  ('organizations', 'corr_sla_due_soon_hours'),
  ('organizations', 'updated_at'),
  -- users
  ('users', 'department'),
  -- refresh_tokens
  ('refresh_tokens', 'organization_id'),
  ('refresh_tokens', 'revoked_at'),
  -- password_reset_tokens
  ('password_reset_tokens', 'organization_id'),
  -- documents
  ('documents', 'direction'),
  ('documents', 'is_confidential'),
  ('documents', 'source'),
  ('documents', 'issued_by'),
  ('documents', 'ai_tags'),
  ('documents', 'organization_id'),
  -- transmittals
  ('transmittals', 'organization_id'),
  ('transmittals', 'direction'),
  ('transmittals', 'review_outcome'),
  ('transmittals', 'approval_status'),
  -- correspondence
  ('correspondence', 'scope'),
  ('correspondence', 'parent_id'),
  ('correspondence', 'reference_number'),
  ('correspondence', 'assigned_to_id'),
  ('correspondence', 'direction'),
  ('correspondence', 'requires_response'),
  ('correspondence', 'is_read'),
  ('correspondence', 'first_read_at'),
  -- notifications
  ('notifications', 'organization_id'),
  ('notifications', 'entity_type'),
  ('notifications', 'entity_id'),
  ('notifications', 'action_url'),
  -- org_config
  ('org_config', 'transmittal_prefix'),
  ('org_config', 'ai_provider'),
  -- rules
  ('rules', 'consecutive_failures'),
  ('rules', 'applies_to')
) AS col(table_name, column_name)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name  = col.table_name
    AND c.column_name = col.column_name
)
ORDER BY 1, 2;

-- ── 3. Enum types ─────────────────────────────────────────────────────────────
\echo ''
\echo '── [3] Missing Enum Types ──────────────────────────────────'

SELECT e.type_name AS missing_enum
FROM (VALUES
  ('approval_status'), ('rule_applies_to'), ('migration_job_status'),
  ('migration_item_status'), ('subscription_status'), ('task_status'),
  ('task_priority'), ('task_source_type'), ('metadata_field_type'),
  ('metadata_applies_to'), ('chat_group_type'), ('chat_member_role'),
  ('meeting_status'), ('deliverable_status'), ('ai_module')
) AS e(type_name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_type WHERE typname = e.type_name
)
ORDER BY 1;

-- ── 4. Summary ────────────────────────────────────────────────────────────────
\echo ''
\echo '── [4] Summary ─────────────────────────────────────────────'
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS total_tables,
  (SELECT count(*) FROM pg_type WHERE typtype='e') AS total_enums;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' If any rows appear above, run migrate_production.sql to fix.'
\echo '════════════════════════════════════════════════════════════════'
\echo ''
