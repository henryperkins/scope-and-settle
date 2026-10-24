import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';
const originalFetch=globalThis.fetch;after(()=>globalThis.fetch=originalFetch);
function child(app,mode,file,event){
 const p=fork(fileURLToPath(new URL('./fixtures/job-process.mjs',import.meta.url)),[app,mode,file,event],{stdio:['ignore','pipe','pipe','ipc']});
 let output='';p.stderr.on('data',d=>output+=d);p.stdout.on('data',d=>output+=d);
 const message=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.kill();reject(new Error('Child barrier timeout: '+output));},8000);p.once('message',m=>{clearTimeout(timer);resolve(m);});p.once('error',reject);p.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('Child exit '+code+': '+output));});});
 return {p,message};
}
for(const mode of ['accept','claim'])test(`a fresh server process resumes a receipt after predecessor stops at ${mode}`,async()=>{
 const app=await isolatedApp(),{db}=await app.load('db'),orders=await app.load('orders'),provider=providerFixture();globalThis.fetch=provider.fetch;
 let order=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(order.id,{changeOrderId:order.id,changeOrderRevision:order.revision});order=await orders.ensureInvoice(order.id);
 const invoice=provider.invoices.get(order.paypalInvoiceId);invoice.status='PAID';invoice.due_amount.value='0.00';invoice.payments={paid_amount:{...invoice.amount},transactions:[{type:'PAYPAL',payment_id:'PAY-RESTART',amount:{...invoice.amount}}]};
 const file=join(app.root,'invoice.json');await writeFile(file,JSON.stringify(invoice));const approval=JSON.stringify(db.prepare('SELECT * FROM approvals').all()),event='restart-'+mode;
 const first=child(app.app,mode,file,event);try{
  const accepted=await first.message;assert.equal(accepted.barrier,mode==='accept'?'accepted':'claimed');if(mode==='accept'){assert.equal(accepted.state.state,'queued');assert.equal(accepted.reads,0);}assert.equal(accepted.forbidden,0);
  const exited=once(first.p,'exit');first.p.kill('SIGKILL');await exited;
  if(mode==='claim')db.prepare("UPDATE jobs SET lease_until=? WHERE state='running'").run(new Date(Date.now()-1000).toISOString());
  const second=child(app.app,'restart',file,event);try{const done=await second.message;assert.equal(done.state,'reconciled');assert.equal(done.reads,1);assert.equal(done.forbidden,0);await once(second.p,'exit');}finally{second.p.kill();}
  assert.equal(orders.getChangeOrder(order.id).financialState.paymentState,'paid');assert.equal(JSON.stringify(db.prepare('SELECT * FROM approvals').all()),approval);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_calls').get().n,0);
 }finally{first.p.kill();db.close();}
});

test('server close drains a held reconciliation before its callback permits SQLite close',async()=>{
 const app=await isolatedApp(),{db}=await app.load('db'),orders=await app.load('orders'),webhooks=await app.load('webhooks'),provider=providerFixture();globalThis.fetch=provider.fetch;
 let o=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(o.id,{changeOrderId:o.id,changeOrderRevision:o.revision});o=await orders.ensureInvoice(o.id);
 await webhooks.receiveWebhook({'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/test','paypal-transmission-id':'close','paypal-transmission-sig':'valid','paypal-transmission-time':new Date().toISOString()},{id:'close',event_type:'INVOICING.INVOICE.PAID',resource:{id:o.paypalInvoiceId}});
 let release,entered;const gate=new Promise(r=>release=r),blocked=new Promise(r=>entered=r);
 globalThis.fetch=async(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){entered();await gate;}return provider.fetch(u,i);};
 const queuedId=(await app.load('jobs')).enqueueJob({key:'after-close',kind:'paypal_reconcile',projectId:o.projectId,runId:o.runId,payload:{invoiceId:o.paypalInvoiceId,route:(await app.load('jobs')).paypalRoute},dueAt:new Date(Date.now()+10).toISOString()});
 process.env.JOB_WORKER_DISABLED='false';const {server}=await app.load('server');
 try{if(!server.listening)await once(server,'listening');const reached=await Promise.race([blocked.then(()=>true),new Promise(r=>setTimeout(()=>r(false),300))]);assert.equal(reached,true,'startup must claim persisted work');
 let closed=false;const closing=new Promise(r=>server.close(()=>{closed=true;r();}));await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);release();await closing;assert.equal(db.prepare("SELECT state FROM webhook_receipts WHERE id='close'").get().state,'reconciled');assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get(queuedId).state,'pending');
 }finally{release();await new Promise(r=>server.close(r));db.close();process.env.JOB_WORKER_DISABLED='true';}
});

test('only the scoped designer can inspect and recover exhausted reconciliation jobs',async()=>{
 const app=await isolatedApp(),{db}=await app.load('db'),orders=await app.load('orders'),jobs=await app.load('jobs'),sessions=await app.load('sessions'),judging=await app.load('judging'),provider=providerFixture();globalThis.fetch=provider.fetch;
 let o=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(o.id,{changeOrderId:o.id,changeOrderRevision:o.revision});o=await orders.ensureInvoice(o.id);
 const id=jobs.enqueueJob({key:'scoped-recovery',kind:'paypal_reconcile',projectId:o.projectId,runId:o.runId,payload:{invoiceId:o.paypalInvoiceId,route:jobs.paypalRoute},dueAt:new Date().toISOString()});db.prepare("UPDATE jobs SET state='failed',error_category='provider_unavailable' WHERE id=?").run(id);
 const designer=sessions.createSession({projectId:o.projectId,runId:o.runId,role:'designer'}),client=sessions.createSession({projectId:o.projectId,runId:o.runId,role:'client',changeOrderId:o.id,changeOrderRevision:o.revision});
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),other=judging.startJudgeRun(access.credential);
 const realFetch=originalFetch;globalThis.fetch=(u,i)=>new URL(u).hostname==='127.0.0.1'?realFetch(u,i):provider.fetch(u,i);
 const {server}=await app.load('server');if(!server.listening)await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const get=token=>fetch(base+'/api/reconciliation',{headers:{Authorization:'Bearer '+token}}),retry=token=>fetch(base+'/api/reconciliation/'+id+'/retry',{method:'POST',headers:{Authorization:'Bearer '+token}});
 try{
  assert.equal((await get(client.token)).status,403);assert.equal((await retry(client.token)).status,403);
  const diagnosticsResponse=await get(designer.token);assert.equal(diagnosticsResponse.status,200);const diagnostics=await diagnosticsResponse.json();assert.equal(diagnostics.jobs[0].id,id);assert.ok(!JSON.stringify(diagnostics).includes(o.paypalInvoiceId));assert.ok(!JSON.stringify(diagnostics).includes('payload_json'));
  assert.equal((await get(other.token)).status,200);assert.equal((await (await get(other.token)).json()).jobs.length,0);assert.equal((await retry(other.token)).status,404);
  assert.equal((await retry(designer.token)).status,200);assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get(id).state,'pending');
 }finally{await new Promise(r=>server.close(r));db.close();}
});


