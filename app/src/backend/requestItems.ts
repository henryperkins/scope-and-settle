import {randomUUID} from 'node:crypto';
import {db,getProjectForRun,transaction,assertRunActive} from './db.js';
import {requireDesignerContext,requireOperationContext,ScopedAccessError,type ServiceContext} from './context.js';
import {scopeContextForRun,contextCurrent,linkedScopeContext} from './scopeLedger.js';
import {contentHash} from './scopePersistence.js';
import {type AssessmentResult} from './assessment.js';
import {captureRequestSource as sourceVersion,refreshFigmaSource,requireSourceCurrent,requireAssessedSourceCurrent,type RequestSource,type RequestSourceReference} from './requestSources.js';
import {runAssessmentWork,type PaidWorkParticipant} from './assessmentWork.js';
import {reserveConnectorAttempt,linkConnectorCall,settleConnectorAttempt} from './connectorStore.js';
import {projectAssessment,projectDraft,type AssessmentProjection,type DraftProjection} from './connectorProjections.js';
import {evidenceForAssessment} from './designEvidence.js';
import {createChangeOrder,getChangeOrder} from './orders.js';
import {requestById,messagesFor} from './agentStore.js';
import {activeAgentPolicy,policyAuthority,type AgentPolicy} from './agentPolicy.js';
import type {ActorContext,ProjectView,ScopeContext,AssessmentItem,ProposalReservation,ItemReviewReference} from '../shared/types.js';
const now=()=>new Date().toISOString();
const normalize=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const bounded=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=4000;
const only=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function validateItemizedAssessment(raw:any,project:ProjectView,scope:ScopeContext,texts:string[]):AssessmentResult & {items:AssessmentItem[]} {
 if(!only(raw,['items','explanation','designObservations','automation'])||!bounded(raw.explanation)||!Array.isArray(raw.items)||raw.items.length<1||raw.items.length>20)throw new Error('Invalid per-item assessment fields');
 if(raw.automation){const a=raw.automation;if(!only(a,['allRequestsCovered','unpricedComponents','coverage'])||typeof a.allRequestsCovered!=='boolean'||!Array.isArray(a.unpricedComponents)||a.unpricedComponents.length>20||a.unpricedComponents.some((x:any)=>!bounded(x))||!Array.isArray(a.coverage)||a.coverage.length>20||a.coverage.some((c:any)=>!only(c,['requestQuote','deliverableIndex','rateCardId','quantity'])||!bounded(c.requestQuote)||!bounded(c.rateCardId)||!Number.isSafeInteger(c.deliverableIndex)||c.deliverableIndex<0||!Number.isSafeInteger(c.quantity)||c.quantity<1))throw new Error('Invalid automatic item coverage');}
 if(!Array.isArray(raw.designObservations)||raw.designObservations.length>20||raw.designObservations.some((x:any)=>!bounded(x)))throw new Error('Invalid design observations');
 const seen=new Set<string>();
 const items:AssessmentItem[]=raw.items.map((p:any)=>{
  if(!only(p,['requestedDeliverable','requestQuote','classification','evidence','rates','questions','existingCommitment'])||!bounded(p.requestedDeliverable)||!bounded(p.requestQuote)||!texts.some(t=>t.includes(p.requestQuote))||!normalize(p.requestQuote)||seen.has(normalize(p.requestQuote)))throw new Error('Invalid or repeated item request quote/fields');
  seen.add(normalize(p.requestQuote));
  if(!['included','new_work','needs_clarification'].includes(p.classification)||!Array.isArray(p.evidence)||p.evidence.length>20||!Array.isArray(p.rates)||p.rates.length>20||!Array.isArray(p.questions)||p.questions.length>20||p.questions.some((q:any)=>!bounded(q)))throw new Error('Invalid item classification/evidence/rates');
  for(const e of p.evidence){
   if(e.kind==='scope_clause') {const c=scope.scopeSnapshot.clauses.find(c=>c.id===e.clauseId);if(!only(e,['kind','snapshotId','clauseId','quote'])||e.snapshotId!==scope.scopeSnapshot.id||!c||!bounded(e.quote)||!c.text.includes(e.quote))throw new Error('Invalid immutable clause evidence quote');}
   else if(e.kind==='approved_change'){const c=scope.commitments.find(c=>c.resourceId===e.resourceId&&c.revision===e.revision);const terms=c?.terms as any;const strings=[terms?.title,...(terms?.deliverables??[]),...(terms?.lineItems??[]).map((i:any)=>i.description)];if(!only(e,['kind','resourceId','revision','quote'])||!c||!bounded(e.quote)||!strings.some(t=>typeof t==='string'&&t.includes(e.quote)))throw new Error('Invalid approved commitment evidence quote');}
   else throw new Error('Invalid item evidence kind');
  }
  if(p.classification!=='needs_clarification'&&!p.evidence.length)throw new Error('Decisive items require agreement evidence');
  if(p.classification==='needs_clarification'&&!p.questions.length)throw new Error('Ambiguous item requires questions');
  if(p.classification!=='new_work'&&p.rates.length)throw new Error('Included or ambiguous items cannot have charges');
  if(p.existingCommitment!==null&&p.existingCommitment!==undefined&&(!only(p.existingCommitment,['resourceId','revision'])||!scope.commitments.some(c=>c.resourceId===p.existingCommitment.resourceId&&c.revision===p.existingCommitment.revision)))throw new Error('Unknown immutable commitment reference');
  const lineItems=p.rates.map((r:any)=>{const rate=scope.rateSnapshot.entries.find(x=>x.id===r.rateCardId);if(!only(r,['rateCardId','quantity'])||!rate||!Number.isSafeInteger(r.quantity)||r.quantity<1||r.quantity>100)throw new Error('Invalid item rate reference/amount fields');return {rateCardId:rate.id,quantity:r.quantity,description:rate.description,unitAmountMinor:rate.unitAmountMinor,priceSource:'rate_card' as const};});
  return {...p,id:'',existingCommitment:p.existingCommitment??null,lineageItemIds:[],lineItems,proposedTotalMinor:lineItems.reduce((s:number,i:any)=>s+i.quantity*i.unitAmountMinor,0)};
 });
 const allNew=items.every(x=>x.classification==='new_work'),allIncluded=items.every(x=>x.classification==='included');
 return {items,classification:allNew?'new_work':allIncluded?'included':'needs_clarification',explanation:raw.explanation,evidence:items.flatMap(x=>x.evidence.filter(e=>e.kind==='scope_clause').map(e=>({clauseId:(e as any).clauseId,quote:e.quote}))),deliverables:items.filter(x=>x.classification==='new_work').map(x=>x.requestedDeliverable),rates:items.flatMap(x=>x.rates),questions:items.flatMap(x=>x.questions),designObservations:raw.designObservations,lineItems:items.flatMap(x=>x.lineItems),proposedTotalMinor:items.reduce((s,x)=>s+x.proposedTotalMinor,0),...(raw.automation?{automation:raw.automation}:{})};
}
// Trusted internal persistence entry: callers already own source acquisition and authority.
export function recordRequestAssessment(runId:string,source:RequestSource,record:any){return transaction(()=>{
 const scope=scopeContextForRun(runId),ref=linkedScopeContext('assessment',record.id);if(!ref||!contextCurrent(ref,runId))throw new Error('Assessment context is stale');
 const src=sourceVersion(runId,source);
 const sourceKey=contentHash(source.messages.map(m=>normalize(m.message)));
 const previous=(db.prepare(`SELECT DISTINCT r.item_id,r.source_id,v.messages_json FROM request_item_results r JOIN proposal_item_reservations p ON p.item_id=r.item_id AND p.assessment_id=r.assessment_id JOIN request_sources s ON s.id=r.source_id JOIN request_source_versions v ON v.source_id=r.source_id AND v.version=r.source_version WHERE s.project_id=? AND s.run_id=? AND p.state IN ('reserved','committed')`).all(scope.scopeSnapshot.projectId,runId) as any[]).filter(p=>p.source_id===src.id||contentHash(JSON.parse(p.messages_json).map((m:any)=>normalize(m.message)))===sourceKey);
 const exactSourceDuplicate=previous.some(p=>p.source_id!==src.id);

 let parts=record.result.items as AssessmentItem[]|undefined;
 // Compatibility for trusted pre-v4 stored assessments and synthetic worker adapters.
 // Production itemized inference is separately schema-validated before reaching here.
 if(!parts){const p=getProjectForRun(runId),legacy=record.result;const quote=source.messages.map(m=>m.message).join('\n');parts=[{id:'',requestedDeliverable:quote,requestQuote:quote,classification:legacy.classification,evidence:legacy.evidence.map((e:any)=>({kind:'scope_clause',snapshotId:scope.scopeSnapshot.id,...e})),rates:legacy.rates,questions:legacy.questions,existingCommitment:null,lineageItemIds:[],lineItems:legacy.rates.map((r:any)=>{const rate=p.rateCard.find(x=>x.id===r.rateCardId);if(!rate)throw new Error('Unknown item rate');return {...rate,rateCardId:rate.id,quantity:r.quantity,priceSource:'rate_card'};}),proposedTotalMinor:0}];}
 const resultItems=parts.map(p=>{
  const key=contentHash(normalize(p.requestQuote)),existing=db.prepare('SELECT id FROM request_items WHERE project_id=? AND run_id=? AND exact_key=?').get(scope.scopeSnapshot.projectId,runId,key) as any;
  const id=existing?.id??randomUUID();if(!existing)db.prepare('INSERT INTO request_items VALUES(?,?,?,?,?)').run(id,scope.scopeSnapshot.projectId,runId,key,now());
  const prior=existing?latest(id,runId):null;
  const priorLineage: string[] = prior ? JSON.parse(prior.result_json).lineageItemIds ?? [] : [];
  const lineage = [...new Set([...priorLineage, ...previous.map(r => r.item_id)])].filter(predecessor => predecessor !== id);
  // A conservative local candidate scan supplements model suggestions; never an automatic semantic verdict.
  let candidate=p.existingCommitment;
  const approved=p.evidence.find(e=>e.kind==='approved_change');if(!candidate&&approved?.kind==='approved_change')candidate={resourceId:approved.resourceId,revision:approved.revision};
  if(!candidate){const words=new Set(normalize(p.requestedDeliverable).split(' ').filter(w=>w.length>3));const found=scope.commitments.find(c=>{const t=c.terms as any;const terms=normalize([t.title,...(t.deliverables??[])].join(' '));return [...words].filter(w=>terms.includes(w)).length>=2;});if(found)candidate={resourceId:found.resourceId,revision:found.revision};}
  const exact=scope.commitments.find(c=>((c.terms as any)?.deliverables??[]).some((d:string)=>normalize(d)===normalize(p.requestedDeliverable)||normalize(d)===normalize(p.requestQuote)));
  if(exact)candidate={resourceId:exact.resourceId,revision:exact.revision};
  const item={...p,id,exactSourceDuplicate,exactCommitment:!!exact,existingCommitment:candidate,lineageItemIds:lineage,proposedTotalMinor:p.lineItems.reduce((s,i)=>s+i.quantity*i.unitAmountMinor,0)};
  db.prepare('INSERT OR IGNORE INTO request_item_results VALUES(?,?,?,?,?,?,?)').run(id,record.id,src.id,src.version,JSON.stringify(item),scope.contextFingerprint,now());
  return item;
 });
 const projected=assessmentItems(record.id,runId);return {...record,items:projected,requestSource:{id:src.id,version:src.version},result:{...record.result,items:projected}};
});}
export async function assessRequest(ctx:ActorContext,input:{commentId:string;evidenceSnapshotId?:string},assertRequest?:()=>void){
 requireDesignerContext(ctx);
 if(!only(input,['commentId','evidenceSnapshotId'])||!bounded(input.commentId)||(input.evidenceSnapshotId!==undefined&&!bounded(input.evidenceSnapshotId)))throw new ScopedAccessError(400,'Only authoritative comment and verified snapshot IDs are supported');
 return assessComment(ctx.runId,input,()=>requireDesignerContext(ctx),{assertRequest});
}
/**
 * The one authoritative-comment assessment path. `admit` re-checks the caller's private authority at every
 * await, limiter and dispatch boundary; an optional trusted participant joins only a new durable attempt.
 */
