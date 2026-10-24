import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ProjectView} from '../shared/types.js';

export const contentHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** No application imports or import-time reads: safe inside the recorded migration. */
export function capturePair(db:DatabaseSync,project:ProjectView,runId:string,kind:string,sourceReference:string|null=null,sourceTime:string|null=null,creator:string|null=null){
 const at=new Date().toISOString();
 const capture=(table:string,body:unknown,label:string|null)=>{
  const hash=contentHash(body);
  const existing=db.prepare(`SELECT id FROM ${table} WHERE project_id=? AND run_id=? AND content_hash=? AND provenance_kind=? AND source_reference IS ?`)
   .get(project.id,runId,hash,kind,sourceReference) as any;
  if(existing)return existing.id as string;
  const version=Number((db.prepare(`SELECT coalesce(max(version),0)+1 n FROM ${table} WHERE project_id=? AND run_id=?`).get(project.id,runId) as any).n),id=randomUUID();
  if(table==='scope_snapshots')db.prepare(`INSERT INTO scope_snapshots(id,project_id,run_id,version,legacy_revision,clauses_json,content_hash,provenance_kind,source_reference,source_time,captured_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,project.id,runId,version,label,JSON.stringify(body),hash,kind,sourceReference,sourceTime,at,creator);
  else db.prepare(`INSERT INTO rate_card_snapshots(id,project_id,run_id,version,currency,entries_json,content_hash,provenance_kind,source_reference,source_time,captured_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,project.id,runId,version,project.currency,JSON.stringify(project.rateCard),hash,kind,sourceReference,sourceTime,at,creator);
  return id;
 };
 return {scopeSnapshotId:capture('scope_snapshots',project.scopeClauses,project.scopeRevisionId),rateSnapshotId:capture('rate_card_snapshots',{currency:project.currency,entries:project.rateCard},null)};
}
export function migrateScopeLedger(db:DatabaseSync){
 db.exec(`CREATE TABLE scope_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,version INTEGER NOT NULL,legacy_revision TEXT,clauses_json TEXT NOT NULL,content_hash TEXT NOT NULL,provenance_kind TEXT NOT NULL,source_reference TEXT,source_time TEXT,captured_at TEXT NOT NULL,created_by TEXT,UNIQUE(project_id,run_id,version));
 CREATE TABLE rate_card_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,version INTEGER NOT NULL,currency TEXT NOT NULL,entries_json TEXT NOT NULL,content_hash TEXT NOT NULL,provenance_kind TEXT NOT NULL,source_reference TEXT,source_time TEXT,captured_at TEXT NOT NULL,created_by TEXT,UNIQUE(project_id,run_id,version));
 CREATE TABLE run_scope_heads(project_id TEXT NOT NULL,run_id TEXT NOT NULL,scope_snapshot_id TEXT NOT NULL,rate_snapshot_id TEXT NOT NULL,context_version INTEGER NOT NULL,PRIMARY KEY(project_id,run_id));
 CREATE TABLE scope_acknowledgements(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,actor_id TEXT NOT NULL,grant_id TEXT,consent INTEGER NOT NULL CHECK(consent=1),created_at TEXT NOT NULL,UNIQUE(snapshot_id,actor_id));
 CREATE TABLE scope_contexts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,scope_snapshot_id TEXT,rate_snapshot_id TEXT,commitment_fingerprint TEXT,commitments_json TEXT NOT NULL,provenance_kind TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE scope_context_links(kind TEXT NOT NULL,resource_id TEXT NOT NULL,revision INTEGER NOT NULL,context_id TEXT NOT NULL,PRIMARY KEY(kind,resource_id,revision));
 CREATE TABLE scope_access_parents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,parent_kind TEXT NOT NULL,parent_ref TEXT NOT NULL,expires_at TEXT NOT NULL);
 `);
 for(const table of ['sessions','invitations','renewal_grants']){
  db.exec(`ALTER TABLE ${table} ADD COLUMN grant_kind TEXT; ALTER TABLE ${table} ADD COLUMN resource_id TEXT; ALTER TABLE ${table} ADD COLUMN resource_revision INTEGER; ALTER TABLE ${table} ADD COLUMN scope_parent_id TEXT;`);
 }
 for(const table of ['scope_snapshots','rate_card_snapshots','scope_acknowledgements','scope_contexts','scope_context_links']){
  db.exec(`CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable scope evidence'); END;`);
  db.exec(`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable scope evidence'); END;`);
 }
 // Import only actual stored evidence. Relative historical chronology is unknown.
 const importEvidence=(kind:string,id:string,revision:number,runId:string,project:any,time:string)=>{
  const valid=project&&Array.isArray(project.scopeClauses)&&Array.isArray(project.rateCard)&&typeof project.id==='string';
  const pair=valid?capturePair(db,project,runId,'legacy_import',`${kind}:${id}:${revision}`,time):null;
  const contextId=randomUUID();
  db.prepare('INSERT INTO scope_contexts VALUES(?,?,?,?,?,?,?,?,?)').run(contextId,project?.id??'demo',runId,pair?.scopeSnapshotId??null,pair?.rateSnapshotId??null,null,'[]','legacy_import',new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO scope_context_links VALUES(?,?,?,?)').run(kind,id,revision,contextId);
 };
 for(const row of db.prepare('SELECT * FROM assessments').all() as any[]){let input:any;try{input=JSON.parse(row.input_json);}catch{}importEvidence('assessment',row.id,1,row.run_id,input?.project,row.created_at);}
 for(const row of db.prepare('SELECT p.*,o.run_id FROM proposal_revisions p JOIN change_orders o ON o.id=p.change_order_id').all() as any[]){let snapshot:any;try{snapshot=JSON.parse(row.snapshot_json);}catch{}importEvidence('proposal',row.change_order_id,row.revision,row.run_id,snapshot?.scopeSnapshot,row.created_at);}
 for(const row of db.prepare('SELECT * FROM approvals').all() as any[]){const link=db.prepare("SELECT context_id FROM scope_context_links WHERE kind='proposal' AND resource_id=? AND revision=?").get(row.change_order_id,row.change_order_revision) as any;if(link)db.prepare('INSERT INTO scope_context_links VALUES(?,?,?,?)').run('approval',String(row.id),1,link.context_id);}
 // Heads are captured lazily from the authenticated run's actual stored project.
}
