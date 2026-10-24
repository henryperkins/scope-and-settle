import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { isolatedApp } from './helpers.mjs';

const app=await isolatedApp();
const migration=await app.load('migrations').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const expected=['projects','change_orders','invoice_operations','payment_observations','sessions','approvals','invoice_tombstones','demo_state','invitations','proposal_revisions','judge_access','judge_runs','renewal_grants','agent_policies','agent_policy_history','agent_requests','agent_messages','agent_portals','agent_outbox','agent_runtime','assessments','ai_calls','webhook_receipts','jobs','job_runtime','scope_snapshots','rate_card_snapshots','run_scope_heads','scope_acknowledgements','scope_contexts','scope_context_links','scope_access_parents','designer_item_prices','request_sources','request_source_versions','request_items','request_item_results','proposal_item_operations','proposal_item_reservations','duplicate_decisions','request_order_links','design_evidence_snapshots','design_evidence_bytes','assessment_evidence','assessment_attempts','inbox_settings','inbox_setting_history','request_inbox','figma_refresh_state','figma_event_receipts','reviewed_actions','outbound_operations','request_source_freshness','connector_credentials','connector_budget_reservations','status_card_settings','milestone_schedules','milestones','invoice_records','milestone_due_events','installment_actions','delivery_runs','delivery_snapshots','delivery_reviews','delivery_review_heads','delivery_events','delivery_acceptances'].sort();
function migrate(db,...args){assert.equal(typeof migration.migrate,'function','recorded migration runner is required');migration.migrate(db,...args);}

