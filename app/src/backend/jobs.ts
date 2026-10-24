import { randomUUID, createHash } from "node:crypto";
import { db, transaction, assertRunActive } from "./db.js";
import { config } from "./env.js";
import { getChangeOrder, refreshPaymentStatus, isTombstonedInvoice } from "./orders.js";
import { PayPalRequestError } from "./paypal.js";
import {refreshInvoiceRecord} from './milestones.js';
import {invoiceRecord} from './milestoneStore.js';

export type JobKind = "paypal_reconcile" | "figma_refresh" | "scope_assess";
export interface InternalJobHandler {
  validate(payload:unknown):void;
  resource(payload:any):string;
  execute(job:Job,payload:any,guard:()=>void):Promise<void>;
  retry(job:Job,payload:any):void;
  blocksFailure?(job:Job):boolean;
}
const handlers=new Map<JobKind,InternalJobHandler>();
/** Internal registration only; payload JSON cannot install executable handlers. */
export function registerJobHandler(kind:Exclude<JobKind,'paypal_reconcile'>,handler:InternalJobHandler){
  if(handlers.has(kind))throw new Error('Job kind already registered');handlers.set(kind,handler);
}
export interface JobRunSummary { completed: number; retried: number; failed: number }
export const UNMATCHED_PROJECT="__paypal_unmatched__", UNMATCHED_RUN="__unbound__";
export const paypalRoute=createHash("sha256").update(`${config.paypalEnv}:${config.paypalMerchantEmail.trim().toLowerCase()}:${config.paypalClientId}`).digest("hex");
export interface ReconcilePayload { invoiceId: string; route: string; receiptId?: string; periodic?: boolean; anchor?: string; firstPaidAt?: string }
function validatePayPal(p:ReconcilePayload){
  if(!p || typeof p.invoiceId!=="string" || !p.invoiceId || p.invoiceId.length>200 || p.route!==paypalRoute ||
    (p.receiptId!==undefined && (typeof p.receiptId!=="string" || !p.receiptId || p.receiptId.length>200)) ||
    (p.periodic!==undefined && typeof p.periodic!=="boolean") ||
    (p.periodic && (!p.anchor || !Number.isFinite(Date.parse(p.anchor)))) ||
    (p.firstPaidAt!==undefined && !Number.isFinite(Date.parse(p.firstPaidAt))) ||
    Object.keys(p).some(k=>!["invoiceId","route","receiptId","periodic","anchor","firstPaidAt"].includes(k)) || JSON.stringify(p).length>2000)throw new Error("Invalid reconciliation job payload");
}
function validatePayload(kind:JobKind,p:unknown){
  if(kind==='paypal_reconcile')validatePayPal(p as ReconcilePayload);
  else {const h=handlers.get(kind);if(!h)throw new Error('Unsupported job kind');h.validate(p);}
}
export function enqueueJob(input:{key:string;kind:JobKind;projectId:string;runId:string;payload:unknown;dueAt:string}):string {
  if(!input.key||input.key.length>500||!input.projectId||!input.runId||!Number.isFinite(Date.parse(input.dueAt)))throw new Error('Invalid job');
  validatePayload(input.kind,input.payload);const p=input.payload;
  const payload=JSON.stringify(p), existing=db.prepare("SELECT * FROM jobs WHERE job_key=?").get(input.key);
  if(existing){if(existing.kind!==input.kind || existing.payload_json!==payload || existing.project_id!==input.projectId || existing.run_id!==input.runId)throw new Error("Conflicting reconciliation job key");return String(existing.id);}
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare("INSERT INTO jobs (id,job_key,kind,project_id,run_id,payload_json,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id,input.key,input.kind,input.projectId,input.runId,payload,new Date(input.dueAt).toISOString(),now,now);
  return id;
}

export interface Job { id:string;kind:JobKind; project_id:string;run_id:string;payload_json:string;state:string;attempts:number;due_at:string;lease_token:string;lease_until:string;created_at:string;recovery_at:string|null;error_category:string|null;association_fingerprint:string|null }
const DAY=86400000, MAX_ATTEMPTS=8, LEASE_MS=90000;
class LostLease extends Error {}
class LocalFailure extends Error {constructor(public category:string,public retryable=false){super(category);}}
function runtime(key:string,value:string){db.prepare('INSERT INTO job_runtime (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
function payload(job:Job):ReconcilePayload {if(job.kind!=='paypal_reconcile')throw new Error('Unsupported PayPal job kind');const p=JSON.parse(job.payload_json);validatePayPal(p);return p;}
function associations(invoiceId:string):any[] {
  const exact=db.prepare(`SELECT o.id,o.project_id,o.run_id,o.revision,r.provider_id paypal_invoice_id,r.id invoice_record_id,r.terms_json FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id JOIN change_orders o ON o.id=r.order_id AND o.revision=r.revision WHERE r.provider_id=? AND r.route=? AND m.legacy=0`).all(invoiceId,paypalRoute) as any[];
  const legacy=db.prepare(`SELECT DISTINCT o.id,o.project_id,o.run_id,o.revision,o.paypal_invoice_id FROM change_orders o
    LEFT JOIN invoice_operations i ON i.change_order_id=o.id WHERE o.paypal_invoice_id=? OR i.paypal_invoice_id=?`).all(invoiceId,invoiceId);
  return [...exact,...legacy.filter(o=>!exact.some(r=>r.id===o.id))];
}
function match(p:ReconcilePayload):any|null {
  if(p.route!==paypalRoute)throw new LocalFailure('route_mismatch');
  if(isTombstonedInvoice(p.invoiceId))throw new LocalFailure('tombstoned');
  const candidates=associations(p.invoiceId);
  if(candidates.length>1)throw new LocalFailure('ambiguous_association');
  const a=candidates[0];if(!a || a.paypal_invoice_id!==p.invoiceId)return null;
  try{assertRunActive(a.run_id);}catch{throw new LocalFailure('tombstoned');}
  const op=db.prepare('SELECT approved_terms_json FROM invoice_operations WHERE change_order_id=? AND paypal_invoice_id=?').get(a.id,p.invoiceId);
  if(op?.approved_terms_json){
    const terms=JSON.parse(String(op.approved_terms_json));
    if(terms.merchantEmail?.trim().toLowerCase()!==config.paypalMerchantEmail.trim().toLowerCase())throw new LocalFailure('merchant_mismatch');
  }
  const order=getChangeOrder(a.id);if(order?.approvalStatus!=='approved')throw new LocalFailure('approval_required');
  return a;
}
function fingerprint(a:any){return `${a.id}:${a.project_id}:${a.run_id}:${a.revision}:${a.paypal_invoice_id}`+(a.invoice_record_id?`:${a.invoice_record_id}:${createHash('sha256').update(a.terms_json??'').digest('hex')}`:'');}
function owns(job:Job,now:Date):boolean {
  return !!db.prepare("SELECT id FROM jobs WHERE id=? AND state='running' AND lease_token=? AND lease_until>?").get(job.id,job.lease_token,now.toISOString());
}
function receipt(job:Job,state:string,now:Date){if(job.kind!=='paypal_reconcile')return;let p;try{p=payload(job);}catch{return;}if(p.receiptId)db.prepare('UPDATE webhook_receipts SET state=?,processed_at=? WHERE id=? AND job_id=?').run(state,now.toISOString(),p.receiptId,job.id);}
function finish(job:Job,state:string,category:string|null,now:Date){
  db.prepare("UPDATE jobs SET state=?,error_category=?,lease_token=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=? AND lease_token=?")
    .run(state,category,now.toISOString(),now.toISOString(),job.id,job.lease_token);
  receipt(job,state==='completed'?'reconciled':state==='cancelled'?'tombstoned':'failed',now);
}
function firstPaid(orderId:string,invoiceId:string):string|undefined {
  const row=db.prepare("SELECT MIN(checked_at) first FROM payment_observations WHERE change_order_id=? AND paypal_invoice_id=? AND json_extract(financial_json,'$.paymentState')='paid'").get(orderId,invoiceId);
  return typeof row?.first==='string'?row.first:undefined;
}
function nextPoll(orderId:string,p:ReconcilePayload,now:Date):Date|null {
  const order=getChangeOrder(orderId);if(!order)return null;
  const exact=associations(p.invoiceId).find(a=>a.invoice_record_id),record=exact?invoiceRecord(exact.invoice_record_id):null;
  const f=record?.financial_json?JSON.parse(record.financial_json):order.financialState;
  if(f?.paymentState==='review_required' || f?.paymentState==='refunded' || f?.invoiceState==='cancelled')return null;
  if(f?.paymentState==='paid')p.firstPaidAt??=firstPaid(orderId,p.invoiceId)??now.toISOString();
  const anchor=p.firstPaidAt??p.anchor!;
  if(now.getTime()-Date.parse(anchor)>=30*DAY)return null;
  const interval=p.firstPaidAt?(now.getTime()-Date.parse(p.firstPaidAt)<DAY?15*60000:DAY):5*60000;
  return new Date(now.getTime()+interval);
}
function recoverAndSeed(now:Date){transaction(()=>{
  for(const r of db.prepare("SELECT * FROM webhook_receipts WHERE job_id IS NULL AND invoice_id IS NOT NULL AND state IN ('failed','unmatched') AND (route_key IS NULL OR route_key=?)").all(paypalRoute)){
    const p={invoiceId:String(r.invoice_id),route:paypalRoute,receiptId:String(r.id)};
    const id=enqueueJob({key:`paypal:event:${paypalRoute}:${r.id}`,kind:'paypal_reconcile',projectId:UNMATCHED_PROJECT,runId:UNMATCHED_RUN,payload:p,dueAt:now.toISOString()});
    db.prepare("UPDATE webhook_receipts SET job_id=?,route_key=?,state='queued' WHERE id=?").run(id,paypalRoute,r.id);
  }
  // A newly appearing local association may wake an exhausted matching job once.
  for(const row of db.prepare("SELECT * FROM jobs WHERE kind='paypal_reconcile' AND state IN ('pending','failed') AND error_category='unmatched'").all() as unknown as Job[]){
    try{const a=match(payload(row));if(a && row.association_fingerprint!==fingerprint(a))db.prepare("UPDATE jobs SET state='pending',attempts=0,due_at=?,recovery_at=?,association_fingerprint=?,error_category=NULL,project_id=?,run_id=? WHERE id=?").run(now.toISOString(),now.toISOString(),fingerprint(a),a.project_id,a.run_id,row.id);}catch{/* Fail closed; explicit recovery remains visible. */}
  }
  const installmentOrders=db.prepare('SELECT o.*,r.id invoice_record_id,r.provider_id target_invoice_id FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id JOIN change_orders o ON o.id=r.order_id AND o.revision=r.revision WHERE m.legacy=0 AND r.provider_id IS NOT NULL AND r.route=?').all(paypalRoute);
  for(const o of [...db.prepare('SELECT * FROM change_orders WHERE paypal_invoice_id IS NOT NULL').all(),...installmentOrders]){
    o.paypal_invoice_id??=o.target_invoice_id;
    const key=`paypal:poll:${paypalRoute}:${o.invoice_record_id??o.id}`;
    const existing=db.prepare("SELECT * FROM jobs WHERE job_key=? AND kind='paypal_reconcile'").get(key) as unknown as Job|undefined;
    if(existing){
      let p;try{p=payload(existing);}catch{continue;}
      // A first Paid observation can start its own bounded reversal window,
      // but cannot revive failed work or extend an existing Paid anchor.
      const financial=o.invoice_record_id?invoiceRecord(String(o.invoice_record_id))?.financial_json:null;
      if(existing.state==='completed' && !p.firstPaidAt && (financial?JSON.parse(financial).paymentState:getChangeOrder(String(o.id))?.financialState?.paymentState)==='paid'){
        const next=nextPoll(String(o.id),p,now);
        if(next)db.prepare("UPDATE jobs SET state='pending',attempts=0,due_at=?,payload_json=?,completed_at=NULL,updated_at=? WHERE id=?").run(next.toISOString(),JSON.stringify(p),now.toISOString(),existing.id);
      }
      continue;
    }
    if(isTombstonedInvoice(String(o.paypal_invoice_id)))continue;
    // Neither pending events nor exhausted provider work can be bypassed by a poll.
    if(db.prepare("SELECT id FROM jobs WHERE kind='paypal_reconcile' AND json_valid(payload_json) AND json_extract(payload_json,'$.invoiceId')=? AND state IN ('pending','running','failed')").get(o.paypal_invoice_id))continue;
    const operation=db.prepare('SELECT MIN(created_at) anchor FROM invoice_operations WHERE change_order_id=? AND paypal_invoice_id=?').get(o.id,o.paypal_invoice_id);
    const p:ReconcilePayload={invoiceId:String(o.paypal_invoice_id),route:paypalRoute,periodic:true,anchor:String(operation?.anchor??o.created_at)};
    try{if(!match(p))continue;}catch{continue;}
    const next=nextPoll(String(o.id),p,now);
    const id=enqueueJob({key,kind:'paypal_reconcile',projectId:String(o.project_id),runId:String(o.run_id),payload:p,dueAt:(next??now).toISOString()});
    if(!next)db.prepare("UPDATE jobs SET state='completed',completed_at=? WHERE id=?").run(now.toISOString(),id);
  }
});}
function claim(now:Date,visited:string[]):Job|undefined {return transaction(()=>{
  const row=db.prepare(`SELECT j.* FROM jobs j WHERE j.kind='paypal_reconcile' AND ((j.state='pending' AND j.due_at<=?) OR (j.state='running' AND j.lease_until<=?))
    AND j.id NOT IN (SELECT value FROM json_each(?))
    AND NOT EXISTS (SELECT 1 FROM jobs blocker WHERE blocker.kind='paypal_reconcile' AND json_valid(blocker.payload_json) AND json_valid(j.payload_json) AND blocker.id!=j.id
      AND json_extract(blocker.payload_json,'$.invoiceId')=json_extract(j.payload_json,'$.invoiceId')
      AND (blocker.state='failed' OR (blocker.state='pending' AND blocker.error_category IS NOT NULL AND blocker.due_at>?)
        OR (blocker.state='running' AND blocker.lease_until>?))) ORDER BY j.due_at,j.id LIMIT 1`).get(now.toISOString(),now.toISOString(),JSON.stringify(visited),now.toISOString(),now.toISOString());
  if(!row)return;
  const token=randomUUID();db.prepare("UPDATE jobs SET state='running',recovery_at=CASE WHEN attempts=0 THEN ? ELSE recovery_at END,attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(now.toISOString(),token,new Date(now.getTime()+LEASE_MS).toISOString(),now.toISOString(),row.id);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(row.id) as unknown as Job;
});}
export function automaticReconciliationBlocked(invoiceId:string):boolean {
  return !!db.prepare("SELECT id FROM jobs WHERE kind='paypal_reconcile' AND json_valid(payload_json) AND json_extract(payload_json,'$.invoiceId')=? AND (state IN ('failed','running') OR (state='pending' AND error_category IS NOT NULL))").get(invoiceId);
}
async function execute(job:Job,now:Date):Promise<keyof JobRunSummary|null>{
  const start=Date.now(),clock=()=>new Date(now.getTime()+Date.now()-start);let p:ReconcilePayload|undefined;
  try{
    try{p=payload(job);}catch{throw new LocalFailure('invalid_payload');}
    if(job.attempts>MAX_ATTEMPTS || (job.attempts>1 && now.getTime()-Date.parse(job.recovery_at??job.created_at)>=DAY))throw new LocalFailure('retry_exhausted');
    const a=match(p);if(!a)throw new LocalFailure('unmatched',true);
    if(job.project_id!==UNMATCHED_PROJECT && (a.project_id!==job.project_id || a.run_id!==job.run_id))throw new LocalFailure('association_changed');
    transaction(()=>{if(!owns(job,clock()))throw new LostLease();db.prepare('UPDATE jobs SET project_id=?,run_id=?,association_fingerprint=? WHERE id=? AND lease_token=?').run(a.project_id,a.run_id,fingerprint(a),job.id,job.lease_token);});
    const guard=()=>{if(!owns(job,clock()))throw new LostLease();const current=match(p!);if(!current || fingerprint(current)!==fingerprint(a))throw new LocalFailure('association_changed');};
    if(p.periodic && !nextPoll(a.id,p,clock())){transaction(()=>{guard();finish(job,'completed',null,clock());});return 'completed';}
    const completed=()=>{
      guard();const at=clock(),order=getChangeOrder(a.id)!;
      const observed=a.invoice_record_id?invoiceRecord(a.invoice_record_id)?.financial_json:null;
      if((observed?JSON.parse(observed).paymentState:order.financialState?.paymentState)==='review_required'){finish(job,'failed','financial_review',at);return;}
      if(p!.periodic){const next=nextPoll(a.id,p!,at);
        if(next){db.prepare("UPDATE jobs SET state='pending',attempts=0,due_at=?,lease_until=NULL,lease_token=NULL,error_category=NULL,http_status=NULL,payload_json=?,updated_at=?,recovery_at=? WHERE id=? AND lease_token=?").run(next.toISOString(),JSON.stringify(p),at.toISOString(),at.toISOString(),job.id,job.lease_token);return;}
      }
      finish(job,'completed',null,at);
    };
    if(a.invoice_record_id)await refreshInvoiceRecord(a.invoice_record_id,guard,completed);else await refreshPaymentStatus(a.id,guard,completed);
    return db.prepare('SELECT state FROM jobs WHERE id=?').get(job.id)?.state==='failed'?'failed':'completed';
  }catch(error){return transaction(()=>{
    const at=clock();if(error instanceof LostLease || !owns(job,at))return null;
    if((p&&isTombstonedInvoice(p.invoiceId)) || (error instanceof LocalFailure && error.category==='tombstoned')){finish(job,'cancelled','tombstoned',at);return 'completed';}
    const category=error instanceof LocalFailure?error.category:error instanceof PayPalRequestError?error.category:'reconciliation_failure';
    const retryable=error instanceof LocalFailure?error.retryable:error instanceof PayPalRequestError?error.retryable:false;
    const exhausted=job.attempts>=MAX_ATTEMPTS || at.getTime()-Date.parse(job.recovery_at??job.created_at)>=DAY;
    if(!retryable || exhausted){finish(job,'failed',category,at);return 'failed';}
    const backoff=Math.min(15*60000,5000*2**(job.attempts-1))*(1+Math.random()*.2);
    const due=new Date(Math.max(at.getTime()+backoff,error instanceof PayPalRequestError?error.retryAfterAt??0:0));
    db.prepare("UPDATE jobs SET state='pending',due_at=?,lease_until=NULL,lease_token=NULL,error_category=?,http_status=?,updated_at=? WHERE id=? AND lease_token=?")
      .run(due.toISOString(),category,error instanceof PayPalRequestError?error.status:null,at.toISOString(),job.id,job.lease_token);
    receipt(job,category==='unmatched'?'unmatched':'retrying',at);return 'retried';
  });}
}
let running:Promise<JobRunSummary>|null=null,stopping=false;
export function runDueJobs(now:Date):Promise<JobRunSummary>{
  if(running)return running;
  running=(async()=>{
    const summary:JobRunSummary={completed:0,retried:0,failed:0};
    try{
      runtime('last_cycle',now.toISOString());
      db.prepare("UPDATE jobs SET state='failed',error_category='unsupported_kind',lease_token=NULL,lease_until=NULL,updated_at=? WHERE kind NOT IN ('paypal_reconcile','figma_refresh','scope_assess') AND (state='pending' OR (state='running' AND lease_until<=?))").run(now.toISOString(),now.toISOString());
      recoverAndSeed(now);
      const cycleStart=Date.now(),visited:string[]=[];
      for(let n=0;n<5 && !stopping;n++){const at=new Date(now.getTime()+Date.now()-cycleStart),job=claim(at,visited);if(!job)break;visited.push(job.id);const result=await execute(job,at);if(result)summary[result]++;}
      runtime('last_success',new Date().toISOString());runtime('error','');return summary;
    }catch(error){runtime('error','scheduler_failure');throw error;}
  })().finally(()=>{running=null;});return running;
}
export function jobDiagnostics(projectId?:string,runId?:string){
  const rows=db.prepare(`SELECT id,kind,state,attempts,due_at,created_at,updated_at,error_category,http_status,recovery_generation FROM jobs${projectId?' WHERE project_id=? AND run_id=?':''} ORDER BY created_at`).all(...(projectId?[projectId,runId!]:[]));
  const runtimeRows=db.prepare('SELECT * FROM job_runtime').all();
  return {jobs:rows,scheduler:Object.fromEntries(runtimeRows.map(r=>[r.key,r.value]))};
}
/** Internal operator primitive. HTTP callers must derive scope from authenticated designer context. */
export function retryFailedJob(id:string,projectId?:string,runId?:string){return transaction(()=>{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as Job|undefined;
  if(!job || (projectId && (job.project_id!==projectId || job.run_id!==runId)))throw new Error('Job not found');
  if(job.state!=='failed')throw new Error('Job requires failed state');
  if(job.kind==='paypal_reconcile'){const a=match(payload(job));if(!a)throw new Error('Job requires local association');}
  else {const p=JSON.parse(job.payload_json);validatePayload(job.kind,p);handlers.get(job.kind)!.retry(job,p);}
  const now=new Date().toISOString();db.prepare("UPDATE jobs SET state='pending',attempts=0,due_at=?,recovery_at=?,recovery_generation=recovery_generation+1,error_category=NULL,http_status=NULL,completed_at=NULL WHERE id=? AND state='failed'").run(now,now,id);
  return {id,state:'pending'};
});}
export function startJobWorker(){
  stopping=false;
  let stopped=false;
  const tick=()=>{if(!stopped){void runDueJobs(new Date()).catch(()=>{});for(const lane of ['figma_refresh','scope_assess'] as const)void runInboxJobs(new Date(),lane).catch(()=>{});}};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{stopped=true;stopping=true;clearInterval(timer);await Promise.allSettled([running,...laneRunning.values()].filter(Boolean) as Promise<unknown>[]);};
}

/** Independent bounded lanes: a held model call cannot block payment recovery or comment refresh. */
const laneRunning=new Map<JobKind,Promise<JobRunSummary>>();
export class InternalJobFailure extends Error {constructor(public category:string,public retryable=false,public retryAfterAt=0){super(category);}}
function internalPayload(job:Job){let p;try{p=JSON.parse(job.payload_json);validatePayload(job.kind,p);}catch{throw new InternalJobFailure('invalid_payload');}return p;}
function claimInternal(kind:JobKind,now:Date,visited:string[]):Job|undefined{return transaction(()=>{
 const handler=handlers.get(kind);if(!handler)return;
 const rows=db.prepare("SELECT * FROM jobs WHERE kind=? AND ((state='pending' AND due_at<=?) OR (state='running' AND lease_until<=?)) ORDER BY due_at,id").all(kind,now.toISOString(),now.toISOString()) as unknown as Job[];
 for(const row of rows){
  if(visited.includes(row.id))continue;let resource:string;
  try{resource=handler.resource(internalPayload(row));}catch{db.prepare("UPDATE jobs SET state='failed',error_category='invalid_payload',lease_token=NULL,lease_until=NULL WHERE id=?").run(row.id);continue;}
  const blockers=db.prepare("SELECT * FROM jobs WHERE kind=? AND id!=? AND (state='failed' OR (state='running' AND lease_until>?) OR (state='pending' AND error_category IS NOT NULL AND due_at>?))").all(kind,row.id,now.toISOString(),now.toISOString()) as unknown as Job[];
  if(blockers.some(b=>{if(b.state==='failed'&&handler.blocksFailure?.(b)===false)return false;try{return handler.resource(internalPayload(b))===resource;}catch{return false;}}))continue;
  const token=randomUUID();db.prepare("UPDATE jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,recovery_at=COALESCE(recovery_at,?),updated_at=? WHERE id=?").run(token,new Date(now.getTime()+LEASE_MS).toISOString(),now.toISOString(),now.toISOString(),row.id);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(row.id) as unknown as Job;
 }
});}
async function executeInternal(job:Job,now:Date):Promise<keyof JobRunSummary|null>{
 const start=Date.now(),clock=()=>new Date(now.getTime()+Date.now()-start),guard=()=>{if(!owns(job,clock()))throw new LostLease();};
 const heartbeat=setInterval(()=>{const at=clock();if(owns(job,at))db.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND lease_token=? AND state='running'").run(new Date(at.getTime()+LEASE_MS).toISOString(),job.id,job.lease_token);},10000);heartbeat.unref();
 try{
  const p=internalPayload(job);if(job.attempts>MAX_ATTEMPTS||clock().getTime()-Date.parse(job.recovery_at??job.created_at)>=DAY)throw new InternalJobFailure('retry_exhausted');
  await handlers.get(job.kind)!.execute(job,p,guard);
  return transaction(()=>{guard();finish(job,'completed',null,clock());return 'completed';});
 }catch(error){return transaction(()=>{
  const at=clock();if(error instanceof LostLease||!owns(job,at))return null;
  const e=error instanceof InternalJobFailure?error:new InternalJobFailure('inbox_review_required');
  if(!e.retryable||job.attempts>=MAX_ATTEMPTS||at.getTime()-Date.parse(job.recovery_at??job.created_at)>=DAY){finish(job,'failed',e.category,at);return 'failed';}
  const due=Math.max(at.getTime()+Math.min(15*60000,5000*2**(job.attempts-1)),e.retryAfterAt);
  db.prepare("UPDATE jobs SET state='pending',due_at=?,lease_token=NULL,lease_until=NULL,error_category=?,updated_at=? WHERE id=? AND lease_token=?").run(new Date(due).toISOString(),e.category,at.toISOString(),job.id,job.lease_token);return 'retried';
 });}finally{clearInterval(heartbeat);}
}
export function runInboxJobs(now:Date,kind:'figma_refresh'|'scope_assess'='figma_refresh'):Promise<JobRunSummary>{
 const active=laneRunning.get(kind);if(active)return active;
 const work=(async()=>{const summary:JobRunSummary={completed:0,retried:0,failed:0},visited:string[]=[],start=Date.now();for(let n=0;n<(kind==='scope_assess'?1:5)&&!stopping;n++){const at=new Date(now.getTime()+Date.now()-start),job=claimInternal(kind,at,visited);if(!job)break;visited.push(job.id);const result=await executeInternal(job,at);if(result)summary[result]++;}return summary;})().finally(()=>laneRunning.delete(kind));laneRunning.set(kind,work);return work;
}
