import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, config } from "./env.js";
import type { ProjectView, ScopeClause, RateCardItem } from "../shared/types.js";

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, "scope-and-settle.db"));

db.exec(`
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
`);

// Additive migrations for databases created by the first scaffold.
for (const col of ["revision INTEGER NOT NULL DEFAULT 1", "scope_revision_id TEXT", "run_id TEXT NOT NULL DEFAULT 'run-1'"]) {
  try { db.exec(`ALTER TABLE change_orders ADD COLUMN ${col}`); } catch { /* already present */ }
}
for (const [table, column] of [["sessions", "run_id TEXT NOT NULL DEFAULT 'run-1'"], ["sessions", "grant_id TEXT"], ["change_orders", "scope_snapshot_json TEXT"], ["change_orders", "assessment_id TEXT"]]) {
  const name = column.split(" ")[0];
  if (!(db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(x => x.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
}

export function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function currentRunId(): string {
  const row = db.prepare("SELECT value FROM demo_state WHERE key = 'run_id'").get() as any;
  return row?.value ?? "run-1";
}

export function bumpRunId(): string {
  const next = `run-${randomUUID()}`;
  db.prepare(
    "INSERT INTO demo_state (key, value) VALUES ('run_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(next);
  return next;
}

const DEMO_CLAUSES: ScopeClause[] = [
  { id: "desktop-1", text: "The agreed deliverable is a three-step checkout for desktop screens only. Mobile layouts are excluded from this project fee." },
  { id: "desktop-2", text: "Additional deliverables require a separate scope and price approved by the designer and client." },
];

const DEMO_RATE_CARD: RateCardItem[] = [
  { id: "mobile_checkout", description: "Add mobile layouts for the existing checkout flow", unitAmountMinor: 25000 },
  { id: "additional_onboarding_screen", description: "Add one onboarding screen", unitAmountMinor: 10000 },
];

export function getProject(): ProjectView {
  const row = db.prepare("SELECT * FROM projects WHERE id = 'demo'").get() as any;
  if (row) {
    return {
      id: row.id,
      name: row.name,
      figmaFileKey: row.figma_file_key,
      currency: row.currency,
      scopeRevisionId: row.scope_revision_id,
      scopeClauses: JSON.parse(row.scope_clauses_json),
      rateCard: JSON.parse(row.rate_card_json),
    };
  }
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO projects (id, name, figma_file_key, currency, scope_revision_id, scope_clauses_json, rate_card_json, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run("demo", "Scope & Settle — Demo", config.figmaFileKey, "USD", "scope-rev-1",
    JSON.stringify(DEMO_CLAUSES), JSON.stringify(DEMO_RATE_CARD), now);
  return getProject();
}

export function assertRunActive(runId: string): void {
  const run = db.prepare("SELECT closed_at FROM judge_runs WHERE run_id = ?").get(runId) as any;
  if (run?.closed_at) throw new Error("This demo was reset; reconnect to your new run");
}

export function getProjectForRun(runId: string): ProjectView {
  assertRunActive(runId);
  const run = db.prepare("SELECT project_json FROM judge_runs WHERE run_id = ?").get(runId) as any;
  return run ? JSON.parse(run.project_json) : getProject();
}

/** Q08: saving a new scope baseline creates a new revision; pending proposals go stale server-side. */
export function updateScopeBaseline(clauses: ScopeClause[]): ProjectView {
  if (!Array.isArray(clauses) || !clauses.length || clauses.length > 50 ||
      clauses.some(x => typeof x.id !== "string" || !x.id.trim() || typeof x.text !== "string" || !x.text.trim() || x.text.length > 4000) ||
      new Set(clauses.map(x => x.id)).size !== clauses.length) throw new Error("Invalid scope clauses");
  const current = getProject();
  const nextNum = (parseInt(current.scopeRevisionId.replace(/\D/g, ""), 10) || 1) + 1;
  db.prepare("UPDATE projects SET scope_clauses_json = ?, scope_revision_id = ? WHERE id = 'demo'")
    .run(JSON.stringify(clauses), `scope-rev-${nextNum}`);
  return getProject();
}

export { db };
