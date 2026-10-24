import {createHash,timingSafeEqual} from 'node:crypto';
import {db,transaction} from './db.js';
import {config} from './env.js';
import {ScopedAccessError} from './context.js';
import {figmaAssociationId,webhookConfigured,activeInboxSettings,refreshInboxFile} from './requestInbox.js';
import {enqueueJob,registerJobHandler,InternalJobFailure} from './jobs.js';

export interface EventReceipt {id:string;state:'queued'|'duplicate'|'ignored';jobId?:string}
const digest=(value:string)=>createHash('sha256').update(value).digest();
function bounded(value:unknown,depth=0):boolean {
 if(depth>8)return false;
 if(value===null||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value==='string')return value.length<=16000;
 if(Array.isArray(value))return value.length<=1000&&value.every(v=>bounded(v,depth+1));
 return !!value&&typeof value==='object'&&Object.keys(value).length<=100&&Object.entries(value).every(([k,v])=>k.length<=200&&bounded(v,depth+1));
}
function opaque(value:unknown){if(typeof value==='string'&&value.trim()&&value.length<=200)return value;if(Number.isSafeInteger(value)&&Number(value)>=0)return String(value);throw new ScopedAccessError(400,'Invalid Figma event identifier');}
/** Body passcode is the documented Figma mechanism. No body/secrets are retained or logged. */
export async function receiveFigmaEvent(payload:unknown):Promise<EventReceipt>{
 if(!webhookConfigured())throw new ScopedAccessError(403,'Figma webhook intake is disabled or unverified');
 if(!bounded(payload)||Buffer.byteLength(JSON.stringify(payload??null))>64000||!payload||typeof payload!=='object'||Array.isArray(payload))throw new ScopedAccessError(400,'Invalid bounded Figma event');
 const p=payload as any;
 if(typeof p.passcode!=='string'||p.passcode.length>100||!timingSafeEqual(digest(p.passcode),digest(config.figmaWebhookPasscode)))throw new ScopedAccessError(400,'Figma passcode mismatch');
 const webhook=opaque(p.webhook_id);if(webhook!==config.figmaWebhookId||(p.context_type!==undefined&&p.context_type!==config.figmaWebhookContextType)||(p.context_id!==undefined&&opaque(p.context_id)!==config.figmaWebhookContextId))throw new ScopedAccessError(400,'Figma subscription association mismatch');
 if(typeof p.event_type!=='string'||! /^[A-Z_]{1,60}$/.test(p.event_type)||typeof p.timestamp!=='string'||!Number.isFinite(Date.parse(p.timestamp))||Date.parse(p.timestamp)>Date.now()+60000)throw new ScopedAccessError(400,'Invalid Figma event type or timestamp');
 const eventAt=new Date(p.timestamp).toISOString(),type=p.event_type;
 const file=type==='PING'||p.file_key===undefined&&type!=='FILE_COMMENT'?null:opaque(p.file_key);
 if(file!==null&&file!==config.figmaFileKey)throw new ScopedAccessError(400,'Figma file association mismatch');
 const commentId=type==='FILE_COMMENT'?opaque(p.comment_id):null;
 const discriminator=digest(JSON.stringify([p.comment??null,p.version_id??null,p.node_id??null,p.status??null])).toString('hex');
 const id=digest(JSON.stringify([figmaAssociationId,webhook,file,type,eventAt,commentId,discriminator])).toString('hex');
 return transaction(()=>{
  const prior=db.prepare('SELECT job_id FROM figma_event_receipts WHERE id=?').get(id);if(prior)return {id,state:'duplicate' as const,...(prior.job_id?{jobId:String(prior.job_id)}:{})};
  const targets=activeInboxSettings();
  const eligible=type==='FILE_COMMENT'&&targets.some(s=>Date.parse(eventAt)>=Date.parse(s.startedAt));
  const at=new Date().toISOString();let generation:number|null=null,jobId:string|null=null;
  if(eligible){
   db.prepare('INSERT INTO figma_refresh_state VALUES(?,1,0,?) ON CONFLICT(association_id) DO UPDATE SET generation=generation+1,updated_at=excluded.updated_at').run(figmaAssociationId,at);
   generation=Number(db.prepare('SELECT generation FROM figma_refresh_state WHERE association_id=?').get(figmaAssociationId)!.generation);
   jobId=enqueueJob({key:`figma:refresh:${figmaAssociationId}:${generation}`,kind:'figma_refresh',projectId:'__figma_file__',runId:'__figma_unbound__',payload:{version:1,associationId:figmaAssociationId,generation},dueAt:at});
  }
  db.prepare('INSERT INTO figma_event_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,figmaAssociationId,webhook,config.figmaWebhookContextType,config.figmaWebhookContextId,file,type,eventAt,commentId,at,at,eligible?'queued':'ignored',jobId,generation);
  return {id,state:eligible?'queued' as const:'ignored' as const,...(jobId?{jobId}:{})};
 });
}
registerJobHandler('figma_refresh',{
 validate(p:any){if(!p||Object.keys(p).some(k=>!['version','associationId','generation'].includes(k))||p.version!==1||typeof p.associationId!=='string'||! /^[a-f0-9]{64}$/.test(p.associationId)||!Number.isSafeInteger(p.generation)||p.generation<1)throw new Error('Invalid Figma refresh payload');},
 resource:p=>p.associationId,
 blocksFailure:job=>job.error_category!=='comment_unavailable',
 retry(job,p){if(!webhookConfigured()||p.associationId!==figmaAssociationId||job.project_id!=='__figma_file__'||job.run_id!=='__figma_unbound__'||!activeInboxSettings().length)throw new Error('Figma association unavailable');},
 async execute(job,p,guard){
  if(job.project_id!=='__figma_file__'||job.run_id!=='__figma_unbound__'||p.associationId!==figmaAssociationId)throw new InternalJobFailure('association_unavailable');
  const state=db.prepare('SELECT * FROM figma_refresh_state WHERE association_id=?').get(p.associationId) as any;if(!state||p.generation>state.generation)throw new InternalJobFailure('refresh_unavailable');
  if(state.completed_generation>=p.generation)return;
  // Capture a dirty watermark before the read. Events received during it get a later job/read.
  await refreshInboxFile(p.associationId,state.generation,guard);
 }
});