async function assessComment(runId:string,input:{commentId:string;evidenceSnapshotId?:string},admit:()=>void,options:{assertRequest?:()=>void;participant?:PaidWorkParticipant;expectedSource?:RequestSourceReference}={}){
 admit();
 const assertRequest=options.assertRequest;
 let request=requestById(String(db.prepare("SELECT id FROM agent_requests WHERE run_id=? AND source='figma' AND source_id=?").get(runId,input.commentId)?.id??''),runId);
 const validate=()=>{admit();assertRequest?.();if(request){const fresh=requestById(request.id,runId);if(!fresh||fresh.version!==request.version||fresh.source!=='figma'||fresh.source_id!==request.source_id)throw new ScopedAccessError(409,'Request changed during assessment');}};
 const resolved=await refreshFigmaSource(runId,input.commentId,validate);validate();
 if(options.expectedSource&&(['id','version','contentHash'] as const).some(key=>options.expectedSource![key]!==resolved.reference[key]))throw new ScopedAccessError(409,'Displayed source does not match the selected request thread');
 // A selected reply resolves to its real root. No request is created by manual assessment.
 if(!request){const row=db.prepare("SELECT id FROM agent_requests WHERE run_id=? AND source='figma' AND source_id=?").get(runId,resolved.root.id);if(row)request=requestById(String(row.id),runId);}
 validate();
 const visual=input.evidenceSnapshotId?evidenceForAssessment(runId,input.evidenceSnapshotId,resolved.reference,resolved.root.nodeId??null):null;
 const result=await runAssessmentWork(runId,resolved.source,{project:getProjectForRun(runId),comment:resolved.root,replies:resolved.replies,itemized:true,...(visual?{designContext:visual.designContext,imageDataUrl:visual.imageDataUrl,evidenceSnapshotId:visual.snapshot.id}:{})},validate,undefined,visual?.snapshot??null,options.participant);
 const latest=await refreshFigmaSource(runId,input.commentId,validate);validate();
 if(latest.reference.id!==resolved.reference.id||latest.reference.version!==resolved.reference.version||latest.reference.contentHash!==resolved.reference.contentHash||(visual&&(latest.root.nodeId??null)!==visual.snapshot.anchorNodeId))throw new ScopedAccessError(409,'Request or comment anchor changed while assessing; capture again');
 if(request)transaction(()=>{
  validate();requireSourceCurrent(runId,resolved.reference);
  if(!db.prepare('SELECT item_id FROM request_item_results WHERE assessment_id=? AND source_id=? AND source_version=? LIMIT 1').get(result.id,resolved.reference.id,resolved.reference.version))throw new ScopedAccessError(409,'Assessment does not match the current request source');
  const inbox=db.prepare('SELECT source_id,source_version FROM request_inbox WHERE request_id=? AND run_id=?').get(request!.id,runId),changed=!!inbox&&(inbox.source_id!==resolved.reference.id||inbox.source_version!==resolved.reference.version);
  db.prepare("UPDATE agent_requests SET assessment_id=?,version=version+?,state=CASE WHEN state='idle' THEN 'assessed' ELSE state END,updated_at=? WHERE id=? AND run_id=? AND version=?").run(result.id,changed?1:0,now(),request!.id,runId,request!.version);
  if(inbox){db.prepare('UPDATE request_inbox SET source_id=?,source_version=?,metadata_json=?,availability=?,updated_at=? WHERE request_id=? AND run_id=?').run(resolved.reference.id,resolved.reference.version,JSON.stringify({root:latest.root,replies:latest.replies,observedAt:latest.observedAt}),latest.root.resolvedAt?'resolved':'available',now(),request!.id,runId);db.prepare('DELETE FROM agent_runtime WHERE key=?').run(`inbox-source-error:${runId}:${resolved.root.id}`);}
 });
 return result;
}
export async function assessStoredRequest(ctx:ActorContext,requestId:string){
 requireDesignerContext(ctx);const r=requestById(requestId,ctx.runId);if(!r)throw new Error('Request not found');
 if(r.source==='figma')return assessRequest(ctx,{commentId:r.source_id},()=>{requireDesignerContext(ctx);const fresh=requestById(r.id,ctx.runId);if(!fresh||fresh.version!==r.version||fresh.source!==r.source||fresh.source_id!==r.source_id)throw new ScopedAccessError(409,'Request changed during assessment');});
 const messages=messagesFor(r.id,r.run_id).filter(m=>m.actor==='client').map(m=>({id:m.source_id??m.id,message:m.body}));
 const source:RequestSource={source:r.source,rootId:r.source_id,fileKey:'',messages};
 const validate=()=>{requireDesignerContext(ctx);const fresh=requestById(requestId,ctx.runId);if(!fresh||fresh.version!==r.version)throw new ScopedAccessError(409,'Request changed during assessment');};
 const result=await runAssessmentWork(ctx.runId,source,{project:getProjectForRun(ctx.runId),comment:messages[0],replies:messages.slice(1),itemized:true},validate);
 validate();db.prepare('UPDATE agent_requests SET assessment_id=? WHERE id=?').run(result.id,r.id);return result;
}
function activeBindings(runId: string) {
  return db.prepare(`SELECT r.*, p.order_id, s.run_id, v.messages_json
    FROM proposal_item_reservations p
    JOIN request_item_results r ON r.item_id=p.item_id AND r.assessment_id=p.assessment_id
    JOIN request_sources s ON s.id=r.source_id
    JOIN request_source_versions v ON v.source_id=r.source_id AND v.version=r.source_version
    WHERE s.run_id=? AND p.state IN ('reserved','committed')`).all(runId) as any[];
}
function sourceContentKey(sourceId: string, version: number) {
  const source = db.prepare('SELECT messages_json FROM request_source_versions WHERE source_id=? AND version=?').get(sourceId, version) as any;
  return contentHash(JSON.parse(source.messages_json).map((m: any) => normalize(m.message)));
}
function quoteOverlaps(left: AssessmentItem, right: AssessmentItem) {
  const contains = (a: string, b: string) => (` ${normalize(a)} `).includes(` ${normalize(b)} `);
  return contains(left.requestQuote, right.requestQuote) || contains(right.requestQuote, left.requestQuote)
    || contains(left.requestedDeliverable, right.requestedDeliverable) || contains(right.requestedDeliverable, left.requestedDeliverable);
}
// Recomputed under reserve's outer transaction; stored lineage alone is not a lock.
function liveConflicts(row: any) {
  const item = JSON.parse(row.result_json) as AssessmentItem;
  const source = db.prepare('SELECT run_id FROM request_sources WHERE id=?').get(row.source_id) as any;
  const key = sourceContentKey(row.source_id, row.source_version);
  return activeBindings(source.run_id).filter(binding => {
    if (binding.item_id === row.item_id) return false;
    const sameSource = binding.source_id === row.source_id;
    const exactPeer = !sameSource && sourceContentKey(binding.source_id, binding.source_version) === key;
    const other = JSON.parse(binding.result_json) as AssessmentItem;
    const predecessor = sameSource && (binding.assessment_id !== row.assessment_id || quoteOverlaps(item, other));
    return exactPeer || predecessor;
  });
}
function reviewReferences(row: any) {
  const item = JSON.parse(row.result_json) as AssessmentItem;
  const refs = item.existingCommitment ? [item.existingCommitment] : [];
  const predecessors = new Set([...item.lineageItemIds, ...liveConflicts(row).map(binding => binding.item_id)]);
  for (const predecessor of predecessors) {
    const binding = db.prepare("SELECT order_id FROM proposal_item_reservations WHERE item_id=? AND state IN ('reserved','committed')").get(predecessor) as any;
    const order = binding ? getChangeOrder(binding.order_id) : null;
    if (order && !refs.some(ref => ref.resourceId === order.id)) refs.push({resourceId: order.id, revision: order.revision});
  }
  return refs.map(ref => ({...ref, decision: (db.prepare(`SELECT decision FROM duplicate_decisions
    WHERE item_id=? AND assessment_id=? AND context_fingerprint=? AND commitment_id=? AND commitment_revision=?
    ORDER BY rowid DESC LIMIT 1`).get(item.id, row.assessment_id, row.context_fingerprint, ref.resourceId, ref.revision) as any)?.decision ?? null}));
}
function reviewReference(row: any): ItemReviewReference {
  const price = db.prepare('SELECT id FROM designer_item_prices WHERE item_id=? AND assessment_id=? ORDER BY rowid DESC LIMIT 1').get(row.item_id, row.assessment_id) as any;
  const decisions = db.prepare('SELECT id FROM duplicate_decisions WHERE item_id=? AND assessment_id=? ORDER BY rowid').all(row.item_id, row.assessment_id);
  const conflicts = liveConflicts(row).map(binding => [binding.item_id, binding.order_id, getChangeOrder(binding.order_id)?.revision]).sort();
  return {assessmentId: row.assessment_id, sourceId: row.source_id, sourceVersion: row.source_version,
    contextFingerprint: row.context_fingerprint, termsFingerprint: contentHash([row.result_json, price?.id ?? null, decisions, conflicts])};
}
const REVIEW_CHANGED = 'Reviewed item assessment, source, context or terms changed; reload and review before consenting';
function requireExpectedReview(row: any, runId: string, expected: ItemReviewReference | undefined) {
  if (!row) throw new ScopedAccessError(409, REVIEW_CHANGED);
  // The shared T11a guard: exact displayed references cannot bypass a known-unavailable or changed canonical source.
  requireAssessedSourceCurrent(row.source_id, row.source_version, REVIEW_CHANGED);
  const current = reviewReference(row);
  const matches = !!expected && Object.keys(current).every(key => current[key as keyof ItemReviewReference] === expected[key as keyof ItemReviewReference]);
  if (!matches || row.context_fingerprint !== scopeContextForRun(runId).contextFingerprint) throw new ScopedAccessError(409, REVIEW_CHANGED);
}
export function setItemPrice(ctx: ActorContext, itemId: string, input: {unitAmountMinor:number; quantity:number; description:string; reason:string; expected:ItemReviewReference}) {
  requireDesignerContext(ctx);
  return transaction(() => {
    const row = latest(itemId, ctx.runId);
    requireExpectedReview(row, ctx.runId, input.expected);
    const item = JSON.parse(row.result_json) as AssessmentItem;
    const validPrice = Number.isSafeInteger(input.unitAmountMinor) && input.unitAmountMinor >= 1 && input.unitAmountMinor <= 10000000
      && Number.isSafeInteger(input.quantity) && input.quantity >= 1 && input.quantity <= 100;
    if (item.classification !== 'new_work' || !validPrice || !bounded(input.reason) || !bounded(input.description)) {
      throw new Error('Designer item pricing requires supported new work, valid amount and review reason');
    }
    if (db.prepare("SELECT id FROM proposal_item_reservations WHERE item_id=? AND state IN ('reserved','committed')").get(itemId)) {
      throw new Error('Reserved or committed item pricing cannot change');
    }
    const terms = {rateCardId:null, priceSource:'designer', unitAmountMinor:input.unitAmountMinor, quantity:input.quantity, description:input.description};
    db.prepare('INSERT INTO designer_item_prices VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), itemId, row.assessment_id,
      row.context_fingerprint, JSON.stringify(terms), ctx.actorId, input.reason, now());
    return itemProjection(row);
  });
}
function itemProjection(row:any){
 const item=JSON.parse(row.result_json);
 const binding=db.prepare("SELECT state,order_id FROM proposal_item_reservations WHERE item_id=? AND state IN ('reserved','committed')").get(item.id) as any;
 const conflicts=liveConflicts(row);
 const liveLineage=[...new Set([...item.lineageItemIds,...conflicts.map(binding=>binding.item_id)])];
 const exactPeer=item.exactSourceDuplicate||conflicts.some(binding=>binding.source_id!==row.source_id);
 const refs=reviewReferences(row),same=refs.some(r=>r.decision==='same_commitment'),distinct=refs.length&&refs.every(r=>r.decision==='distinct_work');
 const price=db.prepare('SELECT terms_json FROM designer_item_prices WHERE item_id=? AND assessment_id=? AND context_fingerprint=? ORDER BY rowid DESC LIMIT 1').get(item.id,row.assessment_id,row.context_fingerprint) as any;
 const priced=price?JSON.parse(price.terms_json):null;
 return {...item,lineageItemIds:liveLineage,exactSourceDuplicate:exactPeer,review:reviewReference(row),...(priced?{lineItems:[priced],rates:[],questions:[],proposedTotalMinor:priced.quantity*priced.unitAmountMinor,designerPriced:true}:{}),reviewReferences:refs,reservationState:binding?.state??null,originalOrderId:binding?.order_id??null,duplicateDecision:same?'same_commitment':distinct?'distinct_work':null,...(same?{lineItems:[],rates:[],proposedTotalMinor:0}:{})};
}
export function assessmentItems(assessmentId:string,runId:string){return db.prepare('SELECT r.* FROM request_item_results r JOIN request_items i ON i.id=r.item_id WHERE r.assessment_id=? AND i.run_id=? ORDER BY r.rowid').all(assessmentId,runId).map(itemProjection) as AssessmentItem[];}
function latest(id:string,runId:string){return db.prepare('SELECT r.* FROM request_item_results r JOIN request_items i ON i.id=r.item_id WHERE i.id=? AND i.run_id=? ORDER BY r.rowid DESC LIMIT 1').get(id,runId) as any;}
function eligible(row:any,runId:string){
 if(!row)throw new ScopedAccessError(409,'Unknown current canonical request item');const item=itemProjection(row) as AssessmentItem;
 requireAssessedSourceCurrent(row.source_id,row.source_version,'Item assessment source or scope context changed; reassess');
 if(row.context_fingerprint!==scopeContextForRun(runId).contextFingerprint)throw new Error('Item assessment source or scope context changed; reassess');
 if(liveConflicts(row).some(binding=>binding.source_id!==row.source_id))throw new Error('Exact source duplicate or overlapping peer remains blocked; review the authoritative source');
 if(item.exactSourceDuplicate)throw new Error('Exact source duplicate remains blocked regardless of model-selected quote spans');
 if(item.exactCommitment)throw new Error('Exact committed duplicate remains blocked regardless of semantic decision');
 if(reviewReferences(row).some(r=>r.decision!=='distinct_work'))throw new Error('Changed lineage or suspected duplicate requires recorded designer review');
 if(item.classification!=='new_work'||!item.lineItems.length||item.questions.length)throw new Error('Item is not eligible billable work');
 if(item.existingCommitment){const decision=db.prepare('SELECT decision FROM duplicate_decisions WHERE item_id=? AND assessment_id=? AND context_fingerprint=? AND commitment_id=? AND commitment_revision=? ORDER BY rowid DESC LIMIT 1').get(item.id,row.assessment_id,row.context_fingerprint,item.existingCommitment.resourceId,item.existingCommitment.revision) as any;if(decision?.decision!=='distinct_work')throw new Error('Suspected duplicate requires recorded designer review');}
 return item;
}
function reserve(runId: string, projectId: string, actorId: string, itemIds: string[], operationId: string, expected?: readonly ItemReviewReference[]): ProposalReservation {
  return transaction(() => {
    assertRunActive(runId);
    const validSelection = Array.isArray(itemIds) && itemIds.length > 0 && itemIds.length <= 20
      && new Set(itemIds).size === itemIds.length;
    if (!validSelection || !bounded(operationId) || operationId.length > 120) {
      throw new Error('Select unique eligible item IDs and an operation ID');
    }
    const rows = itemIds.map(id => latest(id, runId));
    if (rows.some(row => !row)) throw new ScopedAccessError(409, 'Unknown current canonical request item');
    // Checked before the saved-operation return: a replay cannot bypass current source authority.
    // Same-terms replay still succeeds while every item's canonical source is current and available.
    for (const row of rows) requireAssessedSourceCurrent(row.source_id, row.source_version, 'Item assessment source or scope context changed; reassess');
    // Exact displayed review references are compared in this transaction, before an idempotent replay can return.
    if (expected) rows.forEach((row, index) => requireExpectedReview(row, runId, expected[index]));
    const termsHash = contentHash(rows.map((row, index) => [itemIds[index], row.assessment_id, row.result_json, itemProjection(row).lineItems]).sort());
    const previousOperation = db.prepare('SELECT * FROM proposal_item_operations WHERE id=?').get(operationId) as any;
    if (previousOperation) {
      const sameOperation = previousOperation.run_id === runId && previousOperation.project_id === projectId
        && previousOperation.actor_id === actorId && previousOperation.terms_hash === termsHash;
      if (!sameOperation) throw new ScopedAccessError(409, 'Operation ID belongs to different actor/items/terms');
      return {operationId, orderId:previousOperation.order_id, itemIds, assessmentId:previousOperation.assessment_id,
        expectedContextFingerprint:previousOperation.context_fingerprint};
    }
    for (const id of itemIds) {
      if (db.prepare("SELECT id FROM proposal_item_reservations WHERE item_id=? AND state IN ('reserved','committed')").get(id)) {
        throw new Error('Item is already reserved or committed');
      }
    }
    // A single operation must not reserve overlapping split/merge parts before
    // either has been inserted into the active-binding index.
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const sameSource = rows[i].source_id === rows[j].source_id;
        if (sameSource && quoteOverlaps(JSON.parse(rows[i].result_json), JSON.parse(rows[j].result_json))) {
          throw new Error('Overlapping selected items require separate source review');
        }
      }
    }
    // eligible() recomputes live predecessors, peers and exact review decisions
    // here, while this transaction excludes another reservation writer.
    const parts = rows.map(row => eligible(row, runId));
    if (new Set(rows.map(row => row.assessment_id)).size !== 1) throw new Error('Items must belong to one current assessment');
    const policyPriced = actorId.startsWith('policy:');
    const deliverables = policyPriced ? parts.flatMap(part => part.lineItems.map(line => line.description)) : parts.map(part => part.requestedDeliverable);
    const order = createChangeOrder({title:parts[0].requestedDeliverable.slice(0,200), commentId:null, deliverables,
      lineItems:parts.flatMap(part => part.lineItems), currency:getProjectForRun(runId).currency}, runId);
    const assessmentId = rows[0].assessment_id, expectedContextFingerprint = rows[0].context_fingerprint;
    db.prepare('UPDATE change_orders SET assessment_id=? WHERE id=?').run(assessmentId, order.id);
    db.prepare('INSERT INTO proposal_item_operations VALUES(?,?,?,?,?,?,?,?,?)').run(operationId, projectId, runId, actorId,
      termsHash, order.id, assessmentId, expectedContextFingerprint, now());
    for (const id of itemIds) {
      db.prepare("INSERT INTO proposal_item_reservations VALUES(?,?,?,?,?,'reserved',NULL,?)").run(randomUUID(), id, operationId, order.id, assessmentId, now());
    }
    return {operationId, orderId:order.id, itemIds, assessmentId, expectedContextFingerprint};
  });
}
/** Trusted internal read-only inspection, using the reservation transaction's actual eligibility predicate. */
export function inspectProposalItemEligibility(runId:string,itemId:string,assertAuthorized:()=>void){assertAuthorized();const checked=eligible(latest(itemId,runId),runId);assertAuthorized();return checked;}
export function reserveProposalItems(ctx:ActorContext,itemIds:string[],operationId:string){requireDesignerContext(ctx);return reserve(ctx.runId,ctx.projectId,ctx.actorId,itemIds,operationId);}
export function reservePolicyItems(policy:AgentPolicy,itemIds:string[],operationId:string){const live=activeAgentPolicy(policy.runId);if(!live||live.version!==policy.version||!policyAuthority(live))throw new Error('Policy authority expired');for(const id of itemIds){const row=latest(id,policy.runId),item=eligible(row,policy.runId);if(item.existingCommitment||item.lineageItemIds.length||item.lineItems.some(i=>i.priceSource==='designer'))throw new Error('Automatic quote requires all-new unambiguous catalogue items');}return reserve(policy.runId,getProjectForRun(policy.runId).id,`policy:${policy.runId}:${policy.version}`,itemIds,operationId);}
const HEX64=/^[0-9a-f]{64}$/;
const boundedId=(v:unknown,max=200):v is string=>bounded(v)&&v.length<=max;
const sourceReferenceShape=(v:any)=>only(v,['id','version','contentHash'])&&boundedId(v.id)&&Number.isSafeInteger(v.version)&&v.version>=1&&typeof v.contentHash==='string'&&HEX64.test(v.contentHash);
const reviewShape=(v:any)=>only(v,['assessmentId','sourceId','sourceVersion','contextFingerprint','termsFingerprint'])&&boundedId(v.assessmentId)&&boundedId(v.sourceId)&&Number.isSafeInteger(v.sourceVersion)&&v.sourceVersion>=1&&typeof v.contextFingerprint==='string'&&HEX64.test(v.contextFingerprint)&&typeof v.termsFingerprint==='string'&&HEX64.test(v.termsFingerprint);
/** Connector budget participation in the shared paid path. Reservation re-admits the exact operation authority. */
function connectorBudget(connectorId:string,admit:()=>void):PaidWorkParticipant{
 return Object.freeze({
  reserve(attemptId:string,estimateMicroUsd:number){
   admit();const refused=reserveConnectorAttempt(connectorId,attemptId,estimateMicroUsd);
   if(refused)throw new ScopedAccessError(409,refused==='count'?'Connector assessment count limit reached; no request was sent':'Connector assessment spending limit reached; no request was sent');
  },
  linkCall(attemptId:string,callId:string){linkConnectorCall(attemptId,callId);},
  settle(attemptId:string,actualMicroUsd:number){settleConnectorAttempt(attemptId,actualMicroUsd);},
 });
}
/**
 * Operation entrance `assess_change_request`: the only connector path that may start paid work. Fenced through
 * trusted acquisition. Inbox requests are assessed through their root comment ID; `requestId` is deferred.
 */
