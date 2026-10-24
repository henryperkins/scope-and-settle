import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';

function interruptedBody(error,status=200){
 let sent=false;
 return new Response(new ReadableStream({pull(controller){
  if(!sent){sent=true;controller.enqueue(new TextEncoder().encode('{"private":"fixture-body'));}
  else controller.error(error);
 }}),{status,headers:{'Retry-After':'3600'}});
}
async function setup(){
 const app=await isolatedApp(),{db}=await app.load('db'),orders=await app.load('orders'),jobs=await app.load('jobs'),provider=providerFixture();
 globalThis.fetch=provider.fetch;
 let order=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(order.id,{changeOrderId:order.id,changeOrderRevision:order.revision});order=await orders.ensureInvoice(order.id);
 const jobId=jobs.enqueueJob({key:'body-fixture',kind:'paypal_reconcile',projectId:order.projectId,runId:order.runId,payload:{invoiceId:order.paypalInvoiceId,route:jobs.paypalRoute},dueAt:new Date().toISOString()});
 const row=()=>db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
 const snapshot=()=>JSON.stringify({order:orders.getChangeOrder(order.id),approvals:db.prepare('SELECT * FROM approvals').all(),revisions:db.prepare('SELECT * FROM proposal_revisions').all(),observations:db.prepare('SELECT * FROM payment_observations').all()});
 return {app,db,orders,jobs,provider,order,jobId,row,snapshot};
}
for(const boundary of ['invoice','oauth'])for(const failure of ['disconnect','abort'])test(`${boundary} ${failure} during response body schedules a safe durable retry`,async()=>{
 const original=globalThis.fetch,fixture=await setup(),{db,jobs,provider,order,jobId,row,snapshot}=fixture;
 const before=snapshot(),counts=provider.counts();let failureEnabled=true;
 // Advance beyond the fixture token TTL to exercise real OAuth refresh during a job.
 const realNow=Date.now;
 try{
  if(boundary==='oauth')Date.now=()=>realNow()+7200000;
  globalThis.fetch=async(url,init)=>{
   const path=new URL(url).pathname,target=boundary==='oauth'?'/v1/oauth2/token':'/v2/invoicing/invoices/'+order.paypalInvoiceId;
   if(failureEnabled && path===target)return interruptedBody(failure==='abort'?new DOMException('fixture-private-abort','AbortError'):new TypeError('fixture-private-disconnect'));
   return provider.fetch(url,init);
  };
  const now=new Date(Date.now()),summary=await jobs.runDueJobs(now);
  assert.equal(summary.retried,1);assert.equal(summary.failed,0);assert.equal(row().state,'pending');assert.equal(row().attempts,1);assert.equal(row().error_category,'provider_transport');assert.equal(row().http_status,200);
  assert.ok(Date.parse(row().due_at)>=now.getTime()+3600000);assert.equal(snapshot(),before);assert.deepEqual(provider.counts(),counts);assert.ok(!JSON.stringify(row()).includes('fixture-private'));
  failureEnabled=false;db.prepare('UPDATE jobs SET due_at=? WHERE id=?').run(now.toISOString(),jobId);await jobs.runDueJobs(now);assert.equal(row().state,'completed');assert.deepEqual(provider.counts(),counts);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_calls').get().n,0);
 }finally{Date.now=realNow;globalThis.fetch=original;db.close();}
});
test('interrupted 503 invoice body preserves status and provider retry guidance',async()=>{
 const original=globalThis.fetch,{db,jobs,provider,order,row,snapshot}=await setup(),before=snapshot();
 try{globalThis.fetch=async(url,init)=>new URL(url).pathname.endsWith('/'+order.paypalInvoiceId)?interruptedBody(new TypeError('private-body-error'),503):provider.fetch(url,init);
 const now=new Date();await jobs.runDueJobs(now);assert.equal(row().state,'pending');assert.equal(row().http_status,503);assert.equal(row().error_category,'provider_unavailable');assert.ok(Date.parse(row().due_at)>=now.getTime()+3600000);assert.equal(snapshot(),before);
 }finally{globalThis.fetch=original;db.close();}
});
for(const boundary of ['invoice','oauth'])test(`${boundary} malformed JSON remains distinct from a body transport failure`,async()=>{
 const original=globalThis.fetch,{db,jobs,provider,order,row,snapshot}=await setup(),before=snapshot(),realNow=Date.now;
 try{if(boundary==='oauth')Date.now=()=>realNow()+7200000;
 globalThis.fetch=async(url,init)=>new URL(url).pathname===(boundary==='oauth'?'/v1/oauth2/token':'/v2/invoicing/invoices/'+order.paypalInvoiceId)?new Response('fixture-private-invalid-json',{status:200}):provider.fetch(url,init);
 const summary=await jobs.runDueJobs(new Date(Date.now()));assert.equal(summary.failed,1);assert.equal(summary.retried,0);assert.equal(row().error_category,'provider_invalid_response');assert.equal(snapshot(),before);assert.ok(!JSON.stringify(row()).includes('fixture-private'));
 }finally{Date.now=realNow;globalThis.fetch=original;db.close();}
});