test('T14 legacy adoption detects conflicting operation identities without dropping history or failing migration',()=>{
 const db=new DatabaseSync(':memory:');try{
  migrate(db,migration.migrations.slice(0,12));
  for(const id of ['a','b']){
   db.prepare("INSERT INTO change_orders(id,project_id,run_id,title,deliverables_json,line_items_json,total_minor,currency,status,revision,created_at) VALUES(?,'demo','run','Legacy','[]','[]',25000,'USD','approved',1,'old')").run(id);
   db.prepare("INSERT INTO invoice_operations(operation_key,change_order_id,state,paypal_invoice_id,created_at,updated_at) VALUES(?,?,'created','INV2-SHARED','old','old')").run('invoice:'+id,id);
  }
  assert.doesNotThrow(()=>migrate(db));assert.equal(db.prepare("SELECT count(*) n FROM invoice_records WHERE adoption_issue='ambiguous_provider_identity' AND provider_id IS NULL").get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM invoice_operations').get().n,2);
 }finally{db.close();}
});

test('T14 migration adopts legacy invoice/operation/observations once without rewriting approval history',()=>{
 const db=new DatabaseSync(':memory:');try{
  migrate(db,migration.migrations.slice(0,12));
  db.prepare("INSERT INTO change_orders(id,project_id,run_id,title,deliverables_json,line_items_json,total_minor,currency,status,revision,created_at,paypal_invoice_id,invoice_url) VALUES('legacy-order','demo','legacy-run','Legacy','[\"Original\"]','[]',25000,'USD','paid',1,'old','INV2-LEGACY','https://www.sandbox.paypal.com/original')").run();
  const terms=JSON.stringify({invoiceNumber:'OLD-NUMBER',representation:'aggregate-v0',totalMinor:25000});
  db.prepare("INSERT INTO invoice_operations(operation_key,change_order_id,state,paypal_invoice_id,created_at,updated_at,representation,approved_terms_json) VALUES('invoice:legacy-order','legacy-order','sent','INV2-LEGACY','old','old','aggregate-v0',?)").run(terms);
  db.prepare("INSERT INTO proposal_revisions VALUES('legacy-order',1,'{\"original\":true}','old')").run();
  db.prepare("INSERT INTO payment_observations(change_order_id,paypal_invoice_id,raw_status,display_status,checked_at) VALUES('legacy-order','INV2-LEGACY','PAID','paid','old')").run();
  migrate(db,migration.migrations.slice(0,13));
  const records=db.prepare('SELECT * FROM invoice_records').all();assert.equal(records.length,1);assert.equal(records[0].provider_id,'INV2-LEGACY');assert.equal(records[0].operation_key,'invoice:legacy-order');assert.equal(records[0].terms_json,terms);
  assert.equal(db.prepare('SELECT invoice_record_id FROM payment_observations').get().invoice_record_id,records[0].id);
  assert.equal(db.prepare('SELECT snapshot_json FROM proposal_revisions').get().snapshot_json,'{"original":true}');
  assert.equal(db.prepare('SELECT legacy FROM milestones').get().legacy,1);assert.equal(db.prepare('SELECT count(*) n FROM invoice_operations').get().n,1);
 }finally{db.close();}
});
function tables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name").all().map(r=>r.name);}
function contents(db){return Object.fromEntries([...tables(db),'sqlite_sequence'].filter(t=>db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(t)).map(t=>[t,db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));}
function schema(db){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name!='schema_migrations' ORDER BY name").all();}

test('T12b migration eleven preserves accepted v10 authority and paid history and introduces empty scoped display settings',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  migrate(db,migration.migrations.slice(0,10));
  db.prepare('INSERT INTO ai_calls(id,reserved_micro_usd,actual_micro_usd,created_at) VALUES(?,?,?,?)').run('prior-paid-call',1000,900,'old');
  db.prepare("INSERT INTO connector_credentials(id,format_version,digest,project_id,run_id,file_key,operations_json,parent_kind,parent_ref,owner_actor_id,max_assessments,max_cost_micro_usd,issued_at,expires_at) VALUES('prior-connector',1,?,'demo','run-one','test-file','[]','session','parent','owner',2,1000,'old','later')").run('a'.repeat(64));
  db.prepare("INSERT INTO connector_budget_reservations(id,connector_id,attempt_id,reserved_micro_usd,state,created_at,updated_at) VALUES('prior-budget','prior-connector','prior-attempt',1000,'held','old','old')").run();
  const before=contents(db);migrate(db,migration.migrations.slice(0,11));const after=contents(db);
  assert.deepEqual(after.status_card_settings,[]);delete after.status_card_settings;assert.deepEqual(after,before);
  assert.equal(db.prepare('SELECT MAX(id) id FROM schema_migrations').get().id,11);
  db.prepare("INSERT INTO status_card_settings(project_id,run_id,version,actor_id,updated_at) VALUES('demo','run-one',1,'owner','now')").run();
  assert.equal(db.prepare('SELECT show_amounts FROM status_card_settings').get().show_amounts,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
test('T09 migration seven preserves all accepted v6 rows and global paid-attempt history',()=>{const db=new DatabaseSync(':memory:');try{migrate(db,migration.migrations.slice(0,6));db.prepare('INSERT INTO ai_calls(id,reserved_micro_usd,actual_micro_usd,created_at) VALUES(?,?,?,?)').run('prior-spend',1000,900,'old');db.prepare("INSERT INTO jobs(id,job_key,kind,project_id,run_id,payload_json,due_at,created_at,updated_at) VALUES('prior-job','prior-key','paypal_reconcile','demo','run-1','{}','old','old','old')").run();const before=contents(db);migrate(db,migration.migrations.slice(0,7));const after=contents(db);for(const name of ['inbox_settings','inbox_setting_history','request_inbox','figma_refresh_state','figma_event_receipts'])delete after[name];assert.deepEqual(after,before);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}});

test('db startup owns all owned tables before assessment, agent, AI and webhook imports',async()=>{
  const {db}=await app.load('db');
  try {
    assert.deepEqual(tables(db),expected);
    const before=schema(db);
    for(const name of ['webhooks','agentStore','assessment','aiBudget'])await app.load(name);
    assert.deepEqual(schema(db),before);
  }finally{db.close();}
});

test('fresh migration is complete, recorded once and preserves unique indexes on rerun',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrate(db); assert.deepEqual(tables(db),expected);
    const before=schema(db);migrate(db);assert.deepEqual(schema(db),before);
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(x=>x.id),[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
    for(const [table,columns] of [['agent_requests',['run_id','source','source_id']],['proposal_revisions',['change_order_id','revision']],['renewal_grants',['credential_hash']]]) {
      const indexes=db.prepare(`PRAGMA index_list(${table})`).all();
      assert.ok(indexes.some(i=>i.unique&&JSON.stringify(db.prepare(`PRAGMA index_info("${i.name}")`).all().map(c=>c.name))===JSON.stringify(columns)),table);
    }
  }finally{db.close();}
});

test('first-scaffold upgrade adds all eight columns without losing existing data',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrate(db,migration.migrations.slice(0,1));
    db.exec('DELETE FROM schema_migrations');
    const additions={change_orders:['revision','scope_revision_id','run_id','scope_snapshot_json','assessment_id'],sessions:['run_id','grant_id'],agent_requests:['delivery_exception']};
    for(const [table,cols]of Object.entries(additions))for(const col of cols)db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
    db.prepare('INSERT INTO change_orders (id,project_id,title,deliverables_json,line_items_json,total_minor,currency,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('legacy','demo','Legacy','[]','[]',25000,'USD','approved','now');
    migrate(db);
    for(const [table,cols]of Object.entries(additions))for(const col of cols)assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===col));
    const row=db.prepare('SELECT * FROM change_orders').get();assert.equal(row.title,'Legacy');assert.equal(row.revision,1);assert.equal(row.run_id,'run-1');assert.equal(row.total_minor,25000);
  }finally{db.close();}
});

test('migrations run in order and rollback schema/data/record together on real errors',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrate(db,[{id:1,name:'first',up(d){d.exec('CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES (\'kept\')');}},
      {id:2,name:'second',up(d){assert.equal(d.prepare('SELECT value FROM proof').get().value,'kept');d.exec("INSERT INTO proof VALUES ('second')");}}]);
    assert.throws(()=>migrate(db,[{id:1,name:'first',up(){}},{id:2,name:'second',up(){}},{id:3,name:'broken',up(d){d.exec("UPDATE proof SET value='lost'; CREATE TABLE partial (id TEXT); ALTER TABLE missing ADD COLUMN bad TEXT");}}]),/migration 3.*broken/i);
    assert.equal(db.prepare('SELECT value FROM proof ORDER BY rowid LIMIT 1').get().value,'kept');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(),undefined);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,2);
    assert.throws(()=>migrate(db,[{id:1,name:'first',up(){}}]),/unsupported/i);
    assert.throws(()=>migrate(db,[{id:2,name:'second',up(){}},{id:1,name:'first',up(){}}]),/order/i);
  }finally{db.close();}
});

