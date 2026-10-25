import { DatabaseSync } from "node:sqlite";
import {migrateScopeLedger} from './scopePersistence.js';
import {adoptLegacyInvoices} from './milestoneMigration.js';

export interface Migration { id: number; name: string; up(db: DatabaseSync): void }

const baselineSql = `
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
`;
const additions: readonly [string, string][] = [
  ["change_orders", "revision INTEGER NOT NULL DEFAULT 1"],
  ["change_orders", "scope_revision_id TEXT"],
  ["change_orders", "run_id TEXT NOT NULL DEFAULT 'run-1'"],
  ["sessions", "run_id TEXT NOT NULL DEFAULT 'run-1'"],
  ["sessions", "grant_id TEXT"],
  ["change_orders", "scope_snapshot_json TEXT"],
  ["change_orders", "assessment_id TEXT"],
  ["agent_requests", "delivery_exception TEXT"],


];
function createBaseline(db: DatabaseSync): void {
  db.exec(baselineSql);
  for (const [table, definition] of additions) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === definition.split(" ")[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

// Adoption validates every existing column and uniqueness contract; no data rewrite.
function adoptBaseline(db: DatabaseSync): void {
  createBaseline(db);
  const expected = new DatabaseSync(":memory:");
  try {
    createBaseline(expected);
    for (const { name } of expected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      const actual = db.prepare(`PRAGMA table_info(${name})`).all();
      for (const column of expected.prepare(`PRAGMA table_info(${name})`).all()) {
        const found = actual.find(c => c.name === column.name);
        if (!found || ["type", "notnull", "dflt_value", "pk"].some(k => found[k] !== column[k])) {
          throw new Error(`Incompatible existing column ${name}.${column.name}`);
        }
      }
      const uniqueKeys = (source: DatabaseSync) => source.prepare(`PRAGMA index_list(${name})`).all()
        .filter(i => i.unique).map(i => JSON.stringify(source.prepare(`PRAGMA index_info("${i.name}")`).all().map(c => c.name)));
      const actualKeys = uniqueKeys(db);
      if (uniqueKeys(expected).some(key => !actualKeys.includes(key))) throw new Error(`Incompatible unique constraints on ${name}`);
    }
  } finally { expected.close(); }
}

export const migrations: readonly Migration[] = [
  { id: 1, name: "adopt-complete-0.3.0-schema", up: adoptBaseline },
  { id: 2, name: "version-invoice-representation-and-financial-observations", up(db) {
    db.exec(`ALTER TABLE invoice_operations ADD COLUMN representation TEXT;
      ALTER TABLE invoice_operations ADD COLUMN approved_terms_json TEXT;
      ALTER TABLE payment_observations ADD COLUMN financial_json TEXT;
      UPDATE invoice_operations SET representation = 'aggregate-v0';`);
  } },
  { id: 3, name: "durable-paypal-reconciliation", up(db) {
    db.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, job_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      project_id TEXT NOT NULL, run_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      error_category TEXT, http_status INTEGER, recovery_generation INTEGER NOT NULL DEFAULT 0,
      recovery_at TEXT, association_fingerprint TEXT
    );
    CREATE INDEX jobs_due ON jobs(state,due_at);
    CREATE INDEX jobs_lease ON jobs(state,lease_until);
    CREATE TABLE job_runtime (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ALTER TABLE webhook_receipts ADD COLUMN event_type TEXT;
    ALTER TABLE webhook_receipts ADD COLUMN route_key TEXT;
    ALTER TABLE webhook_receipts ADD COLUMN job_id TEXT;
    ALTER TABLE webhook_receipts ADD COLUMN received_at TEXT;
    ALTER TABLE webhook_receipts ADD COLUMN verified_at TEXT;`);
  } },
  {id:4,name:'immutable-scope-ledger-and-exact-scope-access',up:migrateScopeLedger},
  {id:5,name:'request-items-reservations-and-partial-proposals',up(db){db.exec(`
    CREATE TABLE request_sources(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,source TEXT NOT NULL,file_key TEXT NOT NULL,root_id TEXT NOT NULL,version INTEGER NOT NULL,content_hash TEXT NOT NULL,UNIQUE(project_id,run_id,source,file_key,root_id));
    CREATE TABLE request_source_versions(source_id TEXT NOT NULL,version INTEGER NOT NULL,messages_json TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(source_id,version));
    CREATE TABLE request_items(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,exact_key TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,run_id,exact_key));
    CREATE TABLE request_item_results(item_id TEXT NOT NULL,assessment_id TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,result_json TEXT NOT NULL,context_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(item_id,assessment_id));
    CREATE TABLE proposal_item_operations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,actor_id TEXT NOT NULL,terms_hash TEXT NOT NULL,order_id TEXT NOT NULL,assessment_id TEXT NOT NULL,context_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,run_id,actor_id,id));
    CREATE TABLE proposal_item_reservations(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,operation_id TEXT NOT NULL,order_id TEXT NOT NULL,assessment_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','committed','released')),reason TEXT,created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX one_active_item_binding ON proposal_item_reservations(item_id) WHERE state IN ('reserved','committed');
    CREATE TABLE designer_item_prices(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,assessment_id TEXT NOT NULL,context_fingerprint TEXT NOT NULL,terms_json TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER immutable_designer_prices_update BEFORE UPDATE ON designer_item_prices BEGIN SELECT RAISE(ABORT,'Immutable designer item price'); END;
    CREATE TRIGGER immutable_designer_prices_delete BEFORE DELETE ON designer_item_prices BEGIN SELECT RAISE(ABORT,'Immutable designer item price'); END;
    CREATE TABLE duplicate_decisions(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,assessment_id TEXT NOT NULL,context_fingerprint TEXT NOT NULL,commitment_id TEXT NOT NULL,commitment_revision INTEGER NOT NULL,decision TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE request_order_links(request_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,published_minor INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(request_id,order_id,revision),UNIQUE(order_id,revision));
    INSERT INTO request_order_links SELECT id,run_id,order_id,quote_revision,quoted_minor,updated_at FROM agent_requests WHERE order_id IS NOT NULL AND quote_revision IS NOT NULL;
    CREATE TRIGGER immutable_request_versions_update BEFORE UPDATE ON request_source_versions BEGIN SELECT RAISE(ABORT,'Immutable request source version'); END;
    CREATE TRIGGER immutable_request_versions_delete BEFORE DELETE ON request_source_versions BEGIN SELECT RAISE(ABORT,'Immutable request source version'); END;
    CREATE TRIGGER immutable_item_results_delete BEFORE DELETE ON request_item_results BEGIN SELECT RAISE(ABORT,'Immutable assessment item result'); END;
    CREATE TRIGGER immutable_item_results_update BEFORE UPDATE ON request_item_results BEGIN SELECT RAISE(ABORT,'Immutable assessment item result'); END;
    CREATE TRIGGER immutable_duplicate_decisions_update BEFORE UPDATE ON duplicate_decisions BEGIN SELECT RAISE(ABORT,'Immutable duplicate decision'); END;
    CREATE TRIGGER immutable_duplicate_decisions_delete BEFORE DELETE ON duplicate_decisions BEGIN SELECT RAISE(ABORT,'Immutable duplicate decision'); END;
  `);}},
  {id:6,name:'immutable-design-evidence-and-durable-assessment-attempts',up(db){db.exec(`
    CREATE TABLE design_evidence_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE design_evidence_bytes(snapshot_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,png BLOB NOT NULL);
    CREATE TABLE assessment_evidence(assessment_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,snapshot_id TEXT NOT NULL);
    CREATE TABLE assessment_attempts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('prepared','dispatched','succeeded','rejected','uncertain')),call_id TEXT,assessment_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,run_id,fingerprint));
    CREATE TRIGGER immutable_design_evidence_update BEFORE UPDATE ON design_evidence_snapshots BEGIN SELECT RAISE(ABORT,'Immutable design evidence'); END;
    CREATE TRIGGER immutable_design_evidence_delete BEFORE DELETE ON design_evidence_snapshots BEGIN SELECT RAISE(ABORT,'Immutable design evidence'); END;
    CREATE TRIGGER immutable_evidence_bytes_update BEFORE UPDATE ON design_evidence_bytes BEGIN SELECT RAISE(ABORT,'Immutable design pixels'); END;
    CREATE TRIGGER immutable_assessment_evidence_update BEFORE UPDATE ON assessment_evidence BEGIN SELECT RAISE(ABORT,'Immutable assessment evidence reference'); END;
    CREATE TRIGGER immutable_assessment_evidence_delete BEFORE DELETE ON assessment_evidence BEGIN SELECT RAISE(ABORT,'Immutable assessment evidence reference'); END;
  `);}},
 {id:7,name:'figma-inbox-and-channel-consent',up(db){db.exec(`
 CREATE TABLE inbox_settings(run_id TEXT PRIMARY KEY,version INTEGER NOT NULL,settings_json TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE inbox_setting_history(run_id TEXT NOT NULL,version INTEGER NOT NULL,settings_json TEXT NOT NULL,PRIMARY KEY(run_id,version));
 CREATE TABLE request_inbox(request_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,metadata_json TEXT NOT NULL,availability TEXT NOT NULL,execution_owner TEXT NOT NULL,settings_version INTEGER,updated_at TEXT NOT NULL);
 CREATE TABLE figma_refresh_state(association_id TEXT PRIMARY KEY,generation INTEGER NOT NULL,completed_generation INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
 CREATE TABLE figma_event_receipts(id TEXT PRIMARY KEY,association_id TEXT NOT NULL,webhook_id TEXT NOT NULL,context_type TEXT NOT NULL,context_id TEXT NOT NULL,file_key TEXT,event_type TEXT NOT NULL,event_at TEXT NOT NULL,comment_id TEXT,received_at TEXT NOT NULL,verified_at TEXT NOT NULL,state TEXT NOT NULL,job_id TEXT,generation INTEGER);
 CREATE INDEX figma_receipts_refresh ON figma_event_receipts(association_id,generation,state);
 CREATE INDEX inbox_run ON request_inbox(run_id);
 CREATE TRIGGER immutable_inbox_consent_update BEFORE UPDATE ON inbox_setting_history BEGIN SELECT RAISE(ABORT,'Immutable inbox consent'); END;
 CREATE TRIGGER immutable_inbox_consent_delete BEFORE DELETE ON inbox_setting_history BEGIN SELECT RAISE(ABORT,'Immutable inbox consent'); END;
 `);}},

 {id:8,name:'reviewed-actions-and-shared-outbound-attempts',up(db){db.exec(`
 CREATE TABLE reviewed_actions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,initiator_id TEXT NOT NULL,confirmer_id TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,preview_json TEXT NOT NULL,preview_hash TEXT NOT NULL,expires_at TEXT NOT NULL,state TEXT NOT NULL,operation_key TEXT NOT NULL UNIQUE,confirmed_by TEXT,confirmed_at TEXT,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TRIGGER immutable_reviewed_preview BEFORE UPDATE OF project_id,run_id,initiator_id,confirmer_id,kind,request_id,preview_json,preview_hash,operation_key ON reviewed_actions BEGIN SELECT RAISE(ABORT,'Immutable reviewed preview'); END;
 CREATE TABLE outbound_operations(outbox_id TEXT PRIMARY KEY,authority TEXT NOT NULL CHECK(authority IN ('policy','human_review')),action_id TEXT UNIQUE,run_id TEXT NOT NULL,invoice_key TEXT,kind TEXT NOT NULL,state TEXT NOT NULL,dispatch_started INTEGER NOT NULL DEFAULT 0,attempted_at TEXT,provider_id TEXT,retry_after_at INTEGER,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE UNIQUE INDEX active_invoice_action ON outbound_operations(invoice_key) WHERE invoice_key IS NOT NULL AND state IN ('claimed','dispatching','uncertain');
 CREATE INDEX reviewed_run ON reviewed_actions(run_id,created_at);
 `);}},
 // Additive: an absent row means no known unavailability. Only trusted acquisition paths write it.
 {id:9,name:'request-source-freshness-fence',up(db){db.exec(`
 CREATE TABLE request_source_freshness(source_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('unavailable','available')),reason TEXT NOT NULL CHECK(reason IN ('source_missing','source_bounds')),generation INTEGER NOT NULL CHECK(generation>0),observed_at TEXT NOT NULL,recovered_version INTEGER,recovered_at TEXT,updated_at TEXT NOT NULL);
 CREATE INDEX request_source_freshness_run ON request_source_freshness(run_id,state);
 `);}},
 // Additive. Connector records hold a digest only, never the secret or a parent bearer token. Scope is
 // immutable; revocation is one-way; connector budget reservations are retained history.
 {id:10,name:'figma-connector-credentials-and-budget',up(db){db.exec(`
 CREATE TABLE connector_credentials(id TEXT PRIMARY KEY,format_version INTEGER NOT NULL CHECK(format_version=1),digest TEXT NOT NULL UNIQUE CHECK(length(digest)=64),project_id TEXT NOT NULL,run_id TEXT NOT NULL,file_key TEXT NOT NULL,operations_json TEXT NOT NULL,parent_kind TEXT NOT NULL CHECK(parent_kind IN ('grant','session')),parent_ref TEXT NOT NULL,owner_actor_id TEXT NOT NULL,max_assessments INTEGER NOT NULL CHECK(max_assessments BETWEEN 0 AND 20),max_cost_micro_usd INTEGER NOT NULL CHECK(max_cost_micro_usd BETWEEN 0 AND 25000000),issued_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,revoked_reason TEXT);
 CREATE INDEX connector_credentials_run ON connector_credentials(project_id,run_id);
 CREATE TRIGGER immutable_connector_scope BEFORE UPDATE OF id,format_version,digest,project_id,run_id,file_key,operations_json,parent_kind,parent_ref,owner_actor_id,max_assessments,max_cost_micro_usd,issued_at,expires_at ON connector_credentials BEGIN SELECT RAISE(ABORT,'Immutable connector credential scope'); END;
 CREATE TRIGGER one_way_connector_revocation BEFORE UPDATE OF revoked_at,revoked_reason ON connector_credentials WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'A revoked connector credential cannot be restored'); END;
 CREATE TRIGGER retained_connector_credentials BEFORE DELETE ON connector_credentials BEGIN SELECT RAISE(ABORT,'Connector credential records are retained'); END;
 CREATE TABLE connector_budget_reservations(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,attempt_id TEXT NOT NULL UNIQUE,call_id TEXT,reserved_micro_usd INTEGER NOT NULL CHECK(reserved_micro_usd>0),actual_micro_usd INTEGER CHECK(actual_micro_usd IS NULL OR actual_micro_usd>=0),state TEXT NOT NULL CHECK(state IN ('held','settled')),created_at TEXT NOT NULL,settled_at TEXT,updated_at TEXT NOT NULL);
 CREATE INDEX connector_budget_connector ON connector_budget_reservations(connector_id,state);
 CREATE TRIGGER retained_connector_budget BEFORE DELETE ON connector_budget_reservations BEGIN SELECT RAISE(ABORT,'Connector budget reservations are retained'); END;
 `);}},
 {id:11,name:'scoped-status-card-display-policy',up(db){db.exec(`
 CREATE TABLE status_card_settings(project_id TEXT NOT NULL,run_id TEXT NOT NULL,show_amounts INTEGER NOT NULL DEFAULT 0 CHECK(show_amounts IN (0,1)),version INTEGER NOT NULL CHECK(version>0),actor_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,run_id));
 `);}},
 {id:12,name:'non-dispatched-assessment-audit',up(db){db.exec(`
 ALTER TABLE assessment_attempts RENAME TO assessment_attempts_v11;
 CREATE TABLE assessment_attempts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('prepared','dispatched','succeeded','rejected','uncertain','not_dispatched')),call_id TEXT,assessment_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 INSERT INTO assessment_attempts SELECT id,project_id,run_id,fingerprint,source_id,source_version,CASE WHEN outcome='rejected' AND call_id IS NULL AND EXISTS(SELECT 1 FROM connector_budget_reservations b WHERE b.attempt_id=assessment_attempts_v11.id) THEN 'not_dispatched' ELSE outcome END,call_id,assessment_id,created_at,updated_at FROM assessment_attempts_v11;
 DROP TABLE assessment_attempts_v11;
 CREATE UNIQUE INDEX live_assessment_fingerprint ON assessment_attempts(project_id,run_id,fingerprint) WHERE outcome<>'not_dispatched';
 UPDATE connector_budget_reservations SET actual_micro_usd=0,state='settled',settled_at=COALESCE(settled_at,updated_at) WHERE state='held' AND call_id IS NULL AND attempt_id IN (SELECT id FROM assessment_attempts WHERE outcome='not_dispatched');
 `);}},
 {id:13,name:'approved-milestone-invoice-records',up(db){db.exec(`
 CREATE TABLE milestone_schedules(order_id TEXT NOT NULL,revision INTEGER NOT NULL,schedule_json TEXT NOT NULL,schedule_hash TEXT NOT NULL,provenance TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(order_id,revision));
 CREATE TABLE milestones(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,revision INTEGER NOT NULL,local_id TEXT NOT NULL,title TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),due_trigger TEXT NOT NULL CHECK(due_trigger IN ('proposal_approval','delivery_acceptance')),criteria_json TEXT NOT NULL,legacy INTEGER NOT NULL CHECK(legacy IN (0,1)),created_at TEXT NOT NULL,UNIQUE(order_id,revision,local_id));
 CREATE TABLE invoice_records(id TEXT PRIMARY KEY,milestone_id TEXT NOT NULL UNIQUE,order_id TEXT NOT NULL,project_id TEXT NOT NULL,run_id TEXT NOT NULL,revision INTEGER NOT NULL,route TEXT NOT NULL,operation_key TEXT NOT NULL UNIQUE,terms_json TEXT,provider_id TEXT,payer_url TEXT,financial_json TEXT,observed_at TEXT,state TEXT NOT NULL,adoption_issue TEXT,created_at TEXT NOT NULL,UNIQUE(route,provider_id));
 CREATE TABLE milestone_due_events(milestone_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,review_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(milestone_id,revision));
 CREATE TABLE installment_actions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,owner_id TEXT NOT NULL,preview_json TEXT NOT NULL,preview_hash TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL);
 CREATE TRIGGER immutable_installment_preview BEFORE UPDATE OF project_id,run_id,owner_id,preview_json,preview_hash ON installment_actions BEGIN SELECT RAISE(ABORT,'Immutable installment preview'); END;
 ALTER TABLE payment_observations ADD COLUMN invoice_record_id TEXT;
 CREATE INDEX observations_by_invoice_record ON payment_observations(invoice_record_id,id);
 `);adoptLegacyInvoices(db);}},
 {id:14,name:'immutable-approved-delivery-runs',up(db){db.exec(`
 CREATE TABLE delivery_runs(id TEXT PRIMARY KEY,milestone_id TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,operation_id TEXT NOT NULL UNIQUE,brief_json TEXT NOT NULL,brief_hash TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE delivery_snapshots(id TEXT PRIMARY KEY,delivery_run_id TEXT NOT NULL,project_id TEXT NOT NULL,run_id TEXT NOT NULL,hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,png BLOB NOT NULL,created_at TEXT NOT NULL,UNIQUE(delivery_run_id,hash));
 CREATE TRIGGER immutable_delivery_brief BEFORE UPDATE OF milestone_id,project_id,run_id,order_id,revision,operation_id,brief_json,brief_hash ON delivery_runs BEGIN SELECT RAISE(ABORT,'Immutable delivery brief'); END;
 CREATE TRIGGER immutable_delivery_snapshot BEFORE UPDATE ON delivery_snapshots BEGIN SELECT RAISE(ABORT,'Immutable delivery snapshot'); END;
 `);}},
 {id:15,name:'exact-delivery-review-and-acceptance',up(db){db.exec(`
 CREATE TABLE delivery_reviews(id TEXT PRIMARY KEY,milestone_id TEXT NOT NULL,project_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,order_revision INTEGER NOT NULL,review_revision INTEGER NOT NULL,snapshot_id TEXT NOT NULL,snapshot_hash TEXT NOT NULL,criteria_json TEXT NOT NULL,state TEXT NOT NULL,submitted_by TEXT NOT NULL,submitted_at TEXT NOT NULL,UNIQUE(milestone_id,review_revision));
 CREATE TABLE delivery_review_heads(milestone_id TEXT PRIMARY KEY,review_id TEXT NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE delivery_events(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,kind TEXT NOT NULL,actor_id TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE delivery_acceptances(id TEXT PRIMARY KEY,review_id TEXT NOT NULL UNIQUE,milestone_id TEXT NOT NULL,order_id TEXT NOT NULL,order_revision INTEGER NOT NULL,review_revision INTEGER NOT NULL,snapshot_id TEXT NOT NULL,snapshot_hash TEXT NOT NULL,accepted_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(milestone_id,order_revision));
 CREATE TRIGGER immutable_delivery_review BEFORE UPDATE OF milestone_id,project_id,run_id,order_id,order_revision,review_revision,snapshot_id,snapshot_hash,criteria_json,submitted_by,submitted_at ON delivery_reviews BEGIN SELECT RAISE(ABORT,'Immutable delivery review'); END;
 CREATE TRIGGER append_only_delivery_events_update BEFORE UPDATE ON delivery_events BEGIN SELECT RAISE(ABORT,'Append-only delivery events'); END;
 CREATE TRIGGER append_only_delivery_events_delete BEFORE DELETE ON delivery_events BEGIN SELECT RAISE(ABORT,'Append-only retained delivery events'); END;
 CREATE TRIGGER immutable_delivery_acceptance BEFORE UPDATE ON delivery_acceptances BEGIN SELECT RAISE(ABORT,'Immutable delivery acceptance'); END;
 CREATE TRIGGER retained_delivery_acceptance BEFORE DELETE ON delivery_acceptances BEGIN SELECT RAISE(ABORT,'Retained delivery acceptance'); END;
 `);}},
 {id:16,name:'scoped-immutable-evidence-packets',up(db){db.exec(`
 CREATE TABLE evidence_packets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,manifest_json TEXT NOT NULL,json_text TEXT NOT NULL,html_text TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX evidence_packets_order ON evidence_packets(project_id,run_id,order_id,created_at);
 CREATE TRIGGER immutable_evidence_packet BEFORE UPDATE ON evidence_packets BEGIN SELECT RAISE(ABORT,'Immutable evidence packet'); END;
 CREATE TRIGGER retained_evidence_packet BEFORE DELETE ON evidence_packets BEGIN SELECT RAISE(ABORT,'Retained evidence packet'); END;
 `);}},
 {id:17,name:'unresolved-logical-assessment-work',up(db){db.exec(`
 ALTER TABLE assessment_attempts ADD COLUMN logical_key TEXT;
 CREATE UNIQUE INDEX assessment_unresolved_logical ON assessment_attempts(project_id,run_id,logical_key)
 WHERE logical_key IS NOT NULL AND outcome IN ('prepared','dispatched','rejected','uncertain');
 CREATE TABLE evaluation_work_bindings(case_key TEXT NOT NULL,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(case_key,run_id,fingerprint));
 `);}},
 {id:18,name:'reviewed-installment-reminder-policies',up(db){db.exec(`
 CREATE TABLE installment_reminder_previews(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,owner_id TEXT NOT NULL,preview_json TEXT NOT NULL,preview_hash TEXT NOT NULL,created_at TEXT NOT NULL,consumed_at TEXT);
 CREATE TABLE installment_reminder_policies(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,version INTEGER NOT NULL,policy_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,version));
 CREATE TABLE installment_reminder_heads(order_id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,version INTEGER NOT NULL,disabled_at TEXT);
 CREATE TRIGGER immutable_installment_reminder_preview BEFORE UPDATE OF project_id,run_id,order_id,owner_id,preview_json,preview_hash,created_at ON installment_reminder_previews BEGIN SELECT RAISE(ABORT,'Immutable reminder preview'); END;
 CREATE TRIGGER immutable_installment_reminder_policy BEFORE UPDATE ON installment_reminder_policies BEGIN SELECT RAISE(ABORT,'Immutable reminder policy'); END;
 CREATE TRIGGER retained_installment_reminder_policy BEFORE DELETE ON installment_reminder_policies BEGIN SELECT RAISE(ABORT,'Retained reminder policy'); END;
 `);}},
 {id:19,name:'immutable-evidence-packet-files',up(db){db.exec(`
 CREATE TABLE evidence_packet_files(packet_id TEXT NOT NULL,name TEXT NOT NULL CHECK(name='image-'||sha256||'.png'),media_type TEXT NOT NULL CHECK(media_type='image/png'),sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),bytes BLOB NOT NULL CHECK(length(bytes)>0 AND length(bytes)<=1500000),created_at TEXT NOT NULL,PRIMARY KEY(packet_id,name));
 CREATE TRIGGER immutable_evidence_packet_file BEFORE UPDATE ON evidence_packet_files BEGIN SELECT RAISE(ABORT,'Immutable evidence packet file'); END;
 CREATE TRIGGER retained_evidence_packet_file BEFORE DELETE ON evidence_packet_files BEGIN SELECT RAISE(ABORT,'Retained evidence packet file'); END;
 `);}},
];

/** Each migration and its ledger entry commit together. Never swallow DDL failures. */
export function migrate(db: DatabaseSync, ordered: readonly Migration[] = migrations): void {
  if (ordered.some((m, i) => !Number.isSafeInteger(m.id) || m.id <= 0 || !m.name || (i > 0 && m.id <= ordered[i - 1].id))) {
    throw new Error("Migrations must have unique positive IDs in ascending order");
  }
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const recorded = db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all();
  for (let i = 0; i < recorded.length; i++) {
    if (ordered[i]?.id !== recorded[i].id || ordered[i]?.name !== recorded[i].name) throw new Error(`Unsupported recorded migration ${recorded[i].id}`);
  }
  for (const migration of ordered.slice(recorded.length)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}
