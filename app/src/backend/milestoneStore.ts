import {createHash} from 'node:crypto';
import {db} from './db.js';
import {config} from './env.js';
import {legacyAssociationIssue} from './milestoneMigration.js';
import {contentHash} from './scopePersistence.js';
import type {MilestoneSchedule,MilestoneView,InstallmentSummary,FinancialState} from '../shared/types.js';

export const invoiceRoute=()=>createHash('sha256').update(`${config.paypalEnv}:${config.paypalMerchantEmail.trim().toLowerCase()}:${config.paypalClientId}`).digest('hex');
export const defaultSchedule=(total:number):MilestoneSchedule=>({milestones:[{id:'upfront',title:'Approved work',amountMinor:total,dueTrigger:'proposal_approval',acceptanceCriteria:['Deliver the approved change-order items']}],workStartPaymentMilestoneIds:['upfront']});
export function validateMilestoneSchedule(schedule:unknown,total:number):asserts schedule is MilestoneSchedule {
 const s=schedule as MilestoneSchedule;
 const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
 if(!exact(s,['milestones','workStartPaymentMilestoneIds'])||!Array.isArray(s.milestones)||!s.milestones.length||s.milestones.length>12||!Array.isArray(s.workStartPaymentMilestoneIds)||!s.workStartPaymentMilestoneIds.length)throw new Error('Provide milestone terms and work-start prerequisites');
 const ids=new Set<string>();let sum=0;
 for(const m of s.milestones){
  if(!exact(m,['id','title','amountMinor','dueTrigger','acceptanceCriteria'])||typeof m.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(m.id)||ids.has(m.id)||typeof m.title!=='string'||!m.title.trim()||m.title.length>200||!Number.isSafeInteger(m.amountMinor)||m.amountMinor<=0||!['proposal_approval','delivery_acceptance'].includes(m.dueTrigger)||!Array.isArray(m.acceptanceCriteria)||!m.acceptanceCriteria.length||m.acceptanceCriteria.length>20||m.acceptanceCriteria.some(x=>typeof x!=='string'||!x.trim()||x.length>2000))throw new Error('Invalid milestone identity, amount, trigger or acceptance criteria');
  ids.add(m.id);sum+=m.amountMinor;
 }
 if(!Number.isSafeInteger(sum)||sum!==total)throw new Error('Milestone amounts must sum exactly to the approved total');
 if(new Set(s.workStartPaymentMilestoneIds).size!==s.workStartPaymentMilestoneIds.length||s.workStartPaymentMilestoneIds.some(id=>!s.milestones.some(m=>m.id===id&&m.dueTrigger==='proposal_approval')))throw new Error('Work-start payment prerequisites must identify proposal-approval installments');
}
export function saveSchedule(order:any,schedule:MilestoneSchedule,provenance:string){
 validateMilestoneSchedule(schedule,order.total_minor);
 const at=new Date().toISOString(),legacy=provenance==='legacy_adoption'||provenance==='default_upfront';
 db.prepare('INSERT OR IGNORE INTO milestone_schedules VALUES(?,?,?,?,?,?)').run(order.id,order.revision,JSON.stringify(schedule),contentHash(schedule),provenance,at);
 for(const term of schedule.milestones){
  const id='ms_'+contentHash([order.id,order.revision,term.id]),recordId='ir_'+contentHash(id),op=legacy?`legacy-record:${order.id}:${order.revision}`:`invoice:${recordId}`;
  db.prepare('INSERT OR IGNORE INTO milestones VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,order.id,order.revision,term.id,term.title,term.amountMinor,term.dueTrigger,JSON.stringify(term.acceptanceCriteria),legacy?1:0,at);
  db.prepare("INSERT OR IGNORE INTO invoice_records(id,milestone_id,order_id,project_id,run_id,revision,route,operation_key,state,created_at) VALUES(?,?,?,?,?,?,?,?,'unissued',?)").run(recordId,id,order.id,order.project_id,order.run_id,order.revision,invoiceRoute(),op,at);
 }
}
export function ensureDefaultSchedule(order:any){if(!db.prepare('SELECT order_id FROM milestone_schedules WHERE order_id=? AND revision=?').get(order.id,order.revision))saveSchedule(order,defaultSchedule(order.total_minor),'default_upfront');}
export function copySchedule(order:any,oldRevision:number){
 const old=db.prepare('SELECT schedule_json,provenance FROM milestone_schedules WHERE order_id=? AND revision=?').get(order.id,oldRevision) as any;
 const schedule=old?JSON.parse(old.schedule_json):defaultSchedule(order.total_minor);
 if(schedule.milestones.reduce((n:number,m:any)=>n+m.amountMinor,0)!==order.total_minor)return saveSchedule(order,defaultSchedule(order.total_minor),'default_upfront');
 saveSchedule(order,schedule,old?.provenance??'default_upfront');
}
export function hasExplicitSchedule(orderId:string,revision:number){const row=db.prepare('SELECT provenance FROM milestone_schedules WHERE order_id=? AND revision=?').get(orderId,revision) as any;return row?.provenance==='designer_schedule';}
export function invoiceRecord(id:string){return db.prepare('SELECT r.*,m.local_id,m.title,m.amount_minor,m.due_trigger,m.criteria_json,m.legacy FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id WHERE r.id=?').get(id) as any;}
export function recordByMilestone(id:string){const row=db.prepare('SELECT id FROM invoice_records WHERE milestone_id=?').get(id) as any;return row?invoiceRecord(row.id):null;}
export function recordView(row:any):MilestoneView{return {id:row.milestone_id,localId:row.local_id,orderId:row.order_id,revision:row.revision,title:row.title,amountMinor:row.amount_minor,dueTrigger:row.due_trigger,acceptanceCriteria:JSON.parse(row.criteria_json),invoiceRecordId:row.id,legacy:!!row.legacy,paypalInvoiceId:row.provider_id??null,invoiceUrl:row.payer_url??null,financialState:row.financial_json?JSON.parse(row.financial_json):null,state:row.state};}
export function syncLegacyRecord(order:any){
 const row=db.prepare('SELECT r.id FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id WHERE r.order_id=? AND r.revision=? AND m.legacy=1').get(order.id,order.revision) as any;if(!row)return;
 const op=db.prepare('SELECT * FROM invoice_operations WHERE operation_key=?').get(`invoice:${order.id}`) as any;
 const provider=order.paypal_invoice_id??op?.paypal_invoice_id??null;
 const observation=provider?db.prepare('SELECT * FROM payment_observations WHERE change_order_id=? AND paypal_invoice_id=? ORDER BY id DESC LIMIT 1').get(order.id,provider) as any:null;
 const issue=legacyAssociationIssue(db,order,op),collision=issue||provider&&db.prepare('SELECT id FROM invoice_records WHERE route=? AND provider_id=? AND id<>?').get(invoiceRoute(),provider,row.id);
 if(op)db.prepare('UPDATE invoice_records SET operation_key=? WHERE id=?').run(op.operation_key,row.id);
 db.prepare('UPDATE invoice_records SET provider_id=?,payer_url=?,terms_json=?,financial_json=?,observed_at=?,state=?,adoption_issue=? WHERE id=?').run(collision?null:provider,collision?null:order.invoice_url,op?.approved_terms_json??null,collision?null:observation?.financial_json??null,observation?.checked_at??null,collision?'review_required':op?.state??(provider?'created':'unissued'),issue??(collision?'ambiguous_provider_identity':null),row.id);
 if(provider&&!collision)db.prepare('UPDATE payment_observations SET invoice_record_id=? WHERE change_order_id=? AND paypal_invoice_id=? AND invoice_record_id IS NULL').run(row.id,order.id,provider);
}
export function installmentData(order:any):{milestoneSchedule:MilestoneSchedule;installments:MilestoneView[];installmentSummary:InstallmentSummary}|null {
 const saved=db.prepare('SELECT schedule_json FROM milestone_schedules WHERE order_id=? AND revision=?').get(order.id,order.revision) as any;if(!saved)return null;
 syncLegacyRecord(order);
 const schedule=JSON.parse(saved.schedule_json) as MilestoneSchedule;
 const rows=db.prepare('SELECT id FROM invoice_records WHERE order_id=? AND revision=? ORDER BY rowid').all(order.id,order.revision) as any[];
 const installments=rows.map(x=>recordView(invoiceRecord(x.id)));
 let due=0,gross=0,refunded=0,net=0,invoiced=0,future=0;const unknown:string[]=[];
 for(const m of installments){
  const f=m.financialState;
  if(m.state==='unissued'&&!m.paypalInvoiceId){future+=m.amountMinor;continue;}
  if(m.paypalInvoiceId)invoiced+=m.amountMinor;
  if(!f||!['due','not_started','paid','partial','refunded','partially_refunded'].includes(f.paymentState)||f.issues.length){unknown.push(m.invoiceRecordId);continue;}
  // These validated states establish zero paid/refunded when an optional group is absent.
  // Raw per-invoice observations keep their nulls; malformed evidence never reaches this branch.
  const paid=f.paidMinor??0,refund=f.refundedMinor??0;gross+=paid;refunded+=refund;net+=paid-refund;
  if(f.invoiceState==='payable'||f.invoiceState==='scheduled'){if(f.amountDueMinor===null)unknown.push(m.invoiceRecordId);else due+=f.amountDueMinor;}
 }
 const fullyPaid=(m:MilestoneView)=>m.financialState?.paymentState==='paid'&&m.financialState.paidMinor===m.amountMinor&&(m.financialState.refundedMinor??0)===0&&!m.financialState.issues.length;
 const summary:InstallmentSummary={approvedTotalMinor:order.total_minor,invoicedMinor:invoiced,payableDueMinor:unknown.length?null:due,futureUnbilledMinor:future,grossPaidMinor:unknown.length?null:gross,refundedMinor:unknown.length?null:refunded,netPaidMinor:unknown.length?null:net,unknownRecordIds:unknown,allObligationsPaid:installments.length>0&&installments.every(fullyPaid),workStartSatisfied:schedule.workStartPaymentMilestoneIds.length>0&&schedule.workStartPaymentMilestoneIds.every(id=>{const m=installments.find(x=>x.localId===id);return !!m&&fullyPaid(m);})};
 return {milestoneSchedule:schedule,installments,installmentSummary:summary};
}
