import {randomUUID} from 'node:crypto';
import {db,getProjectForRun,assertRunActive,transaction} from './db.js';
import {ScopedAccessError} from './context.js';
import {assess,getAssessment,assessmentInferenceIdentity,assessmentReservationMicroUsd,type AssessmentInput,type AssessmentCallHooks} from './assessment.js';
import {captureRequestSource,requireSourceCurrent,type RequestSource,type RequestSourceReference} from './requestSources.js';
import {recordRequestAssessment} from './requestItems.js';
import {scopeContextForRun,captureScopeContext,linkScopeContext} from './scopeLedger.js';
import {contentHash} from './scopePersistence.js';
import {designEvidenceById,evidenceForAssessment} from './designEvidence.js';
import type {DesignEvidenceSnapshot} from '../shared/types.js';

type Outcome='prepared'|'dispatched'|'succeeded'|'rejected'|'uncertain'|'not_dispatched';
export interface AssessmentWorkReference {fingerprint:string;logicalKey:string;source:RequestSourceReference;contextFingerprint:string;evidenceHash:string|null;inference:ReturnType<typeof assessmentInferenceIdentity>}
export interface AssessmentAttempt {id:string;fingerprint:string;outcome:Outcome;callId:string|null;assessmentId:string|null}
type Infer=(input:AssessmentInput,runId:string,assertAuthorized?:()=>void,hooks?:AssessmentCallHooks)=>Promise<any>;
/**
 * Optional trusted participant in a new durable logical attempt, such as a connector budget. Built only by a
 * private operation entrance from verified authority; never accepted from payload or job JSON.
 */
export interface PaidWorkParticipant {
 /** Inside the transaction that creates the attempt: reserve atomically with the shared estimate, or throw to refuse. */
 reserve(attemptId:string,estimateMicroUsd:number):void;
 /** Links the actual global `ai_calls` reservation. */
 linkCall(attemptId:string,callId:string):void;
 /** Actual known usage only. */
 settle(attemptId:string,actualMicroUsd:number):void;
}
const running=new Map<string,Promise<any>>();
let permit:Promise<void>=Promise.resolve();
const now=()=>new Date().toISOString();
const attemptProjection=(row:any):AssessmentAttempt=>({id:row.id,fingerprint:row.fingerprint,outcome:row.outcome,callId:row.call_id,assessmentId:row.assessment_id});