test('incompatible existing columns fail adoption without stamping a migration',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE sessions (token TEXT PRIMARY KEY, run_id INTEGER)');
    assert.throws(()=>migrate(db),/incompatible/i);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get(),undefined);
  }finally{db.close();}
});

test('adopting the synthetic 0.3.0 fixture preserves every row, snapshot, ledger value and constraint',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(await readFile(new URL('./fixtures/baseline-0.3.0.sql',import.meta.url),'utf8'));
    for(const name of tables(db)) {
      const cols=db.prepare(`PRAGMA table_info(${name})`).all();
      const values=cols.map(c=>c.type==='INTEGER'?1:c.name.endsWith('_json')?'{"fixture":"frozen"}':'fixture-'+c.name);
      db.prepare(`INSERT INTO ${name} (${cols.map(c=>c.name).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...values);
    }
    db.exec("UPDATE change_orders SET status='paid',paypal_invoice_id='INV2-FIXTURE'; UPDATE ai_calls SET reserved_micro_usd=900,actual_micro_usd=123; INSERT INTO ai_calls (id,reserved_micro_usd,created_at) VALUES ('unsettled',456,'now')");
    const before=contents(db),beforeSchema=schema(db);
    migrate(db,migration.migrations.slice(0,1));
    assert.deepEqual(contents(db),before);assert.deepEqual(schema(db),beforeSchema);
    migrate(db);migrate(db);
    assert.equal(db.prepare("SELECT representation FROM invoice_operations").get().representation,"aggregate-v0");
    assert.equal(db.prepare('SELECT order_id FROM request_order_links').get().order_id,before.agent_requests[0].order_id);
    const after=contents(db);for(const row of after.invoice_operations){delete row.representation;delete row.approved_terms_json;}for(const row of after.payment_observations){delete row.financial_json;delete row.invoice_record_id;}
    delete after.jobs;delete after.job_runtime;for(const row of after.webhook_receipts)for(const key of ['event_type','route_key','job_id','received_at','verified_at'])delete row[key];
    for(const table of ['scope_snapshots','rate_card_snapshots','run_scope_heads','scope_acknowledgements','scope_contexts','scope_context_links','scope_access_parents','designer_item_prices','request_sources','request_source_versions','request_items','request_item_results','proposal_item_operations','proposal_item_reservations','duplicate_decisions','request_order_links','design_evidence_snapshots','design_evidence_bytes','assessment_evidence','assessment_attempts','inbox_settings','inbox_setting_history','request_inbox','figma_refresh_state','figma_event_receipts','reviewed_actions','outbound_operations','request_source_freshness','connector_credentials','connector_budget_reservations','status_card_settings','milestone_schedules','milestones','invoice_records','milestone_due_events','installment_actions','delivery_runs','delivery_snapshots','delivery_reviews','delivery_review_heads','delivery_events','delivery_acceptances'])delete after[table];
    for(const table of ['sessions','invitations','renewal_grants'])for(const row of after[table])for(const key of ['grant_kind','resource_id','resource_revision','scope_parent_id'])delete row[key];
    assert.deepEqual(after,before);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{db.close();}
});


test('T10 migration eight preserves all accepted v7 rows and creates immutable action previews',()=>{
 const db=new DatabaseSync(':memory:');try{migrate(db,migration.migrations.slice(0,7));db.prepare("INSERT INTO agent_outbox(id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES('old','run-1','request','reminder','{}','old','old','old')").run();const before=contents(db);migrate(db,migration.migrations.slice(0,8));const after=contents(db);delete after.reviewed_actions;delete after.outbound_operations;delete after.request_source_freshness;delete after.connector_credentials;delete after.connector_budget_reservations;delete after.status_card_settings;assert.deepEqual(after,before);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}
});

test('T11a migration nine preserves all accepted v8 rows and adds an empty source-keyed freshness record',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  migrate(db,migration.migrations.slice(0,8));
  db.prepare("INSERT INTO request_sources VALUES('source-v8','demo','run-1','figma','test-file','root',2,'hash-2')").run();
  db.prepare("INSERT INTO request_source_versions VALUES('source-v8',1,'[]','hash-1','old'),('source-v8',2,'[]','hash-2','old')").run();
  db.prepare("INSERT INTO reviewed_actions(id,project_id,run_id,initiator_id,confirmer_id,kind,request_id,preview_json,preview_hash,expires_at,state,operation_key,created_at,updated_at) VALUES('action-v8','demo','run-1','actor','actor','post_clarification','request','{}','hash','old','prepared','reviewed:action-v8','old','old')").run();
  db.prepare("INSERT INTO outbound_operations(outbox_id,authority,action_id,run_id,kind,state,created_at,updated_at) VALUES('outbox-v8','human_review','action-v8','run-1','figma','uncertain','old','old')").run();
  db.prepare('INSERT INTO ai_calls(id,reserved_micro_usd,actual_micro_usd,created_at) VALUES(?,?,?,?)').run('v8-spend',1000,900,'old');
  const before=contents(db);
  migrate(db,migration.migrations.slice(0,9));
  const after=contents(db);
  // An absent freshness row means no known unavailability; the migration invents none.
  assert.deepEqual(after.request_source_freshness,[]);
  delete after.request_source_freshness;
  assert.deepEqual(after,before);
  assert.equal(db.prepare('SELECT MAX(id) id FROM schema_migrations').get().id,9);
  const columns=db.prepare('PRAGMA table_info(request_source_freshness)').all().map(c=>c.name);
  for(const column of ['source_id','run_id','state','reason','generation','observed_at','recovered_version'])assert.ok(columns.includes(column),column);
  assert.throws(()=>db.prepare("INSERT INTO request_source_freshness(source_id,project_id,run_id,state,reason,generation,observed_at,updated_at) VALUES('source-v8','demo','run-1','trusted','source_missing',1,'now','now')").run(),/CHECK/);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});

test('T11b migration ten preserves all accepted v9 rows and adds digest-only connector records and retained budget reservations',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  migrate(db,migration.migrations.slice(0,9));
  db.prepare("INSERT INTO request_sources VALUES('source-v9','demo','run-1','figma','test-file','root',2,'hash-2')").run();
  db.prepare("INSERT INTO request_source_freshness(source_id,project_id,run_id,state,reason,generation,observed_at,updated_at) VALUES('source-v9','demo','run-1','unavailable','source_missing',1,'old','old')").run();
  db.prepare("INSERT INTO assessment_attempts VALUES('attempt-v9','demo','run-1','fingerprint','source-v9',2,'uncertain','call-v9',NULL,'old','old')").run();
  db.prepare('INSERT INTO ai_calls(id,reserved_micro_usd,actual_micro_usd,created_at) VALUES(?,?,?,?)').run('call-v9',1000,1000,'old');
  db.prepare("INSERT INTO sessions(token,project_id,role,expires_at,created_at,run_id) VALUES('session-v9','demo','designer','old','old','run-1')").run();
  const before=contents(db);
  migrate(db,migration.migrations.slice(0,10));
  const after=contents(db);
  assert.deepEqual(after.connector_credentials,[]);assert.deepEqual(after.connector_budget_reservations,[]);
  delete after.status_card_settings;
  delete after.connector_credentials;delete after.connector_budget_reservations;
  assert.deepEqual(after,before);
  assert.equal(db.prepare('SELECT MAX(id) id FROM schema_migrations').get().id,10);
  const columns=table=>db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
  for(const column of ['id','digest','project_id','run_id','file_key','operations_json','parent_kind','parent_ref','owner_actor_id','max_assessments','max_cost_micro_usd','issued_at','expires_at','revoked_at'])assert.ok(columns('connector_credentials').includes(column),column);
  for(const column of ['connector_id','attempt_id','call_id','reserved_micro_usd','actual_micro_usd','state'])assert.ok(columns('connector_budget_reservations').includes(column),column);
  assert.ok(!columns('connector_credentials').some(c=>/secret|token/.test(c)));
  const insert=(id,parent='session')=>db.prepare("INSERT INTO connector_credentials(id,format_version,digest,project_id,run_id,file_key,operations_json,parent_kind,parent_ref,owner_actor_id,max_assessments,max_cost_micro_usd,issued_at,expires_at) VALUES(?,1,?,'demo','run-1','test-file','[]',?,'parent','owner',1,1000,'now','later')").run(id,id.padEnd(64,'0').slice(0,64),parent);
  assert.throws(()=>insert('forged','password'),/CHECK/);
  insert('record');
  assert.throws(()=>db.prepare("UPDATE connector_credentials SET run_id='run-2' WHERE id='record'").run(),/immutable/i);
  db.prepare("UPDATE connector_credentials SET revoked_at='now',revoked_reason='designer' WHERE id='record'").run();
  assert.throws(()=>db.prepare("UPDATE connector_credentials SET revoked_at=NULL WHERE id='record'").run(),/revoked/i);
  db.prepare("INSERT INTO connector_budget_reservations(id,connector_id,attempt_id,reserved_micro_usd,state,created_at,updated_at) VALUES('hold','record','attempt-v9',1000,'held','now','now')").run();
  assert.throws(()=>db.prepare("INSERT INTO connector_budget_reservations(id,connector_id,attempt_id,reserved_micro_usd,state,created_at,updated_at) VALUES('again','record','attempt-v9',1000,'held','now','now')").run(),/UNIQUE/);
  assert.throws(()=>db.prepare("UPDATE connector_budget_reservations SET state='released' WHERE id='hold'").run(),/CHECK/);
  assert.throws(()=>db.prepare("DELETE FROM connector_budget_reservations WHERE id='hold'").run(),/retained/i);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
