import {inboxSettings as settings,settingsAuthority,activeInboxSettings,figmaAssociationId,webhookConfigured,type InboxSettings} from './inboxAuthority.js';
export {activeInboxSettings,figmaAssociationId,webhookConfigured} from './inboxAuthority.js';
import {db,transaction,getProjectForRun} from './db.js';
import {config} from './env.js';
import {requireDesignerContext,sessionForContext,ScopedAccessError,type ActorContext} from './context.js';
import {activeGrant,credentialHash} from './judgeAccess.js';
import {activeAgentPolicy,policyAuthority,type AgentPolicy} from './agentPolicy.js';
import {fetchComments,FigmaRequestError} from './figma.js';
import {canonicalFigmaSource,acquireRequestSource,observationMark,recordMissingSource,recordSourceUnavailable,requireObservationCurrent,sourceFreshness,sourceUnavailable,requireSourceCurrent,withinCanonicalBounds,SourceUnavailableError,SourceObservationSupersededError,type RequestSource} from './requestSources.js';
import {prepareAssessmentWork,assessmentWorkOutcome,executeAssessmentWork,type AssessmentWorkReference} from './assessmentWork.js';
import {createRequest,requestById,messagesFor,now,type AgentRequest} from './agentStore.js';
import {assessmentItems} from './requestItems.js';
import {linkedOrders} from './requestLinks.js';
import {getChangeOrder} from './orders.js';
import {enqueueJob,registerJobHandler,retryFailedJob,InternalJobFailure,type Job} from './jobs.js';
import type {FigmaComment} from '../shared/types.js';