/** Only stable work identity: no financial/delivery observations, context-capture UUIDs or mutable UI projections. */
function lineage(runId:string) {
 return db.prepare(`SELECT p.item_id,p.assessment_id,p.order_id,p.state,o.revision,r.source_id,r.source_version,r.result_json
 FROM proposal_item_reservations p JOIN change_orders o ON o.id=p.order_id JOIN request_item_results r ON r.item_id=p.item_id AND r.assessment_id=p.assessment_id
 WHERE o.run_id=? AND p.state IN ('reserved','committed') ORDER BY p.item_id,p.order_id`).all(runId);
}
/** Trusted internal seam. Callbacks must validate private session or current exact policy/channel authority. Never accept them from payload JSON. */
export function prepareAssessmentWork(runId:string,source:RequestSource,input:AssessmentInput,assertAuthorized:()=>void,evidence:DesignEvidenceSnapshot|null=null):AssessmentWorkReference {
 assertAuthorized();assertRunActive(runId);
 const reference=captureRequestSource(runId,source),scope=scopeContextForRun(runId),project=getProjectForRun(runId);
 if(contentHash(input.project)!==contentHash(project)||input.comment.id!==source.messages[0]?.id||input.comment.message!==source.messages[0]?.message||contentHash(input.replies.map(m=>({id:m.id,message:m.message})))!==contentHash(source.messages.slice(1)))throw new ScopedAccessError(409,'Assessment input differs from authoritative source or project');
 if((input.imageDataUrl||input.designContext)&&!evidence||input.evidenceSnapshotId!==evidence?.id) {
  if(input.imageDataUrl||input.designContext||input.evidenceSnapshotId||evidence)throw new ScopedAccessError(400,'Only explicitly selected verified evidence may enter shared inference');
 }
 if(evidence){
  const fresh=designEvidenceById(runId,evidence.id);
  if(!fresh||contentHash(fresh)!==contentHash(evidence)||fresh.freshness!=='fresh'||fresh.verification!=='verified'||fresh.sourceId!==reference.id||fresh.sourceVersion!==reference.version)throw new ScopedAccessError(409,'Design evidence changed, is unavailable or stale');
  const canonical=evidenceForAssessment(runId,evidence.id,reference,evidence.anchorNodeId);
  if(input.imageDataUrl!==canonical.imageDataUrl||input.designContext!==canonical.designContext)throw new ScopedAccessError(409,'Assessment pixels or metadata differ from the immutable evidence');
 }
 const inference=assessmentInferenceIdentity(input);
 const semantic={project,runId,source:{...reference,source:source.source,fileKey:source.fileKey,rootId:source.rootId,messages:source.messages.map(m=>({id:m.id,message:m.message.normalize('NFC')}))},scopeSnapshotId:scope.scopeSnapshot.id,rateSnapshotId:scope.rateSnapshot.id,commitmentFingerprint:scope.commitmentFingerprint,lineage:lineage(runId),evidence:evidence?{id:evidence.id,hash:evidence.hash,version:evidence.providerVersion,anchor:evidence.anchorNodeId,relevance:evidence.relevance}:null,inference};
 const {promptImplementation,...logicalInference}=inference;
 return {fingerprint:contentHash(semantic),logicalKey:contentHash({...semantic,inference:logicalInference}),source:reference,contextFingerprint:scope.contextFingerprint,evidenceHash:evidence?.hash??null,inference};
}
function currentWork(runId:string,expected:AssessmentWorkReference,source:RequestSource,input:AssessmentInput,assertAuthorized:()=>void,evidence:DesignEvidenceSnapshot|null){
 assertAuthorized();requireSourceCurrent(runId,expected.source);
 const fresh=prepareAssessmentWork(runId,source,input,assertAuthorized,evidence);
 if(contentHash(fresh)!==contentHash(expected))throw new ScopedAccessError(409,'Assessment work was superseded; refresh before assessing');
}
/** Missing legacy association is deliberately conservative; never invent metadata for old paid work. */
function unresolvedWork(runId:string,reference:AssessmentWorkReference) {
 return db.prepare(`SELECT * FROM assessment_attempts WHERE run_id=?
 AND outcome IN ('prepared','dispatched','rejected','uncertain')
 AND (logical_key=? OR (logical_key IS NULL AND source_id=? AND source_version=?))
 ORDER BY created_at,id LIMIT 1`).get(runId,reference.logicalKey??null,reference.source.id,reference.source.version) as any;
}
function requireNoUnresolvedWork(runId:string,reference:AssessmentWorkReference) {
 if(unresolvedWork(runId,reference))throw new ScopedAccessError(409,'Unresolved logical or legacy assessment attempt requires review before another paid attempt');
}
/** Read-only outcome query. A prepared/dispatched attempt without this process's promise is interrupted/uncertain. */
export function assessmentWorkOutcome(runId:string,reference:AssessmentWorkReference,assertAuthorized:()=>void){
 assertAuthorized();assertRunActive(runId);const row=(db.prepare("SELECT * FROM assessment_attempts WHERE run_id=? AND fingerprint=? AND outcome<>'not_dispatched'").get(runId,reference.fingerprint)??unresolvedWork(runId,reference)) as any;
 if(!row)return {state:'not_started' as const,attempt:null,newAttemptPermitted:true};
 const key=runId+':'+row.fingerprint;
 const state=row.outcome==='prepared'||row.outcome==='dispatched'?(running.has(key)?'in_progress':'uncertain'):row.outcome;
 return {state,attempt:attemptProjection(row),newAttemptPermitted:false};
}
function projectResult(runId:string,attempt:any,source:RequestSourceReference) {
 let record=getAssessment(attempt.assessment_id,runId);
 if(!record)throw new ScopedAccessError(409,'Saved assessment is unavailable; paid attempt requires review');
 // Another mode/evidence assessment may have become the latest displayed item review.
 // Reuse the validated semantic output in a new immutable attachment, rather than authorizing stale UI terms.
 const superseded=(record.items??[]).some((item:any)=>(db.prepare('SELECT assessment_id FROM request_item_results WHERE item_id=? ORDER BY rowid DESC LIMIT 1').get(item.id) as any)?.assessment_id!==record.id);
 if(superseded){transaction(()=>{
  const stored=db.prepare('SELECT * FROM assessments WHERE id=? AND run_id=?').get(record.id,runId) as any;
  const prior=JSON.parse(stored.result_json),context=captureScopeContext(runId),copy={...prior,id:randomUUID(),scopeContext:context,reusedFromAssessmentId:record.id,createdAt:now()};
  db.prepare('INSERT INTO assessments VALUES(?,?,?,?,?,?,?)').run(copy.id,stored.project_id,runId,stored.scope_revision_id,stored.input_json,JSON.stringify(copy),copy.createdAt);
  linkScopeContext('assessment',copy.id,1,context.id);
  const link=db.prepare('SELECT snapshot_id FROM assessment_evidence WHERE assessment_id=? AND run_id=?').get(record.id,runId) as any;
  if(link)db.prepare('INSERT INTO assessment_evidence VALUES(?,?,?)').run(copy.id,runId,link.snapshot_id);
  const sourceRow=db.prepare('SELECT * FROM request_sources WHERE id=? AND run_id=?').get(source.id,runId) as any;
  const messages=JSON.parse((db.prepare('SELECT messages_json FROM request_source_versions WHERE source_id=? AND version=?').get(source.id,source.version) as any).messages_json);
  recordRequestAssessment(runId,{source:sourceRow.source,fileKey:sourceRow.file_key,rootId:sourceRow.root_id,messages},copy);
  db.prepare('UPDATE assessment_attempts SET assessment_id=?,updated_at=? WHERE id=?').run(copy.id,now(),attempt.id);attempt.assessment_id=copy.id;
 });record=getAssessment(attempt.assessment_id,runId);}
 return {...record,requestSource:{id:source.id,version:source.version},attempt:attemptProjection(attempt)};
}
/** Executes exactly the prepared work; no scheduler or autonomous retry loop lives here. */
export async function executeAssessmentWork(runId:string,expected:AssessmentWorkReference,source:RequestSource,input:AssessmentInput,assertAuthorized:()=>void,infer:Infer=assess,evidence:DesignEvidenceSnapshot|null=null,participant?:PaidWorkParticipant) {
 source=structuredClone(source);input=structuredClone(input);expected=structuredClone(expected);evidence=evidence?structuredClone(evidence):null;
 currentWork(runId,expected,source,input,assertAuthorized,evidence);
 const key=runId+':'+expected.fingerprint;
 const existing=running.get(key);
 if(existing){
  // A waiter consumes nothing and never inherits the owner's authority: it revalidates its own, including after a failed owner.
  try{await existing;}catch{currentWork(runId,expected,source,input,assertAuthorized,evidence);throw new ScopedAccessError(409,'An identical in-flight assessment attempt did not complete; review its durable outcome before another paid attempt');}
  currentWork(runId,expected,source,input,assertAuthorized,evidence);const row=db.prepare("SELECT * FROM assessment_attempts WHERE run_id=? AND fingerprint=? AND outcome<>'not_dispatched'").get(runId,expected.fingerprint) as any;return projectResult(runId,row,expected.source);}
 let row=db.prepare("SELECT * FROM assessment_attempts WHERE run_id=? AND fingerprint=? AND outcome<>'not_dispatched'").get(runId,expected.fingerprint) as any;
 if(row){
  if(row.outcome==='succeeded'){currentWork(runId,expected,source,input,assertAuthorized,evidence);return projectResult(runId,row,expected.source);}
  if(row.outcome==='prepared'||row.outcome==='dispatched')db.prepare("UPDATE assessment_attempts SET outcome='uncertain',updated_at=? WHERE id=?").run(now(),row.id);
  throw new ScopedAccessError(409,`Assessment attempt is ${row.outcome==='rejected'?'rejected':'uncertain'}; review its durable outcome before another paid attempt`);
 }
 const id=randomUUID(),at=now();
 transaction(()=>{currentWork(runId,expected,source,input,assertAuthorized,evidence);requireNoUnresolvedWork(runId,expected);db.prepare("INSERT INTO assessment_attempts(id,project_id,run_id,fingerprint,logical_key,source_id,source_version,outcome,call_id,assessment_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',NULL,NULL,?,?)").run(id,input.project.id,runId,expected.fingerprint,expected.logicalKey,expected.source.id,expected.source.version,at,at);participant?.reserve(id,assessmentReservationMicroUsd());});
 let release!:()=>void;const previous=permit;permit=new Promise<void>(resolve=>release=resolve);
 const work=(async()=>{
  let dispatched=false,responseKnown=false;
  try{
   await previous;currentWork(runId,expected,source,input,assertAuthorized,evidence);
   const guard=()=>currentWork(runId,expected,source,input,assertAuthorized,evidence);
   const record=await infer(input,runId,guard,{reserved:callId=>{guard();participant?.linkCall(id,callId);db.prepare('UPDATE assessment_attempts SET call_id=?,updated_at=? WHERE id=?').run(callId,now(),id);},dispatched:()=>{guard();dispatched=true;db.prepare("UPDATE assessment_attempts SET outcome='dispatched',updated_at=? WHERE id=?").run(now(),id);},responseReceived:()=>{responseKnown=true;},settled:actual=>participant?.settle(id,actual)});
   guard();recordRequestAssessment(runId,source,record);
   db.prepare("UPDATE assessment_attempts SET outcome='succeeded',assessment_id=?,call_id=COALESCE(call_id,?),updated_at=? WHERE id=?").run(record.id,record.callId??null,now(),id);
  }catch(error){transaction(()=>{
   db.prepare('UPDATE assessment_attempts SET outcome=?,updated_at=? WHERE id=?').run(!dispatched&&participant?'not_dispatched':dispatched&&!responseKnown?'uncertain':'rejected',now(),id);
   if(!dispatched){
    // Zero dispatch is known, not an uncertain provider outcome. Count/audit remain retained.
    participant?.settle(id,0);
    const call=db.prepare('SELECT call_id FROM assessment_attempts WHERE id=?').get(id) as any;
    if(call?.call_id)db.prepare('UPDATE ai_calls SET actual_micro_usd=0,input_tokens=0,output_tokens=0,settled_at=? WHERE id=?').run(now(),call.call_id);
   }
  });throw error;}
  finally{release();}
 })();
 running.set(key,work);
 try{await work;currentWork(runId,expected,source,input,assertAuthorized,evidence);row=db.prepare('SELECT * FROM assessment_attempts WHERE id=?').get(id);return projectResult(runId,row,expected.source);}
 finally{if(running.get(key)===work)running.delete(key);}
}
export function runAssessmentWork(runId:string,source:RequestSource,input:AssessmentInput,assertAuthorized:()=>void,infer?:Infer,evidence:DesignEvidenceSnapshot|null=null,participant?:PaidWorkParticipant){
 const expected=prepareAssessmentWork(runId,source,input,assertAuthorized,evidence);
 return executeAssessmentWork(runId,expected,source,input,assertAuthorized,infer,evidence,participant);
}
