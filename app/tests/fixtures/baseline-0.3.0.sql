-- Synthetic schema-only 0.3.0 pre-ledger fixture. Contains no user data or credentials.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  figma_file_key TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  scope_revision_id TEXT NOT NULL,
  scope_clauses_json TEXT NOT NULL,
  rate_card_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_orders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  comment_id TEXT,
  deliverables_json TEXT NOT NULL,
  line_items_json TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  paypal_invoice_id TEXT,
  invoice_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_operations (
  operation_key TEXT PRIMARY KEY,
  change_order_id TEXT NOT NULL,
  state TEXT NOT NULL,
  paypal_invoice_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_order_id TEXT NOT NULL,
  paypal_invoice_id TEXT NOT NULL,
  raw_status TEXT NOT NULL,
  display_status TEXT NOT NULL,
  amount_due_minor INTEGER,
  checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  change_order_id TEXT,
  change_order_revision INTEGER,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_order_id TEXT NOT NULL,
  change_order_revision INTEGER NOT NULL,
  scope_revision_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_tombstones (
  paypal_invoice_id TEXT PRIMARY KEY,
  change_order_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, role TEXT NOT NULL,
  change_order_id TEXT, change_order_revision INTEGER, expires_at TEXT NOT NULL,
  redeemed_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proposal_revisions (
  change_order_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(change_order_id, revision)
);
CREATE TABLE IF NOT EXISTS judge_access (
  id TEXT PRIMARY KEY, credential_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0, project_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS judge_runs (
  run_id TEXT PRIMARY KEY, judge_access_id TEXT NOT NULL, project_json TEXT NOT NULL,
  closed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS renewal_grants (
  id TEXT PRIMARY KEY, credential_hash TEXT NOT NULL UNIQUE, judge_access_id TEXT NOT NULL,
  run_id TEXT NOT NULL, role TEXT NOT NULL, change_order_id TEXT, change_order_revision INTEGER,
  expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_policies (
  run_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_policy_history (
  run_id TEXT NOT NULL, version INTEGER NOT NULL, policy_json TEXT NOT NULL,
  PRIMARY KEY(run_id,version)
);
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  text TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  policy_version INTEGER, assessment_id TEXT, order_id TEXT, quote_revision INTEGER,
  quoted_minor INTEGER NOT NULL DEFAULT 0, clarification_count INTEGER NOT NULL DEFAULT 0,
  exception TEXT, delivery_exception TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(run_id, source, source_id)
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, request_id TEXT NOT NULL, actor TEXT NOT NULL,
  body TEXT NOT NULL, source_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(run_id, source_id)
);
CREATE TABLE IF NOT EXISTS agent_portals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_outbox (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', marker TEXT NOT NULL,
  provider_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(request_id, marker)
);
CREATE TABLE IF NOT EXISTS agent_runtime (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, scope_revision_id TEXT NOT NULL,
  input_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, reserved_micro_usd INTEGER NOT NULL, actual_micro_usd INTEGER,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL, settled_at TEXT
);
CREATE TABLE IF NOT EXISTS webhook_receipts (
  id TEXT PRIMARY KEY, invoice_id TEXT, state TEXT NOT NULL, processed_at TEXT
);
ALTER TABLE change_orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE change_orders ADD COLUMN scope_revision_id TEXT;
ALTER TABLE change_orders ADD COLUMN run_id TEXT NOT NULL DEFAULT 'run-1';
ALTER TABLE sessions ADD COLUMN run_id TEXT NOT NULL DEFAULT 'run-1';
ALTER TABLE sessions ADD COLUMN grant_id TEXT;
ALTER TABLE change_orders ADD COLUMN scope_snapshot_json TEXT;
ALTER TABLE change_orders ADD COLUMN assessment_id TEXT;
