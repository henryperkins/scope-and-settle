import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';
const app=await isolatedApp(), {db}=await app.load('db');
const {createJudgeAccess,startJudgeRun,resetJudgeRun,revokeJudgeAccess}=await app.load('judging');
const {saveAgentPolicy,activeAgentPolicy}=await app.load('agentPolicy');
const portal=await app.load('agentPortal'), orders=await app.load('orders');
const provider=providerFixture(), originalFetch=globalThis.fetch;
globalThis.fetch=provider.fetch;
after(()=>{globalThis.fetch=originalFetch;db.close();});
const policy={enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1};
function setup(){const access=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()});const owner=startJudgeRun(access.credential);saveAgentPolicy(owner,policy);const issued=portal.createPortalAccess(owner);return {access,owner,issued,client:portal.getPortalSession(issued.credential)};}
function publish(client){const r=portal.addPortalRequest(client,'Mobile please','request-1');const draft=orders.createChangeOrder(draftInput(),client.runId);const order=orders.submitForApproval(draft.id);db.prepare("UPDATE agent_requests SET state='quoted',order_id=?,quote_revision=?,quoted_minor=? WHERE id=?").run(order.id,order.revision,order.totalMinor,r.id);return {r,order};}

test('portal credentials are hashed, scoped and survive natural designer session expiry',()=>{
 const {owner,issued,client,access}=setup();assert.equal(client.runId,owner.runId);
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM agent_portals').all()).includes(issued.credential));
 db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01',owner.token);
 assert.ok(activeAgentPolicy(owner.runId));assert.ok(portal.getPortalSession(issued.credential));
 revokeJudgeAccess(access.id);assert.equal(portal.getPortalSession(issued.credential),null);
 assert.throws(()=>portal.addPortalRequest(client,'forbidden','request-2'),/expired|revoked/i);
});
test('request idempotency, bounds and cross-run access are enforced',()=>{
 const a=setup(),b=setup();const r=portal.addPortalRequest(a.client,'Mobile please','request-1');
 assert.equal(portal.addPortalRequest(a.client,'Mobile please','request-1').id,r.id);
 assert.throws(()=>portal.addPortalRequest(a.client,'Different content','request-1'),/already|different/i);
 assert.throws(()=>portal.addPortalRequest(a.client,'x'.repeat(4001),'request-2'),/4000/);
 assert.equal(portal.portalView(b.client).requests.length,0);
 assert.throws(()=>portal.replyToRequest(b.client,r.id,'Hi','reply-001'),/not found/i);
});
test('only a published current revision with explicit consent can create an invoice',async()=>{
 const a=setup(),b=setup(),{r,order}=publish(a.client);
 await assert.rejects(portal.approvePortalQuote(a.client,r.id,1,false),/consent/i);
 await assert.rejects(portal.approvePortalQuote(b.client,r.id,1,true),/not found/i);
 await assert.rejects(portal.approvePortalQuote(a.client,r.id,2,true),/revision/i);
 assert.equal(orders.getChangeOrder(order.id).paypalInvoiceId,null);
 const approved=await portal.approvePortalQuote(a.client,r.id,1,true);
 assert.ok(approved.order.paypalInvoiceId);const before=provider.counts().creates;
 await portal.approvePortalQuote(a.client,r.id,1,true);assert.equal(provider.counts().creates,before);
 const second=setup(),pub=publish(second.client);orders.editChangeOrder(pub.order.id,{title:'Changed'});
 assert.equal(portal.portalView(second.client).requests[0].order,null);
 await assert.rejects(portal.approvePortalQuote(second.client,pub.r.id,1,true),/revision|published/i);
});
test('reset revokes portal and discards its jobs, preserving another run and parent access',()=>{
 const a=setup(),b=setup();publish(a.client);portal.addPortalRequest(b.client,'Keep me','request-1');
 resetJudgeRun(a.owner);assert.equal(portal.getPortalSession(a.issued.credential),null);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_requests WHERE run_id=?').get(a.owner.runId).n,0);
 assert.equal(portal.portalView(b.client).requests.length,1);
});
test('clarifications queue once; changes after a quote become an exception without altering terms',()=>{
 const a=setup(),r=portal.addPortalRequest(a.client,'Mobile please','request-1');
 db.prepare("UPDATE agent_requests SET state='needs_clarification' WHERE id=?").run(r.id);
 portal.replyToRequest(a.client,r.id,'Checkout screens','reply-001');portal.replyToRequest(a.client,r.id,'Checkout screens','reply-001');
 assert.equal(db.prepare('SELECT version FROM agent_requests WHERE id=?').get(r.id).version,2);
 const pub=publish(setup().client);const other=portal.getPortalSession('invalid');assert.equal(other,null);
 const client={id:db.prepare('SELECT id FROM agent_portals WHERE run_id=?').get(pub.r.run_id).id,runId:pub.r.run_id};
 portal.replyToRequest(client,pub.r.id,'And a new logo','reply-002');
 assert.equal(orders.getChangeOrder(pub.order.id).revision,1);
 assert.equal(db.prepare('SELECT state FROM agent_requests WHERE id=?').get(pub.r.id).state,'exception');
});
test('replacement portal access revokes the previous credential without changing quotes',()=>{
 const a=setup(),{order}=publish(a.client),replacement=portal.createPortalAccess(a.owner);
 assert.equal(portal.getPortalSession(a.issued.credential),null);
 const next=portal.getPortalSession(replacement.credential);assert.equal(portal.portalView(next).requests[0].order.id,order.id);
});

