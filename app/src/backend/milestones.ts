import {db,transaction,assertRunActive} from './db.js';
import {config} from './env.js';
import {requireDesignerContext,ScopedAccessError,type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {getChangeOrder,ensureInvoice,refreshPaymentStatus,isTombstonedInvoice} from './orders.js';
import {captureScopeContext,linkScopeContext} from './scopeLedger.js';
import * as paypal from './paypal.js';
import {deriveFinancialState,invoiceTermProblems,approvedProviderItems,compatibilityStatus,type ApprovedInvoiceTerms} from './paymentState.js';
import {contentHash} from './scopePersistence.js';
import {saveSchedule,validateMilestoneSchedule,recordByMilestone,invoiceRecord,recordView,hasExplicitSchedule,invoiceRoute,installmentData} from './milestoneStore.js';
import type {MilestoneSchedule,MilestoneView,FinancialState} from '../shared/types.js';

const creating=new Map<string,Promise<MilestoneView>>(),refreshing=new Map<string,Promise<MilestoneView>>();
export const installmentInFlight=(runId:string)=>[...creating.keys()].some(id=>invoiceRecord(id)?.run_id===runId);
export function setMilestoneSchedule(ctx:ActorContext,orderId:string,expectedRevision:number,schedule:MilestoneSchedule){
 requireDesignerContext(ctx);return transaction(()=>{
  const order=getScopedOrder(ctx,orderId);
  if(order.revision!==expectedRevision)throw new ScopedAccessError(409,'Proposal revision changed');
  if(order.approvalStatus==='approved'||order.paypalInvoiceId||!['draft','awaiting_client_approval','needs_re_review'].includes(order.status))throw new Error('Approved or invoiced terms are immutable');
  validateMilestoneSchedule(schedule,order.totalMinor);
  db.prepare("UPDATE change_orders SET revision=revision+1,status='draft',scope_revision_id=NULL WHERE id=? AND revision=?").run(orderId,expectedRevision);
  const row=db.prepare('SELECT * FROM change_orders WHERE id=?').get(orderId) as any;saveSchedule(row,schedule,'designer_schedule');
  linkScopeContext('proposal',orderId,row.revision,captureScopeContext(ctx.runId).id);
  return getChangeOrder(orderId)!;
 });
}
function activeRecord(id:string,admit:()=>void){
 admit();const r=invoiceRecord(id),order=r?getChangeOrder(r.order_id):null;
 if(!r||!order||r.project_id!==order.projectId||r.run_id!==order.runId||r.revision!==order.revision||r.route!==invoiceRoute())throw new ScopedAccessError(409,'Invoice record association changed or requires route review');
 assertRunActive(r.run_id);if(r.adoption_issue)throw new Error('Legacy invoice association requires review');
 return {r,order};
}
export function approvedInstallmentTerms(id:string,admit:()=>void):ApprovedInvoiceTerms {
 const {r,order}=activeRecord(id,admit);
 if(order.approvalStatus!=='approved')throw new Error('Installment invoice requires approval of the exact revision');
 const saved=db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?').get(order.id,order.revision) as any;
 const snapshot=saved?JSON.parse(saved.snapshot_json):null;
 const schedule=db.prepare('SELECT schedule_hash FROM milestone_schedules WHERE order_id=? AND revision=?').get(order.id,order.revision) as any;
 if(!snapshot?.milestoneSchedule||contentHash(snapshot.milestoneSchedule)!==schedule?.schedule_hash)throw new Error('Missing immutable approved milestone schedule');
 if(r.due_trigger==='delivery_acceptance'&&!db.prepare('SELECT review_id FROM milestone_due_events WHERE milestone_id=? AND revision=?').get(r.milestone_id,r.revision))throw new Error('Delivery acceptance due trigger has not occurred');
 const term=snapshot.milestoneSchedule.milestones.find((m:any)=>m.id===r.local_id);
 if(!term||term.title!==r.title||term.amountMinor!==r.amount_minor||term.dueTrigger!==r.due_trigger||contentHash(term.acceptanceCriteria)!==contentHash(JSON.parse(r.criteria_json)))throw new Error('Installment differs from immutable approved schedule');
 const terms:ApprovedInvoiceTerms={merchantEmail:snapshot.merchantEmail??config.paypalMerchantEmail,merchantProvenance:'approval-snapshot',currency:snapshot.currency,totalMinor:r.amount_minor,lineItems:[{description:`Installment: ${r.title}`,quantity:1,unitAmountMinor:r.amount_minor}],representation:'itemized-v1',reference:`installment:${r.milestone_id}`,invoiceNumber:'SS-'+contentHash([order.id,order.revision,r.milestone_id]).slice(0,22)};
 approvedProviderItems(terms);
 if(r.terms_json&&contentHash(JSON.parse(r.terms_json))!==contentHash(terms))throw new Error('Stored installment terms differ from immutable approval');
 const operation=db.prepare('SELECT * FROM invoice_operations WHERE operation_key=?').get(r.operation_key) as any;
 if(operation&&(operation.change_order_id!==r.order_id||operation.representation!==terms.representation||!operation.approved_terms_json||contentHash(JSON.parse(operation.approved_terms_json))!==contentHash(terms)||operation.paypal_invoice_id&&r.provider_id&&operation.paypal_invoice_id!==r.provider_id))throw new Error('Invoice operation differs from immutable installment terms');
 db.prepare('UPDATE invoice_records SET terms_json=? WHERE id=? AND terms_json IS NULL').run(JSON.stringify(terms),id);return {...terms,...(r.provider_id?{invoiceId:r.provider_id}:{})};
}
const approvedTerms=approvedInstallmentTerms;
/** Trusted private entrance shared by human approval, designer confirmation and due-trigger acceptance. */
export async function ensureInstallmentInvoice(id:string,admit:()=>void):Promise<MilestoneView>{
 const {r}=activeRecord(id,admit);
 if(r.legacy){await ensureInvoice(r.order_id,admit);admit();return recordView(invoiceRecord(id));}
 approvedTerms(id,admit);const running=creating.get(id);if(running){await running;admit();return recordView(invoiceRecord(id));}
 const work=resume(id,admit).finally(()=>creating.delete(id));creating.set(id,work);return work;
}
export async function ensureMilestoneInvoice(ctx:ActorContext,milestoneId:string):Promise<MilestoneView>{
 const admit=()=>{requireDesignerContext(ctx);const row=recordByMilestone(milestoneId);if(!row||row.project_id!==ctx.projectId||row.run_id!==ctx.runId)throw new ScopedAccessError(404,'Milestone not found');getScopedOrder(ctx,row.order_id);};
 admit();return ensureInstallmentInvoice(recordByMilestone(milestoneId).id,admit);
}
async function resume(id:string,admit:()=>void){
 const {r,order}=activeRecord(id,admit),{invoiceId:existingInvoiceId,...terms}=approvedTerms(id,admit),at=new Date().toISOString();
 const previous=db.prepare('SELECT * FROM invoice_operations WHERE operation_key=?').get(r.operation_key) as any;
 if(!previous)transaction(()=>{activeRecord(id,admit);approvedTerms(id,admit);db.prepare("INSERT INTO invoice_operations(operation_key,change_order_id,state,created_at,updated_at,representation,approved_terms_json) VALUES(?,?,'creating',?,?,'itemized-v1',?)").run(r.operation_key,order.id,at,at,JSON.stringify(terms));db.prepare("UPDATE invoice_records SET state='creating' WHERE id=?").run(id);});
 const authorized=()=>{activeRecord(id,admit);approvedTerms(id,admit);return true;};
 let providerId=r.provider_id??previous?.paypal_invoice_id;
 if(!providerId){
  providerId=previous?await paypal.findInvoiceByNumber(terms.invoiceNumber,authorized):null;
  if(!providerId){const created=await paypal.createDraftInvoice({merchantEmail:terms.merchantEmail,buyerEmail:config.paypalBuyerEmail,description:order.deliverables.join('; '),amountMinor:terms.totalMinor,currency:terms.currency,reference:terms.reference,approvedTerms:terms,paymentTerms:'Explicit approved installment. Work starts after the approved work-start payment prerequisites are satisfied. Sandbox demonstration only.'},authorized);providerId=created.id;}
 }
 // Persist a known create even if authority ended during its response; it must never become a second create.
 transaction(()=>{db.prepare("UPDATE invoice_records SET provider_id=?,state=CASE WHEN state IN ('sending','sent') THEN state ELSE 'created' END WHERE id=? AND (provider_id IS NULL OR provider_id=?)").run(providerId,id,providerId);db.prepare("UPDATE invoice_operations SET paypal_invoice_id=?,state=CASE WHEN state IN ('sending','sent') THEN state ELSE 'created' END,updated_at=? WHERE operation_key=?").run(providerId,new Date().toISOString(),r.operation_key);});
 authorized();const detail=await paypal.getInvoice(providerId,authorized);
 const problems=invoiceTermProblems(detail,{...terms,invoiceId:providerId});if(detail.raw?.detail?.invoice_number!==terms.invoiceNumber)problems.push('invoice number differs');if(problems.length)throw new Error('Installment invoice does not match immutable approved terms');
 const recordSent=()=>{transaction(()=>{db.prepare("UPDATE invoice_records SET state='sent' WHERE id=?").run(id);db.prepare("UPDATE invoice_operations SET state='sent',updated_at=? WHERE operation_key=?").run(new Date().toISOString(),r.operation_key);});};
 if(detail.status==='DRAFT'&&['sending','sent'].includes(invoiceRecord(id).state))throw new Error('Previous invoice send is uncertain; read-only checking requires provider review');
 const beginSend=()=>transaction(()=>{authorized();db.prepare("UPDATE invoice_records SET state='sending' WHERE id=?").run(id);db.prepare("UPDATE invoice_operations SET state='sending',updated_at=? WHERE operation_key=?").run(new Date().toISOString(),r.operation_key);});
 const url=detail.status==='DRAFT'?await paypal.sendInvoice(providerId,authorized,recordSent,beginSend):detail.payerViewUrl;recordSent();authorized();
 db.prepare('UPDATE invoice_records SET payer_url=? WHERE id=?').run(url,id);return refreshInvoiceRecord(id,admit);
}
export async function ensureDueInstallments(orderId:string,admit:()=>void){
 const order=getChangeOrder(orderId)!;for(const m of order.installments??[])if(m.dueTrigger==='proposal_approval')await ensureInstallmentInvoice(m.invoiceRecordId,admit);
 return getChangeOrder(orderId)!;
}
/** Exact invoice-record retrieval; completion hooks run in the observation transaction. */
export async function refreshInvoiceRecord(id:string,admit:()=>void=()=>{},apply?:()=>void):Promise<MilestoneView>{
 const previous=refreshing.get(id);
 const work=(async()=>{if(previous)await previous.catch(()=>{});return retrieve(id,admit,apply);})();refreshing.set(id,work);
 try{return await work;}finally{if(refreshing.get(id)===work)refreshing.delete(id);}
}
async function retrieve(id:string,admit:()=>void,apply?:()=>void){
 const {r,order}=activeRecord(id,admit);
 if(r.legacy){await refreshPaymentStatus(order.id,admit,apply);admit();return recordView(invoiceRecord(id));}
 if(!r.provider_id){apply?.();return recordView(r);}
 const terms=approvedTerms(id,admit),binding=contentHash([r.order_id,r.revision,r.provider_id,r.operation_key,r.terms_json,r.route]),detail=await paypal.getInvoice(r.provider_id,()=>{activeRecord(id,admit);return true;});
 return transaction(()=>{
  const current=activeRecord(id,admit).r;
  if(isTombstonedInvoice(r.provider_id)||contentHash([current.order_id,current.revision,current.provider_id,current.operation_key,current.terms_json,current.route])!==binding)throw new Error('Invoice association changed while retrieving payment');
  let financial:FinancialState;
  try {if(detail.raw?.detail?.invoice_number!==terms.invoiceNumber)throw new Error('Invoice number differs from the approved installment');financial=deriveFinancialState(detail,{...terms,invoiceId:r.provider_id});}
  catch {financial={invoiceState:'unknown',paymentState:'review_required',rawStatus:detail.raw?.status??null,amountDueMinor:null,paidMinor:null,refundedMinor:null,observedAt:new Date().toISOString(),representation:'unknown',merchantProvenance:'approval-snapshot',issues:['Invoice identity or immutable terms could not be validated']};}
  db.prepare('INSERT INTO payment_observations(change_order_id,paypal_invoice_id,raw_status,display_status,amount_due_minor,checked_at,financial_json,invoice_record_id) VALUES(?,?,?,?,?,?,?,?)').run(order.id,r.provider_id,String(detail.status),compatibilityStatus(financial),financial.amountDueMinor,financial.observedAt,JSON.stringify(financial),id);
  db.prepare('UPDATE invoice_records SET financial_json=?,observed_at=?,payer_url=COALESCE(?,payer_url) WHERE id=?').run(JSON.stringify(financial),financial.observedAt,detail.payerViewUrl,id);
  const raw=db.prepare('SELECT * FROM change_orders WHERE id=?').get(order.id) as any,summary=installmentData(raw)!.installmentSummary;
  db.prepare('UPDATE change_orders SET status=? WHERE id=?').run(summary.allObligationsPaid?'paid':summary.unknownRecordIds.length?'payment_review_required':'payment_due',order.id);
  if(!summary.allObligationsPaid)db.prepare("UPDATE agent_requests SET state='quoted',updated_at=? WHERE order_id=? AND state='paid'").run(financial.observedAt,order.id);
  apply?.();return recordView(invoiceRecord(id));
 });
}
