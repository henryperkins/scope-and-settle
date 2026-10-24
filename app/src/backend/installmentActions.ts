import {randomUUID} from 'node:crypto';
import {db,transaction} from './db.js';
import {requireDesignerContext,sessionForContext,ScopedAccessError,type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {recordByMilestone,invoiceRecord} from './milestoneStore.js';
import {approvedInstallmentTerms,ensureInstallmentInvoice,refreshInvoiceRecord} from './milestones.js';
import {contentHash} from './scopePersistence.js';
import {claimOutbound,beginOutbound,finishOutbound,requireUnpaidInvoice} from './outboundActions.js';
import * as paypal from './paypal.js';
import {config} from './env.js';

type Kind='issue_approved_invoice'|'cancel_invoice'|'remind_invoice';
type Input={kind:Kind;milestoneId:string;expectedRevision:number};
const fail=(message:string):never=>{throw new ScopedAccessError(409,message);};
const flights=new Map<string,Promise<any>>();
function selected(ctx:ActorContext,milestoneId:string,revision:number){
 requireDesignerContext(ctx);const r=recordByMilestone(milestoneId);
 if(!r||r.run_id!==ctx.runId||r.project_id!==ctx.projectId)throw new ScopedAccessError(404,'Milestone not found');
 const order=getScopedOrder(ctx,r.order_id);
 if(r.legacy)fail('Use the original invoice review for this legacy installment');
 if(order.revision!==revision||r.revision!==revision||order.approvalStatus!=='approved')fail('Select the current approved installment revision');
 return r;
}
function identity(r:any,terms:any){
 const approval=db.prepare("SELECT id,created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client' ORDER BY id DESC LIMIT 1").get(r.order_id,r.revision) as any;
 if(!approval)fail('Exact client approval required');
 const due=db.prepare('SELECT review_id FROM milestone_due_events WHERE milestone_id=? AND revision=?').get(r.milestone_id,r.revision);
 const {invoiceId,...immutableTerms}=terms;
 return {recordId:r.id,operationKey:r.operation_key,revision:r.revision,route:r.route,terms:immutableTerms,approval,due:due??null};
}
function recipients(detail:paypal.InvoiceDetail){
 const primary=(detail.raw.primary_recipients??[]).map((x:any)=>x.billing_info?.email_address),merchant=detail.raw.invoicer?.email_address,cc=detail.raw.additional_recipients??[];
 if(!primary.length||primary.some((x:any)=>typeof x!=='string'||!x)||typeof merchant!=='string'||!Array.isArray(cc)||cc.some(x=>typeof x!=='string'))fail('Invoice recipient identity is unavailable');
 return {primary,merchant,cc:[...cc].sort()};
}
function owned(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const row=db.prepare('SELECT * FROM installment_actions WHERE id=?').get(id) as any;
 if(!row||row.project_id!==ctx.projectId||row.run_id!==ctx.runId||row.owner_id!==ctx.actorId)throw new ScopedAccessError(403,'This installment preview belongs to another designer');
 return row;
}
export function getMilestoneAction(ctx:ActorContext,id:string){const row=owned(ctx,id);return {...JSON.parse(row.preview_json),previewHash:row.preview_hash,state:row.state,result:row.result_json?JSON.parse(row.result_json):null};}
function saveResult(id:string,state:string,message:string,extra:any={}){
 const result={id,state,message,notificationDelivery:'unverified',...extra};
 db.prepare('UPDATE installment_actions SET state=?,result_json=? WHERE id=?').run(state,JSON.stringify(result),id);return result;
}
/** Persist only a review preview. No create, send, reminder or cancellation. */
export async function prepareMilestoneAction(ctx:ActorContext,input:Input){
 requireDesignerContext(ctx);
 if(!input||Object.keys(input).some(k=>!['kind','milestoneId','expectedRevision'].includes(k))||!['issue_approved_invoice','cancel_invoice','remind_invoice'].includes(input.kind)||typeof input.milestoneId!=='string'||!Number.isSafeInteger(input.expectedRevision))throw new ScopedAccessError(400,'Exact installment and revision required');
 const admit=()=>{selected(ctx,input.milestoneId,input.expectedRevision);};
 const r=selected(ctx,input.milestoneId,input.expectedRevision),terms=approvedInstallmentTerms(r.id,admit),binding=identity(r,terms);
 let target={primary:[config.paypalBuyerEmail],merchant:terms.merchantEmail,cc:[] as string[]};
 if(input.kind!=='issue_approved_invoice'){
  if(!r.provider_id)fail('Issue this installment before preparing a notification');
  const detail=await paypal.getInvoice(r.provider_id,()=>{admit();return true;});admit();
  requireUnpaidInvoice(detail,terms);if(detail.raw.detail?.invoice_number!==terms.invoiceNumber)fail('Invoice number differs');target=recipients(detail);
 }
 const fresh=selected(ctx,input.milestoneId,input.expectedRevision);
 if(contentHash(identity(fresh,approvedInstallmentTerms(r.id,admit)))!==contentHash(binding))fail('Installment changed during preparation');
 const id=randomUUID(),preview={id,...input,orderId:r.order_id,invoiceRecordId:r.id,invoiceId:r.provider_id??null,title:r.title,amountMinor:r.amount_minor,currency:terms.currency,binding,recipients:target,
  notification:{send_to_recipient:true,send_to_invoicer:false,additional_recipients:target.cc},
  wording:input.kind==='issue_approved_invoice'?'Issue only this approved installment.':`PayPal will ${input.kind==='cancel_invoice'?'cancel':'send a reminder for'} only this invoice and notify the displayed recipients. Approved work remains committed. Notification delivery is unverified.`,
  expiresAt:new Date(Math.min(Date.now()+600000,Date.parse(sessionForContext(ctx).expiresAt))).toISOString()};
 const previewHash=contentHash(preview);
 db.prepare("INSERT INTO installment_actions VALUES(?,?,?,?,?,?,'prepared',NULL,?)").run(id,ctx.projectId,ctx.runId,ctx.actorId,JSON.stringify(preview),previewHash,new Date().toISOString());
 return {...preview,previewHash};
}
/** Repeated/uncertain confirmations inspect stored results; they never resend a notification. */
export async function confirmMilestoneAction(ctx:ActorContext,id:string,input:{previewHash:string;consent:boolean}){
 const row=owned(ctx,id);
 if(!input||Object.keys(input).some(k=>!['previewHash','consent'].includes(k))||input.consent!==true)throw new ScopedAccessError(400,'Explicit consent is required');
 if(input.previewHash!==row.preview_hash)fail('Confirm the exact displayed preview hash');
 const running=flights.get(id);if(running){const result=await running;owned(ctx,id);return result;}
 const task=execute(ctx,row).finally(()=>flights.delete(id));flights.set(id,task);return task;
}
async function execute(ctx:ActorContext,row:any){
 const p=JSON.parse(row.preview_json),id=row.id;
 const guard=()=>{
  const live=owned(ctx,id),r=selected(ctx,p.milestoneId,p.expectedRevision);
  if(p.invoiceId&&r.provider_id!==p.invoiceId)fail('Invoice association changed');
  if(p.kind==='issue_approved_invoice'&&contentHash(p.recipients.primary)!==contentHash([config.paypalBuyerEmail]))fail('Invoice recipient changed after preview');
  if(live.state==='prepared'&&Date.parse(p.expiresAt)<=Date.now())fail('Installment preview expired');
  if(contentHash(p)!==row.preview_hash||contentHash(identity(r,approvedInstallmentTerms(r.id,()=>{owned(ctx,id);})))!==contentHash(p.binding))fail('Approved installment identity or terms changed');
  return r;
 };
 if(row.state!=='prepared'){
  // Recovery is read-only. A later provider observation may resolve an uncertain cancellation.
  if(['uncertain','executing','succeeded'].includes(row.state)&&p.invoiceId&&p.kind==='cancel_invoice'){
   guard();try{
    const view=await refreshInvoiceRecord(p.invoiceRecordId,()=>{guard();});guard();
    if(view.financialState?.invoiceState==='cancelled'){
     const result=saveResult(id,'succeeded','PayPal cancellation confirmed; local payment status updated',{localProjection:'applied'});finishOutbound(id,'reconciled',result);return result;
    }
   }catch{owned(ctx,id);}
  }
  owned(ctx,id);return row.result_json?JSON.parse(row.result_json):{id,state:'uncertain',message:'Execution interrupted; inspect provider outcome without resending'};
 }
 const r=guard();
 if(p.kind!=='issue_approved_invoice'){
  const detail=await paypal.getInvoice(p.invoiceId,()=>{guard();return true;});guard();requireUnpaidInvoice(detail,{...p.binding.terms,invoiceId:p.invoiceId});
  if(detail.raw.detail?.invoice_number!==p.binding.terms.invoiceNumber||contentHash(recipients(detail))!==contentHash(p.recipients))fail('Invoice recipients or number changed');
 }
 transaction(()=>{
  guard();
  if(p.kind!=='issue_approved_invoice')claimOutbound({id,runId:ctx.runId,authority:'human_review',actionId:id,kind:p.kind==='cancel_invoice'?'cancel':'reminder',invoiceId:p.invoiceId,approvalAt:p.binding.approval.created_at});
  db.prepare("UPDATE installment_actions SET state='executing' WHERE id=? AND state='prepared'").run(id);
 });
 let dispatched=false,acknowledged=false;
 try{
  if(p.kind==='issue_approved_invoice'){
   const view=await ensureInstallmentInvoice(r.id,()=>{guard();});owned(ctx,id);
   return saveResult(id,'succeeded','Approved installment invoice issued',{invoiceRecordId:r.id,invoiceId:view.paypalInvoiceId});
  }
  await paypal.notifyInvoice(p.invoiceId,p.kind==='cancel_invoice'?'cancel':'remind',p.notification,()=>{guard();return true;},()=>{guard();beginOutbound(id);dispatched=true;});
  acknowledged=true;const result=saveResult(id,'succeeded','PayPal acknowledged this invoice action; notification delivery is unverified',{localProjection:p.kind==='cancel_invoice'?'pending':undefined});finishOutbound(id,'acknowledged',result);
  owned(ctx,id);
  if(p.kind==='cancel_invoice'){
   try{const view=await refreshInvoiceRecord(r.id,()=>{guard();});owned(ctx,id);if(view.financialState?.invoiceState==='cancelled')return saveResult(id,'succeeded','PayPal cancellation confirmed; local payment status updated',{localProjection:'applied'});}catch{owned(ctx,id);}
  }
  return result;
 }catch(error){
  // A known acknowledgement is durable even if its readback or caller authority later fails.
  if(!acknowledged){
   const uncertain=dispatched||p.kind==='issue_approved_invoice'&&!!db.prepare('SELECT operation_key FROM invoice_operations WHERE operation_key=?').get(r.operation_key);
   const result=saveResult(id,uncertain?'uncertain':'denied',uncertain?'Provider outcome uncertain; check without resending':'Action was not dispatched');
   if(p.kind!=='issue_approved_invoice')finishOutbound(id,uncertain?'uncertain':'denied',result,error instanceof paypal.PayPalRequestError?error.retryAfterAt:null);
  }
  if(error instanceof ScopedAccessError)throw error;
  owned(ctx,id);return JSON.parse((db.prepare('SELECT result_json FROM installment_actions WHERE id=?').get(id) as any).result_json);
 }
}