test('real portal response renders current financial actions and approval through payable, paid, cancelled and refunded outcomes',async()=>{
 const a=setup(),{r,order}=publish(a.client);
 await portal.approvePortalQuote(a.client,r.id,order.revision,true);
 const invoice=provider.invoices.get(orders.getChangeOrder(order.id).paypalInvoiceId);
 invoice.detail.metadata={recipient_view_url:'https://www.sandbox.paypal.com/invoice/p/#portal-opaque'};
 const elements=new Map(),element=id=>elements.get(id)||elements.set(id,{hidden:false,innerHTML:'',textContent:'',value:''}).get(id);
 const ctx=vm.createContext({window:{},location:{origin:'https://fixture.test',hash:''},history:{},crypto:globalThis.crypto,URL,
   document:{getElementById:element,querySelector:()=>null,querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},setInterval(){},
   fetch:async()=>Response.json(portal.portalView(a.client))});
 vm.runInContext((await readFile(new URL('../web/common.js',import.meta.url),'utf8')).replace(/\bexport /g,''),ctx);
 vm.runInContext((await readFile(new URL('../web/client.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,''),ctx);
 for(const [status,label,pay,receipt] of [['UNPAID','Payment due',true,false],['PAID','Paid',false,true],['CANCELLED','Invoice cancelled',false,false],['REFUNDED','Refunded',false,false]]){
  invoice.status=status;
  invoice.due_amount.value=status==='UNPAID'||status==='CANCELLED'?'250.00':'0.00';
  if(status==='PAID'||status==='REFUNDED')invoice.payments={paid_amount:{currency_code:'USD',value:'250.00'},transactions:[{type:'PAYPAL',payment_id:'PORTAL-PAYMENT',amount:{currency_code:'USD',value:'250.00'}}]};else delete invoice.payments;
  if(status==='REFUNDED')invoice.refunds={refund_amount:{currency_code:'USD',value:'250.00'},transactions:[{type:'PAYPAL',refund_id:'PORTAL-REFUND',amount:{currency_code:'USD',value:'250.00'}}]};else delete invoice.refunds;
  await orders.refreshPaymentStatus(order.id);
  await vm.runInContext('credential="fixture-portal"; load()',ctx);
  const markup=element('client-requests').innerHTML;
  assert.equal(markup.includes('Pay with PayPal sandbox'),pay,`${status}: payment action`);
  assert.equal(markup.includes('View PayPal receipt'),receipt,`${status}: receipt action`);
  assert.match(markup,/Refresh payment/,`${status}: refresh remains available`);
  assert.match(markup,new RegExp(`class="badge">${label}</span>`),`${status}: explicit current status`);
  assert.match(markup,/Approval for revision 1 is saved/,`${status}: approval retained`);
  if(pay||receipt)assert.match(markup,/href="https:\/\/www\.sandbox\.paypal\.com\/invoice\/p\/#portal-opaque"/);
 }
});

// The new assertions intentionally run against the real provider-await paths.
for(const action of ['approval','refresh'])for(const invalidation of ['revoke','reset'])test(`portal ${action} revalidates ${invalidation} during held provider work`,async()=>{
 const a=setup(),{r,order}=publish(a.client);
 if(action==='refresh')await portal.approvePortalQuote(a.client,r.id,order.revision,true);
 let release,enteredResolve;const entered=new Promise(resolve=>enteredResolve=resolve),gate=new Promise(resolve=>release=resolve);let held=false;
 globalThis.fetch=async(url,init)=>{if(!held&&new URL(url).pathname.includes('/v2/invoicing/invoices')){held=true;enteredResolve();await gate;}return provider.fetch(url,init);};
 const operation=action==='approval'?portal.approvePortalQuote(a.client,r.id,order.revision,true):portal.refreshPortalPayment(a.client,r.id);
 const assertion=assert.rejects(operation,/expired|revoked|not found|access|reset/i);
 await entered;if(invalidation==='revoke')portal.createPortalAccess(a.owner);else if(action==='approval'){assert.throws(()=>resetJudgeRun(a.owner),/Wait for invoice operations/);revokeJudgeAccess(a.access.id);}else resetJudgeRun(a.owner);release();await assertion;globalThis.fetch=provider.fetch;
 if(invalidation==='revoke')assert.equal(orders.getChangeOrder(order.id).approvalStatus,'approved');
});
