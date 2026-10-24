import {deliveryFinancialReview} from './deliverySummary.js';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './db.js';
import {requireDesignerContext,sessionForContext,ScopedAccessError,type ActorContext} from './context.js';
import {getChangeOrder,refreshPaymentStatus} from './orders.js';
import {getDeliveryRun,getDeliverySnapshot} from './delivery.js';
import {recordByMilestone} from './milestoneStore.js';
import {ensureInstallmentInvoice} from './milestones.js';
import {createScopeParent} from './scopeLedger.js';
import {createInvitation} from './sessions.js';
import {activeGrant,createGrant,credentialHash} from './judgeAccess.js';
import {config} from './env.js';
function fail(message:string):never {throw new ScopedAccessError(409,message);}
function event(reviewId:string,kind:string,ctx:ActorContext,body:any){db.prepare('INSERT INTO delivery_events VALUES(?,?,?,?,?,?)').run(randomUUID(),reviewId,kind,ctx.actorId,JSON.stringify(body),new Date().toISOString());}
function scopedReview(ctx:ActorContext,id:string,clientOnly=false){
 sessionForContext(ctx);
 if(clientOnly&&(ctx.role!=='client'||ctx.grant.kind!=='delivery'))throw new ScopedAccessError(403,'Requires the exact client delivery grant');
 const row=db.prepare('SELECT * FROM delivery_reviews WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
 if(!row)throw new ScopedAccessError(404,'Delivery review not found');
 if(ctx.role==='client'&&(ctx.grant.kind!=='delivery'||ctx.grant.resourceId!==id||ctx.grant.revision!==row.review_revision))throw new ScopedAccessError(403,'This client grant does not authorize this delivery');
 const head=db.prepare('SELECT * FROM delivery_review_heads WHERE milestone_id=?').get(row.milestone_id) as any,order=getChangeOrder(row.order_id);
 if(!order||order.revision!==row.order_revision||head?.review_id!==id||head?.revision!==row.review_revision||row.state==='superseded')fail('Delivery review was replaced or its proposal revision changed');
 return {row,order};
}
function acceptanceView(row:any){return {id:row.id,reviewId:row.review_id,milestoneId:row.milestone_id,orderId:row.order_id,orderRevision:row.order_revision,revision:row.review_revision,snapshotId:row.snapshot_id,snapshotHash:row.snapshot_hash,acceptedAt:row.created_at,state:'accepted' as const};}
/** Whitelisted exact-review DTO. Raw provider data and private access credentials never enter it. */
export function getDeliveryReview(ctx:ActorContext,id:string){
 const {row,order}=scopedReview(ctx,id),saved=db.prepare('SELECT * FROM delivery_snapshots WHERE id=? AND project_id=? AND run_id=?').get(row.snapshot_id,ctx.projectId,ctx.runId) as any;
 if(!saved||saved.hash!==row.snapshot_hash)fail('Delivery snapshot is unavailable or differs from the reviewed version');
 const acceptance=db.prepare('SELECT * FROM delivery_acceptances WHERE review_id=?').get(id) as any;
 return {id,revision:row.review_revision,orderId:row.order_id,orderRevision:row.order_revision,milestoneId:row.milestone_id,state:row.state,
  snapshot:{...JSON.parse(saved.snapshot_json),imageDataUrl:'data:image/png;base64,'+Buffer.from(saved.png).toString('base64')},acceptanceCriteria:JSON.parse(row.criteria_json),
  acceptance:acceptance?acceptanceView(acceptance):null,financialReviewRequired:deliveryFinancialReview(order),
  events:(db.prepare('SELECT e.kind,e.body_json,e.created_at,r.review_revision FROM delivery_events e JOIN delivery_reviews r ON r.id=e.review_id WHERE r.milestone_id=? AND r.order_revision=? ORDER BY e.rowid').all(row.milestone_id,row.order_revision) as any[]).map(e=>({kind:e.kind,body:JSON.parse(e.body_json),reviewRevision:e.review_revision,createdAt:e.created_at})),
  order:{id:order.id,revision:order.revision,title:order.title,deliverables:order.deliverables,lineItems:order.lineItems,totalMinor:order.totalMinor,currency:order.currency,status:order.status,approvalStatus:order.approvalStatus,milestoneSchedule:order.milestoneSchedule,installmentSummary:order.installmentSummary,installments:order.installments,delivery:order.delivery}};
}
export function submitDelivery(ctx:ActorContext,milestoneId:string,snapshotId:string){
 requireDesignerContext(ctx);const record=recordByMilestone(milestoneId);
 if(!record||record.project_id!==ctx.projectId||record.run_id!==ctx.runId)throw new ScopedAccessError(404,'Milestone not found');
 const snapshot=getDeliverySnapshot(ctx,snapshotId),run=getDeliveryRun(ctx,snapshot.deliveryRunId),order=getChangeOrder(record.order_id);
 if(run.milestoneId!==milestoneId||run.orderId!==record.order_id||run.revision!==record.revision||order?.revision!==run.revision||order.approvalStatus!=='approved')fail('Select the exact approved work and output snapshot');
 return transaction(()=>{
  requireDesignerContext(ctx);const head=db.prepare('SELECT * FROM delivery_review_heads WHERE milestone_id=?').get(milestoneId) as any,previous=head?db.prepare('SELECT * FROM delivery_reviews WHERE id=?').get(head.review_id) as any:null;
  if(previous?.snapshot_id===snapshotId){if(previous.state==='changes_requested')fail('Save a revised delivery snapshot before resubmitting requested changes');return getDeliveryReview(ctx,previous.id);}
  if(db.prepare('SELECT id FROM delivery_acceptances WHERE milestone_id=? AND order_revision=?').get(milestoneId,record.revision))fail('An accepted delivered version is immutable; agree a new work revision for replacement');
  const id=randomUUID(),revision=(head?.revision??0)+1,at=new Date().toISOString();
  db.prepare("INSERT INTO delivery_reviews VALUES(?,?,?,?,?,?,?,?,?,?,'in_review',?,?)").run(id,milestoneId,ctx.projectId,ctx.runId,record.order_id,record.revision,revision,snapshotId,snapshot.hash,JSON.stringify(run.brief.acceptanceCriteria),ctx.actorId,at);
  if(previous){db.prepare("UPDATE delivery_reviews SET state='superseded' WHERE id=?").run(previous.id);event(previous.id,'superseded',ctx,{replacementReviewId:id,replacementRevision:revision});}
  db.prepare('INSERT INTO delivery_review_heads VALUES(?,?,?) ON CONFLICT(milestone_id) DO UPDATE SET review_id=excluded.review_id,revision=excluded.revision').run(milestoneId,id,revision);
  event(id,'submitted',ctx,{snapshotId,snapshotHash:snapshot.hash,orderRevision:record.revision,reviewRevision:revision,acceptanceCriteria:run.brief.acceptanceCriteria});return getDeliveryReview(ctx,id);
 });
}
export function issueDeliveryAccess(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const {row}=scopedReview(ctx,id),session=sessionForContext(ctx),parent=session.grantId?activeGrant(session.grantId):null;
 const parentId=createScopeParent(ctx.projectId,ctx.runId,parent?'grant':'session',parent?parent.id:credentialHash(session.token),parent?.expires_at??session.expiresAt);
 if(parent){const grant=createGrant(parent.judge_access_id,ctx.runId,'client',null,null,{kind:'delivery',resourceId:id,revision:row.review_revision,parentId});return {deliveryUrl:`${config.publicUrl}/delivery#resume=${grant.credential}`,expiresAt:grant.expiresAt};}
 const invitation=createInvitation({projectId:ctx.projectId,runId:ctx.runId,role:'client',grantKind:'delivery',resourceId:id,resourceRevision:row.review_revision,scopeParentId:parentId,expiresAt:session.expiresAt});
 return {deliveryUrl:`${config.publicUrl}/delivery#${invitation.token}`,expiresAt:invitation.expiresAt};
}
export function requestDeliveryChanges(ctx:ActorContext,id:string,comment:string){
 scopedReview(ctx,id,true);if(typeof comment!=='string'||!comment.trim()||comment.length>4000)throw new ScopedAccessError(400,'Describe the requested changes in at most 4000 characters');
 return transaction(()=>{
  const {row}=scopedReview(ctx,id,true);if(!['in_review','changes_requested'].includes(row.state))fail('Accepted delivery cannot be rejected or silently replaced');
  event(id,'changes_requested',ctx,{comment:comment.trim(),snapshotId:row.snapshot_id,snapshotHash:row.snapshot_hash,reviewRevision:row.review_revision});db.prepare("UPDATE delivery_reviews SET state='changes_requested' WHERE id=?").run(id);return getDeliveryReview(ctx,id);
 });
}
/** Human client acceptance is saved atomically before the recoverable exact-installment invoice operation. */
export async function acceptDelivery(ctx:ActorContext,id:string,expectedRevision:number){
 const {row}=scopedReview(ctx,id,true);if(!Number.isSafeInteger(expectedRevision)||row.review_revision!==expectedRevision)fail('Delivery review revision changed');
 const accepted=transaction(()=>{
  const {row}=scopedReview(ctx,id,true);const existing=db.prepare('SELECT * FROM delivery_acceptances WHERE review_id=?').get(id) as any;if(existing)return acceptanceView(existing);
  if(row.state!=='in_review')fail('Requested changes need a revised delivery review before acceptance');
  const snapshot=db.prepare('SELECT hash FROM delivery_snapshots WHERE id=?').get(row.snapshot_id) as any;if(snapshot?.hash!==row.snapshot_hash)fail('Exact reviewed snapshot is unavailable');
  const acceptanceId=randomUUID(),at=new Date().toISOString();
  db.prepare('INSERT INTO delivery_acceptances VALUES(?,?,?,?,?,?,?,?,?,?)').run(acceptanceId,id,row.milestone_id,row.order_id,row.order_revision,row.review_revision,row.snapshot_id,row.snapshot_hash,ctx.actorId,at);
  db.prepare("UPDATE delivery_reviews SET state='accepted' WHERE id=? AND state='in_review'").run(id);event(id,'accepted',ctx,{acceptanceId,snapshotId:row.snapshot_id,snapshotHash:row.snapshot_hash,reviewRevision:row.review_revision,acceptanceCriteria:JSON.parse(row.criteria_json)});
  const record=recordByMilestone(row.milestone_id);if(record?.due_trigger==='delivery_acceptance')db.prepare('INSERT INTO milestone_due_events VALUES(?,?,?,?,?)').run(row.milestone_id,row.order_id,row.order_revision,id,at);
  return acceptanceView(db.prepare('SELECT * FROM delivery_acceptances WHERE id=?').get(acceptanceId));
 });
 const guard=()=>{scopedReview(ctx,id,true);};
 try{const record=recordByMilestone(row.milestone_id);if(record?.due_trigger==='delivery_acceptance')await ensureInstallmentInvoice(record.id,guard);guard();return {...accepted,financialReviewRequired:getDeliveryReview(ctx,id).financialReviewRequired};}
 catch(error){guard();return {...accepted,financialReviewRequired:getDeliveryReview(ctx,id).financialReviewRequired,invoiceError:error instanceof Error?error.message:'Balance invoice needs recovery; acceptance is saved'};}
}
export async function refreshDeliveryPayment(ctx:ActorContext,id:string){const {row}=scopedReview(ctx,id);await refreshPaymentStatus(row.order_id,()=>{scopedReview(ctx,id);});scopedReview(ctx,id);return getDeliveryReview(ctx,id);}
