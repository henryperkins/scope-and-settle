import {test,after} from 'node:test';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';

const app=await isolatedApp(),{db}=await app.load('db');
const {createJudgeAccess,startJudgeRun}=await app.load('judging');
const {saveAgentPolicy}=await app.load('agentPolicy');
const portal=await app.load('agentPortal'),orders=await app.load('orders');
const provider=providerFixture(),originalFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>new URL(url).hostname==='127.0.0.1'?originalFetch(url,init):provider.fetch(url,init);
const {server}=await app.load('server');if(!server.listening)await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;db.close();});

async function request(path,credential,body){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(response.status,200,path);
 return response.json();
}
async function setup(){
 const access=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=startJudgeRun(access.credential);
 saveAgentPolicy(owner,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1});
 const privateDraft=orders.createChangeOrder({...draftInput(),title:'PRIVATE separate-review commitment',deliverables:['PRIVATE deliverable never published to this portal'],lineItems:[{rateCardId:null,priceSource:'designer',description:'PRIVATE separately agreed price',quantity:1,unitAmountMinor:13791}]},owner.runId);
 const privateOrder=orders.submitForApproval(privateDraft.id);
 orders.approveChangeOrder(privateOrder.id,{changeOrderId:privateOrder.id,changeOrderRevision:privateOrder.revision});
 const privateInvoice=await orders.ensureInvoice(privateOrder.id);
 const issued=portal.createPortalAccess(owner),client=portal.getPortalSession(issued.credential);
 const r=portal.addPortalRequest(client,'Please add mobile checkout','projection-request');
 const draft=orders.createChangeOrder(draftInput(),owner.runId),order=orders.submitForApproval(draft.id);
 portal.publishReviewedQuote(owner,r.id,order.id,order.revision,true);
 const commitments=orders.getChangeOrder(order.id).scopeContext.commitments;
 assert.equal(commitments.length,1,'later quote captures the separate approved commitment');
 assert.equal(commitments[0].resourceId,privateOrder.id);
 assert.equal(commitments[0].terms.totalMinor,13791);
 assert.ok(commitments[0].approvalEvidence.id);
 assert.ok(commitments[0].financialState,'private invoice observation is captured too');
 const privateEvidence=[privateOrder.id,privateInvoice.paypalInvoiceId,'PRIVATE','13791'];
 const assertSafe=(payload,publishedOrder)=>{
  const json=JSON.stringify(payload);
  for(const evidence of privateEvidence)assert.ok(!json.includes(evidence),'portal response disclosed private commitment evidence: '+evidence);
  assert.equal(publishedOrder.id,order.id);
  assert.deepEqual(publishedOrder.scopeContext.commitments,[]);
  assert.equal(publishedOrder.scopeContext.scopeSnapshotId,order.scopeContext.scopeSnapshotId);
  assert.equal(publishedOrder.scopeContext.rateSnapshotId,order.scopeContext.rateSnapshotId);
  for(const internal of ['runId','projectId','scopeSnapshot','assessmentId','commentId','createdAt'])assert.ok(!(internal in publishedOrder),'portal response disclosed internal order field: '+internal);
 };
 const view=await request('/api/portal',issued.credential);
 assert.equal(view.requests.length,1,'private order has no published portal request');
 assertSafe(view,view.requests[0].order);
 const approve=()=>request(`/api/portal/requests/${r.id}/approve`,issued.credential,{revision:order.revision,consent:true});
 const refresh=()=>request(`/api/portal/requests/${r.id}/payment-status`,issued.credential,{});
 return {order,approve,refresh,assertSafe};
}

test('portal successful invoice creation returns only the published quote',async()=>{
 const fixture=await setup(),response=await fixture.approve();
 assert.equal(response.order.approvalStatus,'approved');assert.ok(response.order.paypalInvoiceId);
 fixture.assertSafe(response,response.order);
});
test('portal invoice delivery failure returns a safe quote with saved approval',async()=>{
 const fixture=await setup();provider.failNextSend();const response=await fixture.approve();
 assert.match(response.invoiceError,/Approval saved/);assert.equal(response.order.approvalStatus,'approved');
 fixture.assertSafe(response,response.order);
});
test('portal invoice recovery returns a safe quote and reuses the saved invoice',async()=>{
 const fixture=await setup();provider.failNextSend();const failed=await fixture.approve(),response=await fixture.approve();
 assert.equal(response.invoiceError,undefined);assert.equal(response.order.paypalInvoiceId,failed.order.paypalInvoiceId);
 assert.equal(response.order.paymentStatus,'payment_due');
 fixture.assertSafe(response,response.order);
});
test('portal repeated approval returns only the published quote',async()=>{
 const fixture=await setup(),first=await fixture.approve(),response=await fixture.approve();
 assert.equal(response.order.paypalInvoiceId,first.order.paypalInvoiceId);assert.equal(response.order.approvalStatus,'approved');
 fixture.assertSafe(response,response.order);
});
test('portal payment refresh before invoicing returns only the published quote',async()=>{
 const fixture=await setup(),response=await fixture.refresh();
 assert.equal(response.paypalInvoiceId,null);assert.equal(response.approvalStatus,'awaiting_client_approval');
 fixture.assertSafe(response,response);
});
test('portal payment refresh exposes current payment evidence only for the published quote',async()=>{
 const fixture=await setup(),approved=await fixture.approve();
 const invoice=provider.invoices.get(approved.order.paypalInvoiceId);
 invoice.status='PAID';invoice.due_amount.value='0.00';
 invoice.payments={paid_amount:{currency_code:'USD',value:'250.00'},transactions:[{type:'PAYPAL',payment_id:'PORTAL-PROJECTION-PAYMENT',amount:{currency_code:'USD',value:'250.00'}}]};
 const response=await fixture.refresh();
 assert.equal(response.paymentStatus,'paid');assert.equal(response.financialState.paidMinor,25000);assert.equal(response.amountDueMinor,0);
 fixture.assertSafe(response,response);
});
