import {randomUUID} from 'node:crypto';
import {installmentData,hasExplicitSchedule} from './milestoneStore.js';
import {db,getProjectForRun,currentRunId,updateScopeBaseline,updateRateCard,transaction} from './db.js';
import {capturePair,contentHash} from './scopePersistence.js';
import {requireDesignerContext,requireOperationContext,sessionForContext,ScopedAccessError,type ServiceContext} from './context.js';
import {projectScope,type ProjectScopeProjection} from './connectorProjections.js';
import {createInvitation} from './sessions.js';
import {activeGrant,createGrant,credentialHash} from './judgeAccess.js';
import {config} from './env.js';
import type {ActorContext,ScopeContext,ScopeSnapshot,RateSnapshot,ScopeAcknowledgement,ScopeCommitment,ScopeContextReference,ScopeClause,RateCardItem} from '../shared/types.js';

const provenance=(row:any)=>({kind:row.provenance_kind,createdBy:row.created_by??null,sourceReference:row.source_reference,sourceTime:row.source_time,capturedAt:row.captured_at});
function snapshot(id:string):ScopeSnapshot {const r=db.prepare('SELECT * FROM scope_snapshots WHERE id=?').get(id) as any;if(!r)throw new ScopedAccessError(404,'Scope snapshot not found');return {id:r.id,projectId:r.project_id,runId:r.run_id,version:r.version,legacyRevision:r.legacy_revision,clauses:JSON.parse(r.clauses_json),contentHash:r.content_hash,provenance:provenance(r)};}
function rates(id:string):RateSnapshot {const r=db.prepare('SELECT * FROM rate_card_snapshots WHERE id=?').get(id) as any;return {id:r.id,projectId:r.project_id,runId:r.run_id,version:r.version,currency:r.currency,entries:JSON.parse(r.entries_json),contentHash:r.content_hash,provenance:provenance(r)};}
/** Internal callers already authenticate their run. No reads occur at module initialization. */
export function ensureScopeHead(runId:string,creator:string|null=null){
 return transaction(()=>{
  const p=getProjectForRun(runId),head=db.prepare('SELECT * FROM run_scope_heads WHERE project_id=? AND run_id=?').get(p.id,runId) as any;
  const oldScope=head?snapshot(head.scope_snapshot_id):null,oldRates=head?rates(head.rate_snapshot_id):null;
  const scopeHash=contentHash(p.scopeClauses),rateHash=contentHash({currency:p.currency,entries:p.rateCard});
  if(head&&oldScope!.contentHash===scopeHash&&oldRates!.contentHash===rateHash)return head;
  const frozen=db.prepare('SELECT created_at FROM judge_runs WHERE run_id=?').get(runId) as any;
  const pair=capturePair(db,p,runId,head?'designer_published':'legacy_import',frozen?`judge_run:${runId}`:head?`context:${head.context_version+1}`:`run:${runId}`,frozen?.created_at??null,creator);
  const next={project_id:p.id,run_id:runId,scope_snapshot_id:oldScope?.contentHash===scopeHash?oldScope.id:pair.scopeSnapshotId,rate_snapshot_id:oldRates?.contentHash===rateHash?oldRates.id:pair.rateSnapshotId,context_version:(head?.context_version??0)+1};
  db.prepare('INSERT INTO run_scope_heads VALUES(?,?,?,?,?) ON CONFLICT(project_id,run_id) DO UPDATE SET scope_snapshot_id=excluded.scope_snapshot_id,rate_snapshot_id=excluded.rate_snapshot_id,context_version=excluded.context_version').run(next.project_id,runId,next.scope_snapshot_id,next.rate_snapshot_id,next.context_version);
  return next;
 });
}
function acknowledgements(id:string){const records=(db.prepare('SELECT * FROM scope_acknowledgements WHERE snapshot_id=? ORDER BY created_at,id').all(id) as any[]).map(r=>({id:r.id,snapshotId:r.snapshot_id,actorId:r.actor_id,createdAt:r.created_at}));return {state:records.length?'acknowledged' as const:'supplied_unacknowledged' as const,records};}
function commitments(runId:string):ScopeCommitment[]{
 return (db.prepare(`SELECT a.id approval_id,a.created_at approval_time,a.change_order_revision revision,o.id,o.project_id,p.snapshot_json FROM approvals a JOIN change_orders o ON o.id=a.change_order_id LEFT JOIN proposal_revisions p ON p.change_order_id=o.id AND p.revision=a.change_order_revision WHERE o.run_id=? AND a.actor_role='client' ORDER BY o.id,a.change_order_revision`).all(runId) as any[]).map(r=>{
  const saved=r.snapshot_json?JSON.parse(r.snapshot_json):null;
  const observation=db.prepare('SELECT financial_json FROM payment_observations WHERE change_order_id=? ORDER BY id DESC LIMIT 1').get(r.id) as any;
  const explicit=hasExplicitSchedule(r.id,r.revision),raw=db.prepare('SELECT * FROM change_orders WHERE id=?').get(r.id) as any;
  return {sourceType:'approved_change',resourceId:r.id,revision:r.revision,terms:saved?{title:saved.title,deliverables:saved.deliverables,lineItems:saved.lineItems,totalMinor:saved.totalMinor,currency:saved.currency,...(saved.milestoneSchedule?{milestoneSchedule:saved.milestoneSchedule}:{})}:null,approvalEvidence:{id:r.approval_id,createdAt:r.approval_time},workDisposition:'committed',financialState:explicit?null:observation?.financial_json?JSON.parse(observation.financial_json):null,...(explicit?{installmentSummary:installmentData({...raw,revision:r.revision})?.installmentSummary}:{}),deliveryReferences:db.prepare('SELECT id,review_id,snapshot_id,snapshot_hash,review_revision,created_at FROM delivery_acceptances WHERE order_id=? AND order_revision=? ORDER BY created_at,id').all(r.id,r.revision)};
 });
}
export function scopeContextForRun(runId:string):ScopeContext {
 const head=ensureScopeHead(runId),items=commitments(runId),fingerprint=contentHash(items.map(({financialState,deliveryReferences,installmentSummary,...stable})=>stable));
 return {scopeSnapshot:snapshot(head.scope_snapshot_id),rateSnapshot:rates(head.rate_snapshot_id),contextVersion:head.context_version,acknowledgement:acknowledgements(head.scope_snapshot_id),commitments:items,commitmentFingerprint:fingerprint,contextFingerprint:contentHash([head.scope_snapshot_id,head.rate_snapshot_id,fingerprint])};
}
export function getScopeContext(ctx:ActorContext):ScopeContext {requireDesignerContext(ctx);return scopeContextForRun(ctx.runId);}
/** Operation entrance `get_project_scope`: scope, rates and approved commitments. Unfenced; only existing lazy ledger bookkeeping. */
export function getProjectScope(ctx:ServiceContext,input:unknown={}):ProjectScopeProjection {
 requireOperationContext(ctx,'get_project_scope');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new ScopedAccessError(400,'The project scope read accepts no arguments');
 return projectScope(scopeContextForRun(ctx.runId));
}
export function getScopeSnapshot(ctx:ActorContext,id:string){
 sessionForContext(ctx);const s=snapshot(id);
 if(s.projectId!==ctx.projectId||s.runId!==ctx.runId||(ctx.role==='client'&&(ctx.grant.kind!=='scope'||ctx.grant.resourceId!==id||ctx.grant.revision!==s.version)))throw new ScopedAccessError(403,'No access to this scope snapshot');
 const acknowledgement=acknowledgements(id);return {scopeSnapshot:s,acknowledgement,acknowledgedByThisAuthority:acknowledgement.records.some(r=>r.actorId===ctx.actorId)};
}
export function acknowledgeScope(ctx:ActorContext,id:string,expectedVersion?:number):ScopeAcknowledgement {
 if(ctx.role!=='client'||ctx.grant.kind!=='scope')throw new ScopedAccessError(403,'Requires exact client scope access');
 const {scopeSnapshot:s}=getScopeSnapshot(ctx,id);if(expectedVersion!==undefined&&expectedVersion!==s.version)throw new ScopedAccessError(409,'Scope version changed');
 const session=sessionForContext(ctx),at=new Date().toISOString();
 db.prepare('INSERT OR IGNORE INTO scope_acknowledgements VALUES(?,?,?,?,?,?,1,?)').run(randomUUID(),ctx.projectId,ctx.runId,id,ctx.actorId,session.grantId,at);
 return acknowledgements(id).records.find(r=>r.actorId===ctx.actorId)!;
}
function editable(ctx:ActorContext,expected:number){requireDesignerContext(ctx);if(!sessionForContext(ctx).canEditScope||ctx.runId!==currentRunId())throw new ScopedAccessError(403,'The judging brief and rate card are fixed for this run');const current=getScopeContext(ctx);if(expected!==current.contextVersion)throw new ScopedAccessError(409,'Scope context version changed; reload before editing');return current;}
export function publishScope(ctx:ActorContext,clauses:ScopeClause[],expected:number){return transaction(()=>{editable(ctx,expected);updateScopeBaseline(clauses,ctx.actorId);return getScopeContext(ctx);});}
export function publishRates(ctx:ActorContext,entries:RateCardItem[],expected:number){return transaction(()=>{editable(ctx,expected);updateRateCard(entries,ctx.actorId);return getScopeContext(ctx);});}
export function createScopeParent(projectId:string,runId:string,kind:string,reference:string,expiresAt:string){const id=randomUUID();db.prepare('INSERT INTO scope_access_parents VALUES(?,?,?,?,?,?)').run(id,projectId,runId,kind,reference,expiresAt);return id;}
export function issueScopeAccess(ctx:ActorContext,id:string,expectedVersion:number){
 requireDesignerContext(ctx);const s=getScopeSnapshot(ctx,id).scopeSnapshot,session=sessionForContext(ctx);
 if(s.version!==expectedVersion)throw new ScopedAccessError(409,'Scope version changed');
 const parent=session.grantId?activeGrant(session.grantId):null;
 const parentId=createScopeParent(ctx.projectId,ctx.runId,parent?'grant':'session',parent?parent.id:credentialHash(session.token),parent?.expires_at??session.expiresAt);
 return scopeAccessLink(ctx.runId,s,parentId,parent?.judge_access_id??null,parent?.expires_at??session.expiresAt);
}
/** Only trusted relationship owners call this; HTTP cannot supply parent authority. */
export function scopeAccessLink(runId:string,s:ScopeSnapshot,parentId:string,accessId:string|null,expiresAt:string){
 if(accessId){const grant=createGrant(accessId,runId,'client',null,null,{kind:'scope',resourceId:s.id,revision:s.version,parentId});return {scopeUrl:`${config.publicUrl}/scope#resume=${grant.credential}`,expiresAt:grant.expiresAt};}
 const invitation=createInvitation({projectId:s.projectId,runId,role:'client',grantKind:'scope',resourceId:s.id,resourceRevision:s.version,scopeParentId:parentId,expiresAt});
 return {scopeUrl:`${config.publicUrl}/scope#${invitation.token}`,expiresAt:invitation.expiresAt};
}
export function captureScopeContext(runId:string):ScopeContextReference {
 const c=scopeContextForRun(runId),id=randomUUID();
 db.prepare('INSERT INTO scope_contexts VALUES(?,?,?,?,?,?,?,?,?)').run(id,c.scopeSnapshot.projectId,runId,c.scopeSnapshot.id,c.rateSnapshot.id,c.commitmentFingerprint,JSON.stringify(c.commitments),'captured',new Date().toISOString());
 return {id,scopeVersion:c.scopeSnapshot.version,rateVersion:c.rateSnapshot.version,scopeSnapshotId:c.scopeSnapshot.id,rateSnapshotId:c.rateSnapshot.id,commitmentFingerprint:c.commitmentFingerprint,commitments:c.commitments,provenanceKind:'captured'};
}
export function contextById(id:string):ScopeContextReference|null {const r=db.prepare('SELECT * FROM scope_contexts WHERE id=?').get(id) as any;return r?{id:r.id,scopeVersion:r.scope_snapshot_id?snapshot(r.scope_snapshot_id).version:null,rateVersion:r.rate_snapshot_id?rates(r.rate_snapshot_id).version:null,scopeSnapshotId:r.scope_snapshot_id,rateSnapshotId:r.rate_snapshot_id,commitmentFingerprint:r.commitment_fingerprint,commitments:JSON.parse(r.commitments_json),provenanceKind:r.provenance_kind}:null;}
export function linkedScopeContext(kind:string,id:string,revision=1){const r=db.prepare('SELECT context_id FROM scope_context_links WHERE kind=? AND resource_id=? AND revision=?').get(kind,id,revision) as any;return r?contextById(r.context_id):null;}
export function linkScopeContext(kind:string,id:string,revision:number,contextId:string){db.prepare('INSERT OR IGNORE INTO scope_context_links VALUES(?,?,?,?)').run(kind,id,revision,contextId);}
export function contextRatesCurrent(ref:ScopeContextReference|null,runId:string){
 if(!ref?.rateSnapshotId)return false;const h=ensureScopeHead(runId);
 return ref.rateSnapshotId===h.rate_snapshot_id||(ref.provenanceKind==='legacy_import'&&rates(ref.rateSnapshotId).contentHash===rates(h.rate_snapshot_id).contentHash);
}
export function contextTermsCurrent(ref:ScopeContextReference|null,runId:string){
 if(!ref?.scopeSnapshotId||!contextRatesCurrent(ref,runId))return false;const h=ensureScopeHead(runId);
 if(ref.scopeSnapshotId===h.scope_snapshot_id)return true;
 // Historical evidence retains its own capture identity. Equal actual terms do
 // not become stale simply because the ledger was installed later.
 const saved=snapshot(ref.scopeSnapshotId),current=snapshot(h.scope_snapshot_id);
 return ref.provenanceKind==='legacy_import'&&saved.contentHash===current.contentHash&&saved.legacyRevision===current.legacyRevision;
}
export function contextCurrent(ref:ScopeContextReference|null,runId:string){return contextTermsCurrent(ref,runId)&&ref!.commitmentFingerprint===scopeContextForRun(runId).commitmentFingerprint;}