function safeSettings(runId:string){const s=settings(runId);return {version:s?.version??0,intake:s?.intake??false,autoAssess:s?.autoAssess??false,clientIds:s?.clientIds??[],maxAssessments:s?.maxAssessments??10,expiresAt:s?.expiresAt??null,authorityValid:s?settingsAuthority(runId,s):false,webhookEnabled:webhookConfigured(),automaticQuotes:false,notifications:false};}
export function getInboxSettings(ctx:ActorContext){requireDesignerContext(ctx);return safeSettings(ctx.runId);}
export function inboxRefreshDiagnostics(ctx:ActorContext){requireDesignerContext(ctx);const s=settings(ctx.runId);if(!s||!settingsAuthority(ctx.runId,s))return [];const prefix=`inbox-source-error:${ctx.runId}:`;const sources=db.prepare('SELECT key,value FROM agent_runtime WHERE substr(key,1,?)=? ORDER BY key LIMIT 50').all(prefix.length,prefix).map(row=>({id:String(row.key),kind:'thread_source',state:'unavailable',...JSON.parse(String(row.value))}));return [...sources,...db.prepare("SELECT id,state,attempts,due_at,error_category,recovery_generation FROM jobs WHERE kind='figma_refresh' AND json_valid(payload_json) AND json_extract(payload_json,'$.associationId')=? ORDER BY created_at DESC LIMIT 10").all(figmaAssociationId)];}
export function retryInboxJob(ctx:ActorContext,id:string){requireDesignerContext(ctx);const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as Job|undefined;if(!job)throw new ScopedAccessError(404,'Job not found');if(job.kind==='scope_assess')return retryFailedJob(id,ctx.projectId,ctx.runId);const s=settings(ctx.runId);if(job.kind!=='figma_refresh'||!s||!s.intake||!settingsAuthority(ctx.runId,s))throw new ScopedAccessError(403,'Inbox recovery requires current channel authority');return retryFailedJob(id);}
export function saveInboxSettings(ctx:ActorContext,input:any){requireDesignerContext(ctx);return transaction(()=>{
 const allowed=['expectedVersion','intake','autoAssess','clientIds','maxAssessments','consent'];
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!allowed.includes(k))||typeof input.intake!=='boolean'||typeof input.autoAssess!=='boolean'||input.autoAssess&&!input.intake||input.consent!==true||!Array.isArray(input.clientIds)||input.clientIds.length>20||input.clientIds.some((id:unknown)=>typeof id!=='string'||! /^[\w-]{1,100}$/.test(id))||new Set(input.clientIds).size!==input.clientIds.length||(input.intake&&!input.clientIds.length))throw new ScopedAccessError(400,'Explicit bounded inbox consent and exact author IDs required');
 const prior=settings(ctx.runId);if(input.expectedVersion!==(prior?.version??0))throw new ScopedAccessError(409,'Inbox settings version changed');
 const max=input.maxAssessments??10;if(!Number.isSafeInteger(max)||max<1||max>100)throw new ScopedAccessError(400,'Invalid assessment count limit');
 for(const other of activeInboxSettings())if(other.runId!==ctx.runId&&input.clientIds.some((id:string)=>other.clientIds.includes(id)))throw new ScopedAccessError(409,'Author belongs to another inbox run');
 for(const row of db.prepare('SELECT policy_json FROM agent_policies WHERE run_id!=?').all(ctx.runId) as {policy_json:string}[]){const p=JSON.parse(row.policy_json) as AgentPolicy;if(p.enabled&&policyAuthority(p)&&input.clientIds.some((id:string)=>p.figmaClientIds.includes(id)))throw new ScopedAccessError(409,'Author belongs to another active policy run');}
 const session=sessionForContext(ctx),grant=session.grantId?activeGrant(session.grantId):null,at=now();
 if(getProjectForRun(ctx.runId).figmaFileKey!==config.figmaFileKey)throw new ScopedAccessError(403,'Wrong configured inbox file');
 const s:InboxSettings={version:(prior?.version??0)+1,intake:input.intake,autoAssess:input.autoAssess,clientIds:[...input.clientIds],maxAssessments:max,startedAt:prior?.intake&&settingsAuthority(ctx.runId,prior)?prior.startedAt:at,expiresAt:grant?.expires_at??new Date(Date.now()+24*60*60000).toISOString(),associationId:figmaAssociationId,ownerGrantId:session.grantId,ownerSessionHash:session.grantId?null:credentialHash(session.token)};
 db.prepare('INSERT INTO inbox_settings VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET version=excluded.version,settings_json=excluded.settings_json,updated_at=excluded.updated_at').run(ctx.runId,s.version,JSON.stringify(s),at);
 db.prepare('INSERT INTO inbox_setting_history VALUES(?,?,?)').run(ctx.runId,s.version,JSON.stringify(s));
 // Existing work is never grandfathered into a changed author/channel approval.
 db.prepare("UPDATE jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,error_category='channel_changed',updated_at=? WHERE run_id=? AND kind='scope_assess' AND state IN ('pending','running')").run(at,ctx.runId);
 if(s.autoAssess)for(const row of db.prepare("SELECT r.* FROM agent_requests r JOIN request_inbox i ON i.request_id=r.id WHERE r.run_id=? AND i.execution_owner='inbox'").all(ctx.runId) as unknown as AgentRequest[])scheduleAssessment(row,s);
 return safeSettings(ctx.runId);
});}
function outgoing(c:FigmaComment){return !!db.prepare("SELECT id FROM agent_outbox WHERE kind='figma' AND provider_id=?").get(c.id)||c.message.includes('[Scope & Settle ');}
function route(root:FigmaComment){
 if(!root.userId||!root.createdAt||!Number.isFinite(Date.parse(root.createdAt))||Date.parse(root.createdAt)>Date.now()+60000||outgoing(root))return null;
 const matches=activeInboxSettings().filter(s=>s.clientIds.includes(root.userId!)&&Date.parse(root.createdAt!)>=Date.parse(s.startedAt));
 const policyRuns=new Set((db.prepare('SELECT policy_json FROM agent_policies').all() as {policy_json:string}[]).map(r=>JSON.parse(r.policy_json) as AgentPolicy).filter(p=>p.enabled&&policyAuthority(p)&&p.figmaClientIds.includes(root.userId!)).map(p=>p.runId));
 if(matches.length!==1||[...policyRuns].some(r=>r!==matches[0].runId))return null;return matches[0];
}
function readAuthority(runId:string,version:number){return ()=>{const s=settings(runId);if(!webhookConfigured()||!s||s.version!==version||!s.intake||!settingsAuthority(runId,s))throw new InternalJobFailure('channel_unavailable');};}
class ThreadProjectionError extends Error {constructor(readonly category:'source_bounds'|'request_limit'){super(category);}}
function validateThreadProjection(runId:string,resolved:ReturnType<typeof canonicalFigmaSource>){
 if(!withinCanonicalBounds(resolved.source.messages))throw new ThreadProjectionError('source_bounds');
 const existing=db.prepare("SELECT id FROM agent_requests WHERE run_id=? AND source='figma' AND source_id=?").get(runId,resolved.root.id);
 if(!existing&&Number(db.prepare('SELECT COUNT(*) n FROM agent_requests WHERE run_id=?').get(runId)?.n)>=100)throw new ThreadProjectionError('request_limit');
}
function sourceErrorKey(runId:string,rootId:string){return `inbox-source-error:${runId}:${rootId}`;}
function recordThreadUnavailable(runId:string,rootId:string,category:'source_bounds'|'request_limit',mark:number){
 requireObservationCurrent(runId,rootId,mark);
 if(category==='source_bounds')recordSourceUnavailable(runId,rootId,'source_bounds',mark);
 const value=JSON.stringify({commentId:rootId,error_category:category,observedAt:now()});
 db.prepare('INSERT INTO agent_runtime(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(sourceErrorKey(runId,rootId),value);
 db.prepare("UPDATE request_inbox SET availability='unavailable',updated_at=? WHERE run_id=? AND request_id IN(SELECT id FROM agent_requests WHERE run_id=? AND source='figma' AND source_id=?)").run(now(),runId,runId,rootId);
 // Out-of-bounds bytes of a known source are a persistent fence; a request cap is not evidence about source bytes.
}
/** Fences every known canonical root of an authorized run/file, including manually assessed roots without inbox rows. */
function observeKnownRoots(runId:string,comments:FigmaComment[],mark:number){
 const project=getProjectForRun(runId);
 for(const source of db.prepare("SELECT root_id FROM request_sources WHERE project_id=? AND run_id=? AND source='figma' AND file_key=?").all(project.id,runId,config.figmaFileKey) as {root_id:string}[]){
  const root=comments.find(c=>c.id===source.root_id);
  try{
   if(!root||root.parentId)recordSourceUnavailable(runId,source.root_id,'source_missing',mark);
   else if(!withinCanonicalBounds(canonicalFigmaSource(config.figmaFileKey,root.id,comments).source.messages))recordSourceUnavailable(runId,source.root_id,'source_bounds',mark);
  }catch(error){if(!(error instanceof SourceObservationSupersededError))throw error;}
 }
}
function projectThread(runId:string,resolved:ReturnType<typeof canonicalFigmaSource>,owner:'inbox'|'legacy',settingsVersion:number|null,mark:number){return transaction(()=>{
 validateThreadProjection(runId,resolved);
 // Trusted acquisition: may recover a latched source only if no newer unavailable observation exists.
 const reference=acquireRequestSource(runId,resolved.source,mark),previous=db.prepare('SELECT * FROM agent_requests WHERE run_id=? AND source=\'figma\' AND source_id=?').get(runId,resolved.root.id) as unknown as AgentRequest|undefined;
 const r=previous??createRequest(runId,'figma',resolved.root.id,resolved.root.message,{inboxOnly:true});
 const old=db.prepare('SELECT * FROM request_inbox WHERE request_id=?').get(r.id) as any;
 const changed=old?(old.source_version!==reference.version||old.source_id!==reference.id):!!previous&&JSON.stringify(messagesFor(r.id,runId).filter(m=>m.actor==='client').map(m=>({id:m.source_id??m.id,message:m.body})))!==JSON.stringify(resolved.source.messages);
 const metadata={root:resolved.root,replies:resolved.replies,observedAt:now()};
 if(changed){db.prepare('UPDATE agent_requests SET text=?,version=version+1,assessment_id=NULL,updated_at=? WHERE id=?').run(resolved.root.message,now(),r.id);
  // Preserve decisions and existing proposal links while surfacing new unresolved work.
  const policy=activeAgentPolicy(runId),authorized=policy&&!!resolved.root.userId&&policy.figmaClientIds.includes(resolved.root.userId)&&!!resolved.root.createdAt&&Date.parse(resolved.root.createdAt)>=Date.parse(policy.startedAt);
  const clientChanged=authorized&&JSON.stringify([resolved.root,...resolved.replies].filter(c=>!outgoing(c)&&policy!.figmaClientIds.includes(c.userId??'')).map(c=>({id:c.id,message:c.message})))!==JSON.stringify(messagesFor(r.id,runId).filter(m=>m.actor==='client').map(m=>({id:m.source_id??m.id,message:m.body})));
  if((old?.execution_owner??owner)==='legacy'&&clientChanged&&!r.order_id&&!['included','dismissed'].includes(r.state))db.prepare("UPDATE agent_requests SET state='queued' WHERE id=?").run(r.id);
 }
 const clients=(old?.execution_owner??(previous?'legacy':owner))==='legacy'?activeAgentPolicy(runId)?.figmaClientIds??[]:settings(runId)?.clientIds??[resolved.root.userId];
 for(const comment of [resolved.root,...resolved.replies]){const actor=outgoing(comment)?'agent':clients.includes(comment.userId??'')?'client':'designer';db.prepare('UPDATE agent_messages SET body=?,actor=? WHERE run_id=? AND request_id=? AND source_id=?').run(comment.message,actor,runId,r.id,comment.id);if(!db.prepare('SELECT id FROM agent_messages WHERE run_id=? AND source_id=?').get(runId,comment.id))db.prepare('INSERT INTO agent_messages(id,run_id,request_id,actor,body,source_id,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),runId,r.id,actor,comment.message,comment.id,now());}
 db.prepare('INSERT INTO request_inbox VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET source_id=excluded.source_id,source_version=excluded.source_version,metadata_json=excluded.metadata_json,availability=excluded.availability,settings_version=excluded.settings_version,updated_at=excluded.updated_at').run(r.id,runId,reference.id,reference.version,JSON.stringify(metadata),resolved.root.resolvedAt?'resolved':'available',old?.execution_owner??(previous?'legacy':owner),settingsVersion,now());
 db.prepare('DELETE FROM agent_runtime WHERE key=?').run(sourceErrorKey(runId,resolved.root.id));
 return requestById(r.id,runId)!;
});}
export async function refreshRequestThread(ctx:ActorContext,commentId:string){
 requireDesignerContext(ctx);if(typeof commentId!=='string'||!commentId||commentId.length>200)throw new ScopedAccessError(400,'Comment ID required');
 const project=getProjectForRun(ctx.runId),mark=observationMark(),comments=await fetchComments(project.figmaFileKey);requireDesignerContext(ctx);
 let resolved;try{resolved=canonicalFigmaSource(project.figmaFileKey,commentId,comments);}catch(error){recordMissingSource(ctx.runId,commentId,comments,mark);db.prepare("UPDATE request_inbox SET availability='unavailable',updated_at=? WHERE run_id=? AND request_id IN(SELECT id FROM agent_requests WHERE run_id=? AND source='figma' AND source_id=?)").run(now(),ctx.runId,ctx.runId,commentId);throw error;}
 // The fence is committed outside the rejected projection transaction before the rejection propagates.
 try{projectThread(ctx.runId,resolved,'inbox',null,mark);}
 catch(error){if(error instanceof ThreadProjectionError&&error.category==='source_bounds'){recordThreadUnavailable(ctx.runId,resolved.root.id,'source_bounds',mark);throw new ScopedAccessError(400,'Invalid request source: the authoritative thread exceeds canonical bounds');}throw error;}
 return listRequestInbox(ctx).find(r=>r.rootId===resolved.root.id)!;
}
export function listRequestInbox(ctx:ActorContext,filter?:string){requireDesignerContext(ctx);
 const stages=['unreviewed','needs_clarification','ready_for_review','linked_to_change_order'];if(filter&&!stages.includes(filter)&&filter!=='recovery')throw new ScopedAccessError(400,'Unknown inbox filter');
 return (db.prepare('SELECT * FROM agent_requests WHERE run_id=? ORDER BY updated_at DESC,id').all(ctx.runId) as unknown as AgentRequest[]).map(r=>{
  const row=db.prepare('SELECT * FROM request_inbox WHERE request_id=?').get(r.id) as any,meta=row?JSON.parse(row.metadata_json):null;
  const source=(row?db.prepare('SELECT * FROM request_sources WHERE id=? AND run_id=?').get(row.source_id,ctx.runId):db.prepare('SELECT * FROM request_sources WHERE run_id=? AND source=? AND root_id=?').get(ctx.runId,r.source,r.source_id)) as any;
  const items=r.assessment_id?assessmentItems(r.assessment_id,r.run_id):[],orders=linkedOrders(r);
  const assessed=r.assessment_id?db.prepare('SELECT source_version FROM request_item_results WHERE assessment_id=? AND source_id=? LIMIT 1').get(r.assessment_id,source?.id??'') as any:null;
  const current=!!assessed&&assessed.source_version===(row?.source_version??source?.version);
  const unresolved=items.filter(i=>!i.reservationState&&i.duplicateDecision!=='same_commitment'&&i.classification!=='included');
  const stage=!current?'unreviewed':items.some(i=>i.classification==='needs_clarification'||i.questions.length)?'needs_clarification':orders.length&&!unresolved.length?'linked_to_change_order':'ready_for_review';
  const latest=db.prepare("SELECT id,kind,state,error_category,payload_json FROM jobs WHERE run_id=? AND kind='scope_assess' AND json_valid(payload_json) AND json_extract(payload_json,'$.requestId')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(r.run_id,r.id) as any;
  const work=latest?JSON.parse(latest.payload_json).work:null;
  const status=work&&typeof work.fingerprint==='string'?assessmentWorkOutcome(r.run_id,work,()=>requireDesignerContext(ctx)):null;
  const attempt=status?.attempt?{...status.attempt,outcome:status.state==='in_progress'?status.attempt.outcome:status.state}:null;
  const job=latest?{id:latest.id,kind:latest.kind,state:latest.state,error_category:latest.error_category}:null;
  return {id:r.id,requestVersion:r.version,sourceKind:r.source,rootId:r.source_id,text:r.text,stage,source:source?{id:source.id,version:source.version,contentHash:source.content_hash}:null,availability:source&&sourceUnavailable(source.id)?'unavailable':row?.availability??(r.source==='portal'?'available':'not_refreshed'),execution:{state:r.state,owner:row?.execution_owner??'legacy',job,attempt:attempt??null,error:r.exception??r.delivery_exception},unresolvedItems:unresolved.length,assessmentId:r.assessment_id,orders:orders.map(link=>{const order=getChangeOrder(link.order_id);return {...link,approvalState:order&&order.approvalStatus!=='approved'&&String(order.status)==='cancelled'?'abandoned':order?.approvalStatus??'unavailable',financialState:order?.financialState?.paymentState??'not_started'};}),messages:meta?[meta.root,...meta.replies].map((m:FigmaComment)=>({id:m.id,message:m.message,userId:m.userId,createdAt:m.createdAt,parentId:m.parentId,resolvedAt:m.resolvedAt})):messagesFor(r.id,r.run_id).map(m=>({id:m.source_id??m.id,message:m.body})),observedAt:meta?.observedAt??null};
 }).filter(r=>!filter||(filter==='recovery'?(r.availability!=='available'||r.execution.job?.state==='failed'||!!r.execution.error):r.stage===filter));
}
interface AssessPayload {version:1;requestId:string;settingsVersion:number;requestVersion:number;work:AssessmentWorkReference}
function sourceFor(r:AgentRequest):RequestSource{const row=db.prepare('SELECT source_id,source_version FROM request_inbox WHERE request_id=? AND run_id=?').get(r.id,r.run_id) as any;const v=row&&db.prepare('SELECT messages_json FROM request_source_versions WHERE source_id=? AND version=?').get(row.source_id,row.source_version) as any;if(!v)throw new InternalJobFailure('source_unavailable');return {source:'figma',fileKey:getProjectForRun(r.run_id).figmaFileKey,rootId:r.source_id,messages:JSON.parse(v.messages_json)};}
function assessmentAuthority(r:AgentRequest,s:InboxSettings,guard:()=>void=()=>{}){return ()=>{
 guard();const live=settings(r.run_id),fresh=requestById(r.id,r.run_id),row=db.prepare('SELECT * FROM request_inbox WHERE request_id=?').get(r.id) as any;
 if(!webhookConfigured()||!live||live.version!==s.version||!live.intake||!live.autoAssess||!settingsAuthority(r.run_id,live)||!fresh||fresh.version!==r.version||fresh.state==='dismissed'||row?.execution_owner!=='inbox'||row.availability!=='available'||sourceUnavailable(row.source_id))throw new InternalJobFailure('assessment_authority_changed');
 const root=JSON.parse(row.metadata_json).root as FigmaComment,selected=route(root);if(!selected||selected.runId!==r.run_id||selected.version!==s.version)throw new InternalJobFailure('author_route_changed');
};}
async function refreshScheduledSource(r:AgentRequest,s:InboxSettings,auth:()=>void,expected:AssessmentWorkReference){
 auth();const mark=observationMark(),comments=await fetchComments(getProjectForRun(r.run_id).figmaFileKey);auth();
 let resolved;try{resolved=canonicalFigmaSource(config.figmaFileKey,r.source_id,comments);}catch(error){recordMissingSource(r.run_id,r.source_id,comments,mark);throw error;}
 const selected=route(resolved.root);
 if(!selected||selected.runId!==r.run_id||selected.version!==s.version)throw new InternalJobFailure('author_route_changed');
 try{projectThread(r.run_id,resolved,'inbox',s.version,mark);}catch(error){if(error instanceof ThreadProjectionError&&error.category==='source_bounds')recordThreadUnavailable(r.run_id,resolved.root.id,'source_bounds',mark);throw error;}
 requireSourceCurrent(r.run_id,expected.source);auth();
 return resolved.source;
}
function scheduleAssessment(r:AgentRequest,s:InboxSettings){
 if(!s.autoAssess||!settingsAuthority(r.run_id,s))return;
 const row=db.prepare('SELECT * FROM request_inbox WHERE request_id=?').get(r.id) as any;if(row?.execution_owner!=='inbox'||row.availability!=='available')return;
 // A fenced source never schedules paid work, and no automatic paid assessment follows recovery:
 // the recovered version waits for an explicit designer reassessment (a later changed version may auto-assess).
 const fence=sourceFreshness(row.source_id);if(fence&&(fence.state==='unavailable'||fence.recovered_version===row.source_version))return;
 const auth=assessmentAuthority(r,s);try{auth();}catch{return;}
 const source=sourceFor(r),input={project:getProjectForRun(r.run_id),comment:source.messages[0],replies:source.messages.slice(1),automation:true,itemized:true};
 const work=prepareAssessmentWork(r.run_id,source,input,auth),outcome=assessmentWorkOutcome(r.run_id,work,auth);
 if(['rejected','uncertain'].includes(outcome.state)){db.prepare('UPDATE agent_requests SET exception=? WHERE id=?').run(`Paid assessment outcome is ${outcome.state}; automatic retry is unavailable. Review the durable attempt.`,r.id);return;}
 const p:AssessPayload={version:1,requestId:r.id,settingsVersion:s.version,requestVersion:r.version,work};
 enqueueJob({key:`inbox:assess:${r.run_id}:${work.fingerprint}:settings:${s.version}`,kind:'scope_assess',projectId:input.project.id,runId:r.run_id,payload:p,dueAt:now()});
}
export async function refreshInboxFile(associationId:string,generation:number,guard:()=>void){
 guard();if(associationId!==figmaAssociationId||!webhookConfigured())throw new InternalJobFailure('association_unavailable');
 const accepted=activeInboxSettings();if(!accepted.length)throw new InternalJobFailure('channel_unavailable');
 const mark=observationMark();
 let comments:FigmaComment[];try{comments=await fetchComments(config.figmaFileKey);}catch(e){if(e instanceof FigmaRequestError)throw new InternalJobFailure('figma_unavailable',[429,500,502,503,504].includes(e.status),Date.now()+e.retryAfterSeconds*1000);throw new InternalJobFailure('figma_transport',true);}
 guard();if(!webhookConfigured()||associationId!==figmaAssociationId)throw new InternalJobFailure('association_unavailable');
 let missing=false;
 transaction(()=>{
  guard();const receipts=db.prepare("SELECT * FROM figma_event_receipts WHERE association_id=? AND generation<=? AND state='queued'").all(associationId,generation) as any[];
  for(const receipt of receipts){const chosen=comments.find(c=>c.id===receipt.comment_id);if(!chosen){missing=true;continue;}
   if(outgoing(chosen)){db.prepare("UPDATE figma_event_receipts SET state='ignored' WHERE id=?").run(receipt.id);continue;}
   let resolved;try{resolved=canonicalFigmaSource(config.figmaFileKey,chosen.id,comments);}catch{missing=true;continue;}
   const s=route(resolved.root);if(!s){db.prepare("UPDATE figma_event_receipts SET state='unroutable' WHERE id=?").run(receipt.id);continue;}
   // Consent/mapping snapshots accepted before the await cannot authorize a replacement run afterwards.
   if(!accepted.some(before=>before.runId===s.runId&&before.version===s.version)){db.prepare("UPDATE figma_event_receipts SET state='channel_changed' WHERE id=?").run(receipt.id);continue;}
   try{transaction(()=>{
    readAuthority(s.runId,s.version)();const r=projectThread(s.runId,resolved,'inbox',s.version,mark);scheduleAssessment(r,s);
    db.prepare("UPDATE figma_event_receipts SET state='refreshed' WHERE id=?").run(receipt.id);
   });}catch(error){
    // A newer unavailable observation during this read keeps that one source fenced; peers still commit.
    if(error instanceof SourceUnavailableError){db.prepare("UPDATE figma_event_receipts SET state='source_unavailable' WHERE id=?").run(receipt.id);continue;}
    if(error instanceof SourceObservationSupersededError){db.prepare("UPDATE figma_event_receipts SET state='source_superseded' WHERE id=?").run(receipt.id);continue;}
    if(!(error instanceof ThreadProjectionError))throw error;
    // Only known source bounds/cap failures are local to a thread. Real storage and authority failures still abort.
    try{recordThreadUnavailable(s.runId,resolved.root.id,error.category,mark);}catch(stale){if(!(stale instanceof SourceObservationSupersededError))throw stale;db.prepare("UPDATE figma_event_receipts SET state='source_superseded' WHERE id=?").run(receipt.id);continue;}
    db.prepare('UPDATE figma_event_receipts SET state=? WHERE id=?').run(error.category,receipt.id);
   }
  }
  for(const s of activeInboxSettings())if(accepted.some(before=>before.runId===s.runId&&before.version===s.version))observeKnownRoots(s.runId,comments,mark);
  for(const row of db.prepare('SELECT i.*,r.source_id root_id FROM request_inbox i JOIN agent_requests r ON r.id=i.request_id').all() as any[]){if(!activeInboxSettings().some(s=>s.runId===row.run_id))continue;try{requireObservationCurrent(row.run_id,row.root_id,mark);}catch(error){if(error instanceof SourceObservationSupersededError)continue;throw error;}const root=comments.find(c=>c.id===row.root_id),limited=!!db.prepare('SELECT key FROM agent_runtime WHERE key=?').get(sourceErrorKey(row.run_id,row.root_id));db.prepare('UPDATE request_inbox SET availability=?,updated_at=? WHERE request_id=?').run(!root||limited||sourceUnavailable(row.source_id)?'unavailable':root.resolvedAt?'resolved':'available',now(),row.request_id);}
  if(!missing)db.prepare('UPDATE figma_refresh_state SET completed_generation=MAX(completed_generation,?),updated_at=? WHERE association_id=?').run(generation,now(),associationId);
 });
 if(missing)throw new InternalJobFailure('comment_unavailable',true);
}
function validateAssessmentJob(p:any){
 const fields=(value:any,names:string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>names.includes(k));
 const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
 const w=p?.work,s=w?.source,i=w?.inference;
 const valid=fields(p,['version','requestId','settingsVersion','requestVersion','work'])&&p.version===1&&typeof p.requestId==='string'&&!!p.requestId.trim()&&p.requestId.length<=200&&positive(p.settingsVersion)&&positive(p.requestVersion)&&
  fields(w,['fingerprint','source','contextFingerprint','evidenceHash','inference'])&&hash(w.fingerprint)&&hash(w.contextFingerprint)&&w.evidenceHash===null&&
  fields(s,['id','version','contentHash'])&&typeof s.id==='string'&&!!s.id&&s.id.length<=200&&positive(s.version)&&hash(s.contentHash)&&
  fields(i,['provider','model','reasoning','promptVersion','promptImplementation','schema','temperature','maxOutputTokens','contextTokens','baseUrl','mode','itemized'])&&
  ['provider','model','reasoning','promptVersion','baseUrl'].every(k=>typeof i[k]==='string'&&!!i[k]&&i[k].length<=256)&&hash(i.promptImplementation)&&hash(i.schema)&&Number.isFinite(i.temperature)&&positive(i.maxOutputTokens)&&positive(i.contextTokens)&&i.mode==='automatic'&&i.itemized===true;
 if(!valid||JSON.stringify(p).length>10000)throw new Error('Invalid assessment job payload');
}
registerJobHandler('scope_assess',{
 validate:validateAssessmentJob,
 resource:p=>p.work.fingerprint,
 retry(job,p){const r=requestById(p.requestId,job.run_id),s=settings(job.run_id);if(!r||!s||r.version!==p.requestVersion||s.version!==p.settingsVersion||getProjectForRun(job.run_id).id!==job.project_id)throw new Error('Request or consent changed');const auth=assessmentAuthority(r,s);auth();const source=sourceFor(r),input={project:getProjectForRun(r.run_id),comment:source.messages[0],replies:source.messages.slice(1),automation:true,itemized:true};if(prepareAssessmentWork(job.run_id,source,input,auth).fingerprint!==p.work.fingerprint)throw new Error('Assessment work was superseded');const outcome=assessmentWorkOutcome(job.run_id,p.work,auth);if(!outcome.newAttemptPermitted&&outcome.state!=='succeeded')throw new Error('Paid attempt is terminal or already started; review required');},
 async execute(job,p:AssessPayload,guard){
  const r=requestById(p.requestId,job.run_id),s=settings(job.run_id);if(!r||!s||s.version!==p.settingsVersion||r.version!==p.requestVersion||getProjectForRun(job.run_id).id!==job.project_id)throw new InternalJobFailure('assessment_superseded');
  const auth=assessmentAuthority(r,s,guard),source=await refreshScheduledSource(r,s,auth,p.work),input={project:getProjectForRun(r.run_id),comment:source.messages[0],replies:source.messages.slice(1),automation:true,itemized:true};auth();requireSourceCurrent(job.run_id,p.work.source);
  const fresh=prepareAssessmentWork(job.run_id,source,input,auth);if(fresh.fingerprint!==p.work.fingerprint)throw new InternalJobFailure('assessment_superseded');
  const outcome=assessmentWorkOutcome(job.run_id,p.work,auth);if(['rejected','uncertain'].includes(outcome.state))throw new InternalJobFailure('assessment_terminal');
  if(outcome.state==='not_started'&&Number(db.prepare('SELECT COUNT(*) n FROM assessment_attempts WHERE run_id=?').get(job.run_id)?.n)>=s.maxAssessments)throw new InternalJobFailure('assessment_limit');
  const record=await executeAssessmentWork(job.run_id,p.work,source,input,auth);auth();await refreshScheduledSource(r,s,auth,p.work);auth();
  transaction(()=>{auth();db.prepare("UPDATE agent_requests SET assessment_id=?,state=CASE WHEN state IN ('quoted','paid','included','dismissed') THEN state ELSE 'assessed' END,exception=NULL,updated_at=? WHERE id=?").run(record.id,now(),r.id);});
 }
});
