import {deliveryFinancialReview} from './deliverySummary.js';
import {randomUUID} from 'node:crypto';
export {submitDelivery,issueDeliveryAccess,getDeliveryReview,requestDeliveryChanges,acceptDelivery,refreshDeliveryPayment} from './deliveryReview.js';
import {db,transaction,getProjectForRun} from './db.js';
import {requireDesignerContext,ScopedAccessError,type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {recordByMilestone} from './milestoneStore.js';
import {refreshInvoiceRecord} from './milestones.js';
import {contextTermsCurrent} from './scopeLedger.js';
import {contentHash} from './scopePersistence.js';
import {assessmentEvidence,validateEvidencePng} from './designEvidence.js';
import type {DeliveryBrief,DeliveryRun,DeliverySnapshot} from '../shared/types.js';

const fail=(message:string):never=>{throw new ScopedAccessError(409,message);};
function approvedWork(ctx:ActorContext,milestoneId:string){
 requireDesignerContext(ctx);const record=recordByMilestone(milestoneId);
 if(!record||record.project_id!==ctx.projectId||record.run_id!==ctx.runId)throw new ScopedAccessError(404,'Milestone not found');
 const order=getScopedOrder(ctx,record.order_id),project=getProjectForRun(ctx.runId);
 if(order.approvalStatus!=='approved'||order.revision!==record.revision)fail('Work requires the exact approved proposal revision');
 if(!order.scopeContext||!contextTermsCurrent(order.scopeContext,ctx.runId)||order.scopeRevisionId!==project.scopeRevisionId)fail('Scope changed; review the approved revision before starting work');
 const row=db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?').get(order.id,order.revision) as any;
 if(!row)fail('Immutable approved terms are unavailable');
 return {record,order,snapshot:JSON.parse(row.snapshot_json)};
}
async function paidWork(ctx:ActorContext,milestoneId:string){
 const first=approvedWork(ctx,milestoneId),identity=contentHash(first.snapshot),required=first.order.milestoneSchedule!.workStartPaymentMilestoneIds;
 for(const localId of required){
  const m=first.order.installments?.find(m=>m.localId===localId);
  if(!m||m.dueTrigger!=='proposal_approval'||!m.paypalInvoiceId)fail('Work-start payment prerequisite is not invoiced and paid');
  await refreshInvoiceRecord(m!.invoiceRecordId,()=>{const fresh=approvedWork(ctx,milestoneId);if(contentHash(fresh.snapshot)!==identity)fail('Approved revision changed during payment verification');});
 }
 const current=approvedWork(ctx,milestoneId);
 if(!required.length||!current.order.installmentSummary?.workStartSatisfied)fail('Work-start payment prerequisite requires coherent unreversed payment; financial review is required');
 return current;
}
function briefFrom(ctx:ActorContext,work:ReturnType<typeof approvedWork>):DeliveryBrief {
 const {order,record,snapshot}=work,operationId='delivery:'+record.milestone_id;
 const requests=db.prepare(`SELECT DISTINCT s.id sourceId,i.source_version sourceVersion,s.root_id rootId FROM proposal_item_reservations r JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id JOIN request_sources s ON s.id=i.source_id WHERE r.order_id=? AND r.state='committed' ORDER BY s.id`).all(order.id) as any[];
 const evidence=order.assessmentId?assessmentEvidence(order.assessmentId,ctx.runId):null;
 const observations=order.milestoneSchedule!.workStartPaymentMilestoneIds.map(localId=>{
  const m=order.installments!.find(m=>m.localId===localId)!,observation=db.prepare('SELECT id,checked_at FROM payment_observations WHERE invoice_record_id=? ORDER BY id DESC LIMIT 1').get(m.invoiceRecordId) as any;
  if(!observation||m.financialState?.paymentState!=='paid')fail('Exact paid-condition observation is unavailable');
  return {invoiceRecordId:m.invoiceRecordId,observationId:observation.id,amountMinor:m.amountMinor,observedAt:observation.checked_at};
 });
 return {schemaVersion:1,projectId:ctx.projectId,runId:ctx.runId,orderId:order.id,revision:order.revision,milestoneId:record.milestone_id,operationId,title:order.title,deliverables:[...snapshot.deliverables],lineItems:snapshot.lineItems,
  approvedTermsHash:contentHash(snapshot),scopeContext:order.scopeContext!,requestReferences:requests,evidenceReferences:evidence?[{id:evidence.id,hash:evidence.hash,fileKey:evidence.fileKey,nodeIds:evidence.nodeIds,verification:evidence.verification,pixelProvenance:evidence.pixelProvenance}]:[],
  relevantNodeIds:evidence?.nodeIds??[],acceptanceCriteria:JSON.parse(record.criteria_json),paymentCondition:{requiredMilestoneIds:[...order.milestoneSchedule!.workStartPaymentMilestoneIds],observations},
  allowedArea:{fileKey:getProjectForRun(ctx.runId).figmaFileKey,operationId,pageName:'Scope & Settle draft '+record.milestone_id.slice(-12),mode:'dedicated_draft_page'},repositoryReferences:[],optionalCapabilities:{specs:false,mcpGeneration:false,codeLayers:false,codeConnect:false},createdAt:new Date().toISOString()};
}
export async function prepareDeliveryBrief(ctx:ActorContext,milestoneId:string):Promise<DeliveryBrief>{return briefFrom(ctx,await paidWork(ctx,milestoneId));}
function runRow(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const row=db.prepare('SELECT * FROM delivery_runs WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
 if(!row)throw new ScopedAccessError(404,'Delivery run not found');getScopedOrder(ctx,row.order_id);return row;
}
function runView(ctx:ActorContext,row:any):DeliveryRun {
 const order=getScopedOrder(ctx,row.order_id),latest=db.prepare('SELECT snapshot_json FROM delivery_snapshots WHERE delivery_run_id=? ORDER BY rowid DESC LIMIT 1').get(row.id) as any;
 return {id:row.id,operationId:row.operation_id,milestoneId:row.milestone_id,orderId:row.order_id,revision:row.revision,state:row.state,brief:JSON.parse(row.brief_json),briefHash:row.brief_hash,deliveryReview:(db.prepare('SELECT r.id,r.review_revision revision,r.snapshot_hash snapshotHash,r.state FROM delivery_reviews r JOIN delivery_review_heads h ON h.review_id=r.id WHERE r.milestone_id=?').get(row.milestone_id) as DeliveryRun['deliveryReview'])??null,latestSnapshot:latest?JSON.parse(latest.snapshot_json):null,financialReviewRequired:deliveryFinancialReview(order),createdAt:row.created_at};
}
export function getDeliveryRun(ctx:ActorContext,id:string){return runView(ctx,runRow(ctx,id));}
export function orderDeliveries(ctx:ActorContext,orderId:string){getScopedOrder(ctx,orderId);requireDesignerContext(ctx);return (db.prepare('SELECT * FROM delivery_runs WHERE order_id=? AND revision=(SELECT revision FROM change_orders WHERE id=?) ORDER BY rowid').all(orderId,orderId) as any[]).map(row=>runView(ctx,row));}
/** All awaits finish before the one synchronous idempotent work authorization transaction. */
export async function startApprovedWork(ctx:ActorContext,milestoneId:string):Promise<DeliveryRun>{
 const work=await paidWork(ctx,milestoneId);
 return transaction(()=>{
  const current=approvedWork(ctx,milestoneId);if(contentHash(current.snapshot)!==contentHash(work.snapshot)||!current.order.installmentSummary?.workStartSatisfied)fail('Work payment or scope changed before authorization');
  const existing=db.prepare('SELECT id FROM delivery_runs WHERE milestone_id=?').get(milestoneId) as any;if(existing)return getDeliveryRun(ctx,existing.id);
  const brief=briefFrom(ctx,current),id=randomUUID();
  db.prepare("INSERT INTO delivery_runs VALUES(?,?,?,?,?,?,?,?,?,'draft',?)").run(id,milestoneId,ctx.projectId,ctx.runId,work.order.id,work.order.revision,brief.operationId,JSON.stringify(brief),contentHash(brief),brief.createdAt);
  return getDeliveryRun(ctx,id);
 });
}
/** Native readback claims remain client supplied until independent provider/native qualification. */
export function recordDeliveryOutput(ctx:ActorContext,id:string,input:any):DeliverySnapshot {
 const run=getDeliveryRun(ctx,id),area=run.brief.allowedArea;
 if(!input||Object.keys(input).some(k=>!['fileKey','operationId','pageId','areaId','nodeIds','nodes','imageDataUrl','capturedAt'].includes(k))||input.fileKey!==area.fileKey||input.operationId!==run.operationId||!Array.isArray(input.nodeIds)||!input.nodeIds.length||input.nodeIds.length>120||new Set(input.nodeIds).size!==input.nodeIds.length||!Array.isArray(input.nodes)||input.nodes.length!==input.nodeIds.length)throw new ScopedAccessError(400,'Exact allowed output file, operation, area and generated IDs are required');
 const nodeId=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(v);
 if(!nodeId(input.pageId)||!nodeId(input.areaId)||input.pageId===input.areaId||!input.nodeIds.includes(input.areaId)||input.nodeIds.includes(input.pageId)||input.nodeIds.some((v:any)=>!nodeId(v))||!Number.isFinite(Date.parse(input.capturedAt))||Math.abs(Date.now()-Date.parse(input.capturedAt))>15*60000)throw new ScopedAccessError(400,'Invalid draft output identity or capture time');
 const graph=new Map<string,any>();
 for(const node of input.nodes){if(!node||Object.keys(node).some(k=>!['id','parentId','type'].includes(k))||!input.nodeIds.includes(node.id)||graph.has(node.id)||!nodeId(node.parentId)||!['FRAME','TEXT','RECTANGLE','GROUP'].includes(node.type))throw new ScopedAccessError(400,'Invalid generated node graph');graph.set(node.id,node);}
 if(graph.get(input.areaId)?.parentId!==input.pageId||graph.get(input.areaId)?.type!=='FRAME')fail('Generated area must be on its dedicated draft page');
 for(const id of input.nodeIds){let key=id;const seen=new Set<string>();while(key!==input.areaId){if(seen.has(key)||!graph.has(key))fail('Generated output is outside the allowed work area');seen.add(key);key=graph.get(key).parentId;}}
 const png=validateEvidencePng(input.imageDataUrl),hash=contentHash({operationId:run.operationId,fileKey:input.fileKey,pageId:input.pageId,areaId:input.areaId,nodes:input.nodes,imageHash:png.hash});
 return transaction(()=>{
  runRow(ctx,id);const work=approvedWork(ctx,run.milestoneId);if(contentHash(work.snapshot)!==run.brief.approvedTermsHash)fail('Approved delivery scope changed');
  const bound=db.prepare('SELECT snapshot_json FROM delivery_snapshots WHERE delivery_run_id=? ORDER BY rowid LIMIT 1').get(id) as any;
  if(bound){const original=JSON.parse(bound.snapshot_json);if(input.pageId!==original.pageId||input.areaId!==original.areaId)fail('Draft output page or allowed area changed; review is required');}
  const prior=db.prepare('SELECT snapshot_json FROM delivery_snapshots WHERE delivery_run_id=? AND hash=?').get(id,hash) as any;if(prior)return JSON.parse(prior.snapshot_json);
  const snapshot:DeliverySnapshot={id:randomUUID(),deliveryRunId:id,hash,imageHash:png.hash,fileKey:input.fileKey,pageId:input.pageId,areaId:input.areaId,nodeIds:input.nodeIds,nodes:input.nodes,capturedAt:input.capturedAt,receivedAt:new Date().toISOString(),pixelProvenance:'client_supplied',nodeProvenance:'client_plugin_claim',accepted:false,width:png.width,height:png.height};
  db.prepare('INSERT INTO delivery_snapshots VALUES(?,?,?,?,?,?,?,?)').run(snapshot.id,id,ctx.projectId,ctx.runId,hash,JSON.stringify(snapshot),png.bytes,snapshot.receivedAt);return snapshot;
 });
}
export function getDeliverySnapshot(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const row=db.prepare('SELECT * FROM delivery_snapshots WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
 if(!row)throw new ScopedAccessError(404,'Delivery snapshot not found');runRow(ctx,row.delivery_run_id);return {...JSON.parse(row.snapshot_json),imageDataUrl:'data:image/png;base64,'+Buffer.from(row.png).toString('base64')};
}
