-- ToolGuiZalo Pro V2 - SQLite WAL Schema (Roadmap Mục 4)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role_id TEXT NOT NULL REFERENCES roles(id),
  password_hash TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT DEFAULT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  revoked_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'win32',
  role TEXT NOT NULL DEFAULT 'AGENT', -- MASTER | AGENT | SYNC_CLIENT
  status TEXT NOT NULL DEFAULT 'OFFLINE', -- ONLINE | OFFLINE | REVOKED
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_cursor INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT DEFAULT NULL,
  app_version TEXT NOT NULL DEFAULT '2.0.0',
  revoked_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'AGENT',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'zalo_web', -- zalo_oa | zalo_web | mock_sandbox
  profile_dir TEXT NOT NULL,
  zalo_profile_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'CLOSED', -- CLOSED | OPENING | WAITING_LOGIN | READY | RATE_LIMITED | REVOKED
  sent_count INTEGER NOT NULL DEFAULT 0,
  is_active_primary INTEGER NOT NULL DEFAULT 0,
  rate_limited_until TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  raw_phone TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  zalo_name TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  custom_message TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  extra_fields_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | THANH_CONG | CHAN_NGUOI_LA | KHONG_DANG_KY | SAI_SO | LOI | REVIEW | OPTED_OUT
  reason TEXT NOT NULL DEFAULT '',
  sent_by_account TEXT NOT NULL DEFAULT '',
  sent_by_account_id TEXT DEFAULT NULL,
  sent_message TEXT NOT NULL DEFAULT '',
  sent_at TEXT DEFAULT NULL,
  results_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone_unique ON contacts(phone) WHERE phone != '' AND phone != 'Từ Zalo Web';
CREATE INDEX IF NOT EXISTS idx_contacts_status_updated ON contacts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);

CREATE TABLE IF NOT EXISTS contact_consents (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'UNKNOWN', -- OPTED_IN | OPTED_OUT | UNKNOWN
  source TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'zalo_notification',
  consented_at TEXT DEFAULT NULL,
  revoked_at TEXT DEFAULT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_consents_status ON contact_consents(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS contact_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#2563eb',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_tag_links (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'zalo_oa',
  approval_status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | APPROVED | ARCHIVED
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT DEFAULT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  campaign_id TEXT DEFAULT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | APPROVED | SCHEDULED | RUNNING | PAUSED | COMPLETED | CANCELLED
  channel TEXT NOT NULL DEFAULT 'web_assisted', -- zalo_oa | web_assisted | mock_sandbox
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  template_body TEXT NOT NULL DEFAULT '',
  settings_snapshot_json TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT DEFAULT NULL,
  started_at TEXT DEFAULT NULL,
  completed_at TEXT DEFAULT NULL,
  stop_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  rendered_message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | ASSIGNED | PROCESSING | COMPLETED | FAILED | REVIEW | CANCELLED | SKIPPED_OPT_OUT
  reason TEXT NOT NULL DEFAULT '',
  account_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(campaign_id, status);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_contact_id TEXT REFERENCES campaign_contacts(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | ASSIGNED | PROCESSING | COMPLETED | FAILED | REVIEW | CANCELLED
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT DEFAULT NULL,
  lease_expires_at TEXT DEFAULT NULL,
  heartbeat_at TEXT DEFAULT NULL,
  result_code TEXT DEFAULT NULL,
  result_reason TEXT NOT NULL DEFAULT '',
  zalo_name TEXT NOT NULL DEFAULT '',
  sent_message TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tasks_campaign_status ON tasks(campaign_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_lease ON tasks(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  account_id TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL,
  status TEXT NOT NULL, -- STARTED | COMPLETED | FAILED | REVIEW | RATE_LIMITED
  idempotency_key TEXT NOT NULL,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_attempts_task ON task_attempts(task_id, attempt_no);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  external_thread_id TEXT DEFAULT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  match_status TEXT NOT NULL DEFAULT 'VERIFIED', -- VERIFIED | NEEDS_VERIFICATION | UNLINKED
  last_message_text TEXT NOT NULL DEFAULT '',
  last_message_direction TEXT NOT NULL DEFAULT 'INBOUND', -- INBOUND | OUTBOUND
  last_message_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  internal_note TEXT NOT NULL DEFAULT '',
  sidebar_rank INTEGER NOT NULL DEFAULT 9999,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_stable_key
  ON conversations(account_id, external_thread_id)
  WHERE external_thread_id IS NOT NULL AND external_thread_id != '';
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- INBOUND | OUTBOUND
  channel TEXT NOT NULL DEFAULT 'zalo_web',
  sender_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  external_msg_id TEXT DEFAULT NULL,
  dedupe_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED', -- RECEIVED | SENT | FAILED
  sent_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedupe ON messages(conversation_id, dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  is_seen INTEGER NOT NULL DEFAULT 0,
  seen_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_unseen ON notifications(is_seen, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid TEXT NOT NULL UNIQUE,
  actor_user_id TEXT DEFAULT NULL,
  actor_username TEXT NOT NULL DEFAULT 'system',
  actor_role TEXT NOT NULL DEFAULT 'system',
  device_id TEXT DEFAULT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  correlation_id TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_events(event_type, id DESC);

CREATE TABLE IF NOT EXISTS outbox (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- UPSERT | DELETE
  entity_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  acked_by_server INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(acked_by_server, cursor ASC);

CREATE TABLE IF NOT EXISTS tombstones (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL DEFAULT 1,
  deleted_by TEXT NOT NULL DEFAULT 'system',
  deleted_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_version INTEGER NOT NULL,
  remote_version INTEGER NOT NULL,
  local_payload_json TEXT NOT NULL,
  remote_payload_json TEXT NOT NULL,
  source_device_id TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED_LOCAL | RESOLVED_REMOTE | DISMISSED
  resolved_by TEXT DEFAULT NULL,
  resolved_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS phone_cache (
  phone TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  cached_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  encrypted INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'manual', -- manual | daily | weekly | pre_migration | pre_restore
  records_summary_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT DEFAULT NULL,
  created_by TEXT DEFAULT 'system',
  created_at TEXT NOT NULL
);
