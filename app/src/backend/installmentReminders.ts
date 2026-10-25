import {randomUUID} from 'node:crypto';
import {db,transaction,currentRunId,assertRunActive} from './db.js';
import {requireDesignerContext,sessionForContext,ScopedAccessError,type ActorContext} from './context.js';
import {activeGrant,credentialHash} from './judgeAccess.js';
import {getScopedOrder} from './changeOrderService.js';
import {getChangeOrder,isTombstonedInvoice} from './orders.js';
import {invoiceRecord,invoiceRoute} from './milestoneStore.js';
import {approvedInstallmentTerms} from './milestones.js';
import {contentHash} from './scopePersistence.js';
import {claimOutbound,beginOutbound,finishOutbound,requireUnpaidInvoice,reminderHistory} from './outboundActions.js';
import {enqueueJob,registerJobHandler,InternalJobFailure,type Job} from './jobs.js';
import * as paypal from './paypal.js';
import {config} from './env.js';
import {invoiceTermProblems} from './paymentState.js';
import type {ReminderInstallment,ReminderPolicyPreview,ReminderPolicyView} from '../shared/types.js';
const DAY=86400000,now=()=>new Date().toISOString();
const fail=(message:string):never=>{throw new ScopedAccessError(409,message);};
const normalized=(value:string)=>value.trim().toLowerCase();
interface BoundRecord {id:string;milestoneId:string;invoiceId:string|null;title:string;amountMinor:number;dueTrigger:string;operationKey:string;dueReviewId:string|null}
interface Binding {projectId:string;runId:string;orderId:string;revision:number;snapshotHash:string;route:string;merchant:string;buyer:string;approvalAt:string;records:BoundRecord[]}
interface Stored {id:string;binding:Binding;coveredRecordIds:string[];version:number;expectedVersion:number;ownerId:string;parentKind:'session'|'grant';parentRef:string;expiresAt:string;reviewExpiresAt:string;enabled:boolean;pausedBy?:string}
interface Payload {version:1;policyId:string;policyVersion:number;invoiceRecordId:string;invoiceId:string;ordinal:number}
function binding(orderId:string,projectId:string,runId:string):Binding {
 assertRunActive(runId);const order=getChangeOrder(orderId);
 if(!order)throw new ScopedAccessError(404,'Installment order not found');
 if(order.projectId!==projectId||order.runId!==runId||order.approvalStatus!=='approved')fail('Select the exact approved installment order');
 const revision=db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?').get(orderId,order.revision) as any;
 const snapshot=revision?JSON.parse(revision.snapshot_json):null;
 const schedule=db.prepare('SELECT schedule_hash FROM milestone_schedules WHERE order_id=? AND revision=?').get(orderId,order.revision) as any;
 const approval=db.prepare("SELECT created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client' ORDER BY id DESC LIMIT 1").get(orderId,order.revision) as any;
 if(!snapshot?.milestoneSchedule||contentHash(snapshot.milestoneSchedule)!==schedule?.schedule_hash||!approval)fail('Immutable approved installment schedule required');
 const merchant=normalized(snapshot.merchantEmail??config.paypalMerchantEmail),buyer=normalized(config.paypalBuyerEmail);
 if(merchant!==normalized(config.paypalMerchantEmail)||!buyer)fail('Approved merchant or reminder recipient configuration changed');
 const rows=db.prepare('SELECT r.*,m.local_id,m.title,m.amount_minor,m.due_trigger,m.criteria_json,m.legacy FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id WHERE r.order_id=? AND r.revision=? ORDER BY r.id').all(orderId,order.revision) as any[];
 if(!rows.length||rows.some(r=>r.legacy||r.adoption_issue||r.route!==invoiceRoute()||r.project_id!==projectId||r.run_id!==runId))fail('Only current canonical installment records support automatic reminders');
 if(rows.length!==snapshot.milestoneSchedule.milestones.length||rows.some(r=>{
  const term=snapshot.milestoneSchedule.milestones.find((m:any)=>m.id===r.local_id);
  return !term||term.title!==r.title||term.amountMinor!==r.amount_minor||term.dueTrigger!==r.due_trigger||contentHash(term.acceptanceCriteria)!==contentHash(JSON.parse(r.criteria_json));
 }))fail('Installment records differ from the immutable approved schedule');
 const records=rows.map(r=>({id:r.id,milestoneId:r.milestone_id,invoiceId:r.provider_id??null,title:r.title,amountMinor:r.amount_minor,dueTrigger:r.due_trigger,operationKey:r.operation_key,dueReviewId:(db.prepare('SELECT review_id FROM milestone_due_events WHERE milestone_id=? AND revision=?').get(r.milestone_id,order.revision) as any)?.review_id??null}));
 return {projectId,runId,orderId,revision:order.revision,snapshotHash:contentHash(snapshot),route:invoiceRoute(),merchant,buyer,approvalAt:approval.created_at,records};
}
function parentLive(p:Stored) {
 if(Date.parse(p.expiresAt)<=Date.now())return false;
 if(p.parentKind==='grant'){const grant=activeGrant(p.parentRef);return !!grant&&grant.run_id===p.binding.runId&&grant.role==='designer';}
 if(p.binding.runId!==currentRunId())return false;
 // Explicit delegation follows the existing policy contract: expiry of the session
 // does not revoke consent, while explicit revocation or run reset does.
 return (db.prepare("SELECT token FROM sessions WHERE project_id=? AND run_id=? AND role='designer' AND revoked=0").all(p.binding.projectId,p.binding.runId) as any[]).some(row=>credentialHash(row.token)===p.parentRef);
}
function head(orderId:string){return db.prepare('SELECT * FROM installment_reminder_heads WHERE order_id=?').get(orderId) as any;}
function live(p:Stored) {
 const current=head(p.binding.orderId);
 if(!p.enabled||!current||current.policy_id!==p.id||current.version!==p.version||current.disabled_at||!parentLive(p))return false;
 try{return contentHash(binding(p.binding.orderId,p.binding.projectId,p.binding.runId))===contentHash(p.binding);}catch{return false;}
}
function eligibleAt(p:Stored,r:BoundRecord):number|null {
 if(!r.invoiceId||isTombstonedInvoice(r.invoiceId))return null;
 const op=db.prepare("SELECT updated_at,state FROM invoice_operations WHERE operation_key=? AND paypal_invoice_id=?").get(r.operationKey,r.invoiceId) as any;
 const due=r.dueTrigger==='proposal_approval'?p.binding.approvalAt:(db.prepare('SELECT created_at FROM milestone_due_events WHERE milestone_id=? AND revision=?').get(r.milestoneId,p.binding.revision) as any)?.created_at;
 if(!op||op.state!=='sent'||!due)return null;
 // updated_at is the most recent durable known-send eligibility, never an inferred
 // earlier approval date. Recovery may move this conservative clock later.
 const dates=[p.binding.approvalAt,due,op.updated_at].map(Date.parse);
 return dates.every(Number.isFinite)?Math.max(...dates):null;
}
function installments(p:Stored):ReminderInstallment[]{return p.binding.records.map(r=>{
 const history=r.invoiceId?reminderHistory(r.invoiceId):{automaticAttempts:0,lastAttemptAt:null,blocked:false},covered=p.coveredRecordIds.includes(r.id),anchor=covered?eligibleAt(p,r):null;
 const last=history.lastAttemptAt?Date.parse(history.lastAttemptAt):0;
 return {milestoneId:r.milestoneId,invoiceRecordId:r.id,invoiceId:r.invoiceId,title:r.title,amountMinor:r.amountMinor,currency:getChangeOrder(p.binding.orderId)?.currency??'USD',dueTrigger:r.dueTrigger,automaticAttempts:history.automaticAttempts,lastAttemptAt:history.lastAttemptAt,covered,actionBlocked:history.blocked,earliestReminderAt:anchor===null?null:new Date(Math.max(anchor,last)+DAY).toISOString()};
});}
function view(p:Stored):ReminderPolicyView {
 const last=db.prepare(`SELECT o.state,o.attempted_at,o.result_json,j.payload_json,policy.id policy_id,policy.version policy_version
 FROM outbound_operations o JOIN jobs j ON j.id=o.outbox_id JOIN installment_reminder_policies policy
 ON policy.id=CASE WHEN json_valid(j.payload_json) THEN json_extract(j.payload_json,'$.policyId') END
 WHERE j.kind='installment_reminder' AND policy.project_id=? AND policy.run_id=? AND policy.order_id=? AND o.run_id=policy.run_id
 ORDER BY o.created_at DESC,o.outbox_id DESC LIMIT 1`).get(p.binding.projectId,p.binding.runId,p.binding.orderId) as any;
 return {id:p.id,orderId:p.binding.orderId,revision:p.binding.revision,version:p.version,parentKind:p.parentKind,expiresAt:p.expiresAt,recipients:{primary:[p.binding.buyer],merchant:p.binding.merchant},installments:installments(p),cadenceMs:DAY,maxAutomaticReminders:2,status:!p.enabled?'paused':Date.parse(p.expiresAt)<=Date.now()?'expired':live(p)?'active':'inactive',...(last?{lastResult:{policyId:last.policy_id,policyVersion:last.policy_version,invoiceRecordId:JSON.parse(last.payload_json).invoiceRecordId,state:last.state,attemptedAt:last.attempted_at,message:last.result_json?JSON.parse(last.result_json).message:'Dispatch outcome requires review'}}:{})};
}
export function getInstallmentReminderPolicy(ctx:ActorContext,orderId:string):ReminderPolicyView|null {
 requireDesignerContext(ctx);getScopedOrder(ctx,orderId);const current=head(orderId);
 const row=current&&db.prepare('SELECT policy_json FROM installment_reminder_policies WHERE id=? AND project_id=? AND run_id=?').get(current.policy_id,ctx.projectId,ctx.runId) as any;
 return row?view(JSON.parse(row.policy_json)):null;
}
function checkInvoice(detail:paypal.InvoiceDetail,p:Stored,r:BoundRecord,terms:ReturnType<typeof approvedInstallmentTerms>){
 requireUnpaidInvoice(detail,terms);
 const primary=(detail.raw.primary_recipients??[]).map((recipient:any)=>recipient.billing_info?.email_address);
 const cc=detail.raw.additional_recipients??[];
 if(detail.raw.detail?.invoice_number!==terms.invoiceNumber||primary.length!==1||typeof primary[0]!=='string'||normalized(primary[0])!==p.binding.buyer||normalized(detail.raw.invoicer?.email_address??'')!==p.binding.merchant||!Array.isArray(cc)||cc.length)fail('Reviewed invoice recipient, merchant or number changed; automatic reminders require no CC recipients');
 if(detail.id!==r.invoiceId)fail('Exact installment invoice association changed');
}
export async function prepareInstallmentReminderPolicy(ctx:ActorContext,orderId:string,expectedRevision:number):Promise<ReminderPolicyPreview> {
 requireDesignerContext(ctx);const order=getScopedOrder(ctx,orderId);
 if(!Number.isSafeInteger(expectedRevision)||order.revision!==expectedRevision)fail('Proposal revision changed');
 const initial=binding(orderId,ctx.projectId,ctx.runId),session=sessionForContext(ctx),grant=session.grantId?activeGrant(session.grantId):null;
 if(session.grantId&&!grant)throw new ScopedAccessError(401,'Designer parent access ended');
 const expectedVersion=head(orderId)?.version??0,id=randomUUID();
 const p:Stored={id,binding:initial,coveredRecordIds:[],expectedVersion,version:expectedVersion+1,ownerId:ctx.actorId,parentKind:grant?'grant':'session',parentRef:grant?grant.id:credentialHash(session.token),expiresAt:new Date(Math.min(Date.now()+DAY,grant?Date.parse(grant.expires_at):Infinity)).toISOString(),reviewExpiresAt:new Date(Math.min(Date.now()+600000,Date.parse(session.expiresAt))).toISOString(),enabled:true};
 const guard=()=>{requireDesignerContext(ctx);getScopedOrder(ctx,orderId);if(contentHash(binding(orderId,ctx.projectId,ctx.runId))!==contentHash(initial))fail('Approved installment identity changed while reviewing reminders');};
 for(const r of initial.records)if(r.invoiceId){
  const terms=approvedInstallmentTerms(r.id,guard),detail=await paypal.getInvoice(r.invoiceId,()=>{guard();return true;});guard();
  if(invoiceTermProblems(detail,terms).length||detail.raw.detail?.invoice_number!==terms.invoiceNumber)fail('Installment invoice differs from approved terms');
  if(['SENT','UNPAID'].includes(detail.status)&&detail.amountDueMinor===terms.totalMinor&&!detail.raw.payments&&!detail.raw.refunds){checkInvoice(detail,p,r,terms);p.coveredRecordIds.push(r.id);}
 }
 if(!p.coveredRecordIds.length)fail('No issued fully unpaid installment can be included; check payment and review again');
 guard();const previewHash=contentHash(p);
 db.prepare('INSERT INTO installment_reminder_previews(id,project_id,run_id,order_id,owner_id,preview_json,preview_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,ctx.projectId,ctx.runId,orderId,ctx.actorId,JSON.stringify(p),previewHash,now());
 const {status,lastResult,...publicView}=view(p);return {...publicView,previewHash,reviewExpiresAt:p.reviewExpiresAt};
}
export function confirmInstallmentReminderPolicy(ctx:ActorContext,id:string,input:{previewHash:string;consent:boolean}):ReminderPolicyView {
 requireDesignerContext(ctx);
 if(!input||Object.keys(input).some(k=>!['previewHash','consent'].includes(k))||input.consent!==true)throw new ScopedAccessError(400,'Explicit reminder policy consent required');
 return transaction(()=>{
  const row=db.prepare('SELECT * FROM installment_reminder_previews WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
  if(!row)throw new ScopedAccessError(404,'Reminder preview not found');
  const p:Stored=JSON.parse(row.preview_json);getScopedOrder(ctx,p.binding.orderId);
  if(row.owner_id!==ctx.actorId)throw new ScopedAccessError(403,'Reminder preview belongs to another designer');
  if(row.consumed_at||row.preview_hash!==input.previewHash||contentHash(p)!==row.preview_hash||Date.parse(p.reviewExpiresAt)<=Date.now()||!parentLive(p)||(head(p.binding.orderId)?.version??0)!==p.expectedVersion||contentHash(binding(p.binding.orderId,ctx.projectId,ctx.runId))!==contentHash(p.binding))fail('Reminder preview expired, changed or already used; review fresh terms');
  save(p);db.prepare('UPDATE installment_reminder_previews SET consumed_at=? WHERE id=?').run(now(),id);return view(p);
 });
}
function save(p:Stored){
 db.prepare('INSERT INTO installment_reminder_policies(id,project_id,run_id,order_id,revision,version,policy_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(p.id,p.binding.projectId,p.binding.runId,p.binding.orderId,p.binding.revision,p.version,JSON.stringify(p),now());
 db.prepare('INSERT INTO installment_reminder_heads(order_id,policy_id,version,disabled_at) VALUES(?,?,?,NULL) ON CONFLICT(order_id) DO UPDATE SET policy_id=excluded.policy_id,version=excluded.version,disabled_at=NULL').run(p.binding.orderId,p.id,p.version);
}
export function pauseInstallmentReminderPolicy(ctx:ActorContext,id:string,expectedVersion:number):ReminderPolicyView {
 requireDesignerContext(ctx);return transaction(()=>{
  const row=db.prepare('SELECT policy_json FROM installment_reminder_policies WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
  if(!row)throw new ScopedAccessError(404,'Reminder policy not found');const old:Stored=JSON.parse(row.policy_json);getScopedOrder(ctx,old.binding.orderId);
  if(old.version!==expectedVersion||head(old.binding.orderId)?.policy_id!==id)fail('Reminder policy version changed');
  const p={...old,id:randomUUID(),expectedVersion:old.version,version:old.version+1,enabled:false,pausedBy:ctx.actorId};save(p);return view(p);
 });
}
function selected(p:Stored,recordId:string){
 if(!live(p))throw new InternalJobFailure('reminder_authority_changed');
 const r=p.binding.records.find(record=>record.id===recordId);if(!r?.invoiceId||isTombstonedInvoice(r.invoiceId)||!p.coveredRecordIds.includes(recordId))throw new InternalJobFailure('reminder_association_changed');
 const record=invoiceRecord(recordId),financial=record?.financial_json?JSON.parse(record.financial_json):null;
 if(financial&&(financial.invoiceState!=='payable'||financial.paymentState!=='due'||financial.amountDueMinor!==r.amountMinor))throw new InternalJobFailure('reminder_not_eligible');
 const anchor=eligibleAt(p,r),history=reminderHistory(r.invoiceId);
 if(anchor===null||Date.now()-anchor<DAY||history.lastAttemptAt&&Date.now()-Date.parse(history.lastAttemptAt)<DAY||history.automaticAttempts>=2||history.blocked)throw new InternalJobFailure('reminder_not_eligible');
 return {r,anchor,history};
}
function stored(id:string):Stored {const row=db.prepare('SELECT policy_json FROM installment_reminder_policies WHERE id=?').get(id) as any;if(!row)throw new InternalJobFailure('reminder_policy_missing');return JSON.parse(row.policy_json);}
export function queueInstallmentReminders(at:Date):number {
 if(!Number.isFinite(at.getTime()))throw new Error('Invalid reminder cycle time');let queued=0;
 for(const row of db.prepare('SELECT p.policy_json FROM installment_reminder_policies p JOIN installment_reminder_heads h ON h.policy_id=p.id WHERE h.disabled_at IS NULL').all() as any[]){
  const p:Stored=JSON.parse(row.policy_json);if(!live(p))continue;
  for(const r of p.binding.records){
   try{const {history}=selected(p,r.id);const key=`installment-reminder:${p.id}:${r.id}:${history.automaticAttempts+1}`;
    if(db.prepare('SELECT id FROM jobs WHERE job_key=?').get(key))continue;
    const payload:Payload={version:1,policyId:p.id,policyVersion:p.version,invoiceRecordId:r.id,invoiceId:r.invoiceId!,ordinal:history.automaticAttempts+1};
    enqueueJob({key,kind:'installment_reminder',projectId:p.binding.projectId,runId:p.binding.runId,payload,dueAt:at.toISOString()});queued++;
   }catch(error){if(!(error instanceof InternalJobFailure))throw error;}
  }
 }
 return queued;
}
function validate(payload:any):asserts payload is Payload {
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['version','policyId','policyVersion','invoiceRecordId','invoiceId','ordinal'].includes(k))||payload.version!==1||!['policyId','invoiceRecordId','invoiceId'].every(k=>typeof payload[k]==='string'&&payload[k].length>0&&payload[k].length<=200)||!Number.isSafeInteger(payload.policyVersion)||payload.policyVersion<1||!Number.isSafeInteger(payload.ordinal)||payload.ordinal<1||payload.ordinal>2)throw new Error('Invalid installment reminder payload');
}
registerJobHandler('installment_reminder',{
 validate,resource:p=>p.policyId+':'+p.invoiceRecordId,queue:queueInstallmentReminders,
 retry(job,p){if(db.prepare('SELECT outbox_id FROM outbound_operations WHERE outbox_id=?').get(job.id))fail('Recorded reminder outcome requires review; automatic replay is unavailable');selected(stored(p.policyId),p.invoiceRecordId);},
 async execute(job:Job,payload:Payload,lease){
  const p=stored(payload.policyId);
  if(p.binding.projectId!==job.project_id||p.binding.runId!==job.run_id||p.version!==payload.policyVersion)throw new InternalJobFailure('reminder_association_changed');
  const guard=()=>{lease();const value=selected(p,payload.invoiceRecordId);if(value.r.invoiceId!==payload.invoiceId||value.history.automaticAttempts+1!==payload.ordinal)throw new InternalJobFailure('reminder_association_changed');return value;};
  const prior=db.prepare('SELECT * FROM outbound_operations WHERE outbox_id=?').get(job.id) as any;
  if(prior){if(['acknowledged','reconciled'].includes(prior.state))return;throw new InternalJobFailure('notification_uncertain');}
  const {r,anchor}=guard(),terms=approvedInstallmentTerms(r.id,()=>{guard();});
  const detail=await paypal.getInvoice(payload.invoiceId,()=>{guard();return true;});guard();checkInvoice(detail,p,r,terms);
  guard();claimOutbound({id:job.id,runId:job.run_id,authority:'policy',actionId:p.id,kind:'reminder',invoiceId:payload.invoiceId,approvalAt:new Date(anchor).toISOString()});
  let dispatched=false;
  // Once this operation owns the invoice lock, its own claim is not a competing block.
  const dispatchGuard=()=>{lease();if(!live(p)||invoiceRecord(r.id)?.provider_id!==payload.invoiceId)throw new InternalJobFailure('reminder_authority_changed');approvedInstallmentTerms(r.id,()=>{lease();});};
  try {
   await paypal.notifyInvoice(payload.invoiceId,'remind',{send_to_recipient:true,send_to_invoicer:false,additional_recipients:[]},()=>{dispatchGuard();return true;},()=>{dispatchGuard();beginOutbound(job.id);dispatched=true;});
   finishOutbound(job.id,'acknowledged',{message:'PayPal acknowledged the exact installment reminder; recipient delivery is unverified',invoiceRecordId:r.id});
  }catch(error){
   const refused=error instanceof paypal.PayPalRequestError&&error.status!==null&&error.status>=400&&error.status<500,uncertain=dispatched&&!refused;
   finishOutbound(job.id,uncertain?'uncertain':'denied',{message:uncertain?'Reminder outcome is uncertain; inspect without resending':refused?'PayPal refused the reminder; review provider limits before another attempt':'Reminder was not dispatched',invoiceRecordId:r.id},error instanceof paypal.PayPalRequestError?error.retryAfterAt:null);
   throw new InternalJobFailure(uncertain?'notification_uncertain':refused?'notification_refused':'reminder_not_dispatched');
  }
 }
});