export async function assessChangeRequest(ctx:ServiceContext,input:unknown):Promise<AssessmentProjection>{
 const authority=requireOperationContext(ctx,'assess_change_request'),body=input as any;
 if(!only(body,['commentId','expectedSource','expectedContextFingerprint','evidenceSnapshotId'])||!bounded(body.commentId)||(body.expectedSource!==undefined&&!sourceReferenceShape(body.expectedSource))
  ||(body.expectedContextFingerprint!==undefined&&!(typeof body.expectedContextFingerprint==='string'&&HEX64.test(body.expectedContextFingerprint)))||(body.evidenceSnapshotId!==undefined&&!boundedId(body.evidenceSnapshotId)))
  throw new ScopedAccessError(400,'Only an authoritative comment ID, optional expected source and context, and a verified evidence snapshot ID are accepted');
 const runId=ctx.runId,expectedSource=body.expectedSource as RequestSourceReference|undefined,expectedContext=body.expectedContextFingerprint as string|undefined;
 // Authority first, then the caller's displayed expectations, at every await, limiter and dispatch boundary.
 const admit=()=>{
  requireOperationContext(ctx,'assess_change_request');
  if(expectedSource)requireSourceCurrent(runId,expectedSource);
  if(expectedContext&&scopeContextForRun(runId).contextFingerprint!==expectedContext)throw new ScopedAccessError(409,'Scope context changed; reload the project scope before assessing');
 };
 const record=await assessComment(runId,{commentId:body.commentId,...(body.evidenceSnapshotId?{evidenceSnapshotId:body.evidenceSnapshotId}:{})},admit,
  {expectedSource,participant:authority.kind==='connector'?connectorBudget(authority.connector.id,admit):undefined});
 admit();
 const version=db.prepare('SELECT content_hash FROM request_source_versions WHERE source_id=? AND version=?').get(record.requestSource.id,record.requestSource.version) as any;
 return projectAssessment(record,{id:record.requestSource.id,version:record.requestSource.version,contentHash:String(version.content_hash)},scopeContextForRun(runId).contextFingerprint);
}
/**
 * Operation entrance `draft_change_order`: reserves exactly the displayed reviewed items into an unsubmitted draft,
 * bound to this actor plus `operationId`. No price, line, title, merchant or approval input is accepted.
 */
