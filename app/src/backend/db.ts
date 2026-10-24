import { migrate } from "./migrations.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, config } from "./env.js";
import type { ProjectView, ScopeClause, RateCardItem } from "../shared/types.js";
import {ensureScopeHead} from './scopeLedger.js';
import {validateInvoiceItemDescription} from './paymentState.js';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, "scope-and-settle.db"));

migrate(db);

let transactionDepth = 0;
export function transaction<T>(work: () => T): T {
  const depth=transactionDepth++, savepoint=`nested_${depth}`;
  try {
    db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    try { const result=work(); db.exec(depth ? `RELEASE ${savepoint}` : "COMMIT"); return result; }
    catch(error) { db.exec(depth ? `ROLLBACK TO ${savepoint}` : "ROLLBACK"); if(depth)db.exec(`RELEASE ${savepoint}`); throw error; }
  } finally { transactionDepth--; }
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
function invalidatePendingTemplateProposals(){
 db.prepare(`UPDATE change_orders SET status='needs_re_review' WHERE project_id='demo' AND status='awaiting_client_approval'
 AND run_id NOT IN (SELECT run_id FROM judge_runs)
 AND NOT EXISTS(SELECT 1 FROM approvals a WHERE a.change_order_id=change_orders.id AND a.change_order_revision=change_orders.revision AND a.actor_role='client')`).run();
 // Keep historical consent intact while recording that the current delegation
 // requires fresh consent, even if a later edit restores the original amounts.
 for(const row of db.prepare('SELECT run_id,policy_json FROM agent_policies WHERE run_id NOT IN (SELECT run_id FROM judge_runs)').all() as {run_id:string;policy_json:string}[]){
  const policy=JSON.parse(row.policy_json);db.prepare('UPDATE agent_policies SET policy_json=?,updated_at=? WHERE run_id=?').run(JSON.stringify({...policy,termsInvalidatedAt:new Date().toISOString()}),new Date().toISOString(),row.run_id);
 }
}
export function updateScopeBaseline(clauses: ScopeClause[],creator:string|null=null): ProjectView {
  return transaction(()=>{
  if (!Array.isArray(clauses) || !clauses.length || clauses.length > 50 ||
      clauses.some(x => typeof x.id !== "string" || !x.id.trim() || x.id.length>100 || typeof x.text !== "string" || !x.text.trim() || x.text.length > 4000) ||
      new Set(clauses.map(x => x.id)).size !== clauses.length) throw new Error("Invalid scope clauses");
  clauses=clauses.map(({id,text})=>({id,text}));
  const current = getProject();
  ensureScopeHead(currentRunId());
  if(JSON.stringify(current.scopeClauses)===JSON.stringify(clauses))return current;
  const nextNum = (parseInt(current.scopeRevisionId.replace(/\D/g, ""), 10) || 1) + 1;
  db.prepare("UPDATE projects SET scope_clauses_json = ?, scope_revision_id = ? WHERE id = 'demo'")
    .run(JSON.stringify(clauses), `scope-rev-${nextNum}`);
  invalidatePendingTemplateProposals();
  ensureScopeHead(currentRunId(),creator);
  return getProject();
  });
}

export function updateRateCard(entries:RateCardItem[],creator:string|null=null):ProjectView {
 return transaction(()=>{
  if(!Array.isArray(entries)||!entries.length||entries.length>20||new Set(entries.map(r=>r.id)).size!==entries.length)throw new Error('Invalid rate card');
  for(const r of entries){if(typeof r.id!=='string'||!r.id.trim()||r.id.length>100||!Number.isSafeInteger(r.unitAmountMinor)||r.unitAmountMinor<1||r.unitAmountMinor>10_000_000)throw new Error('Invalid rate-card entry');validateInvoiceItemDescription(r.description);}
  ensureScopeHead(currentRunId());const normalized=entries.map(({id,description,unitAmountMinor})=>({id,description,unitAmountMinor}));
  if(JSON.stringify(getProject().rateCard)===JSON.stringify(normalized))return getProject();
  db.prepare("UPDATE projects SET rate_card_json=? WHERE id='demo'").run(JSON.stringify(normalized));invalidatePendingTemplateProposals();ensureScopeHead(currentRunId(),creator);return getProject();
 });
}

export { db };