export function draftReviewedChangeOrder(ctx:ServiceContext,input:unknown):DraftProjection{
 requireOperationContext(ctx,'draft_change_order');
 const body=input as any;
 if(!only(body,['operationId','assessmentId','items'])||!boundedId(body.operationId,120)||!boundedId(body.assessmentId)||!Array.isArray(body.items)||body.items.length<1||body.items.length>20
  ||body.items.some((item:any)=>!only(item,['itemId','expected'])||!boundedId(item.itemId)||!reviewShape(item.expected))||new Set(body.items.map((item:any)=>item.itemId)).size!==body.items.length)
  throw new ScopedAccessError(400,'Select 1-20 unique reviewed item IDs, each with its exact displayed review reference');
 return transaction(()=>{
  requireOperationContext(ctx,'draft_change_order');
  const binding=reserve(ctx.runId,ctx.projectId,ctx.actorId,body.items.map((item:any)=>item.itemId),body.operationId,body.items.map((item:any)=>item.expected as ItemReviewReference));
  if(binding.assessmentId!==body.assessmentId)throw new ScopedAccessError(409,'Selected item assessment differs from the reviewed assessment');
  const order=getChangeOrder(binding.orderId);
  if(!order||order.projectId!==ctx.projectId||order.runId!==ctx.runId)throw new ScopedAccessError(404,'Change order not found');
  return projectDraft(order,{operationId:binding.operationId,assessmentId:binding.assessmentId,itemIds:binding.itemIds});
 });
}
export function resolveDuplicate(ctx: ActorContext, itemId: string, decision:'same_commitment'|'distinct_work', reason:string,
  commitmentId:string|undefined, revision:number|undefined, expected:ItemReviewReference) {
  requireDesignerContext(ctx);
  return transaction(() => {
    const row = latest(itemId, ctx.runId);
    requireExpectedReview(row, ctx.runId, expected);
    if (!['same_commitment','distinct_work'].includes(decision) || !bounded(reason)) throw new Error('Explicit duplicate review reason required');
    const reference = reviewReferences(row).find(ref => ref.resourceId === commitmentId && ref.revision === revision);
    if (!reference) throw new ScopedAccessError(409, 'Duplicate decision requires the exact displayed original proposal revision');
    db.prepare('INSERT INTO duplicate_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), itemId, row.assessment_id,
      row.context_fingerprint, reference.resourceId, reference.revision, decision, ctx.actorId, reason, now());
    return {itemId, decision};
  });
}
export function abandonProposal(ctx:ActorContext,orderId:string,reason:string){requireDesignerContext(ctx);return transaction(()=>{
 const o=getChangeOrder(orderId);if(!o||o.runId!==ctx.runId||!bounded(reason))throw new Error('Scoped proposal and abandonment reason required');if(o.approvalStatus==='approved'||o.paypalInvoiceId)throw new Error('Approved committed work cannot be abandoned by cancelling finance');
 db.prepare("UPDATE proposal_item_reservations SET state='released',reason=? WHERE order_id=? AND state='reserved'").run(reason,orderId);db.prepare("UPDATE change_orders SET status='cancelled' WHERE id=?").run(orderId);return {orderId};
});}
