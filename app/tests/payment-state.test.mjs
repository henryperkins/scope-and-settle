import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';

const app=await isolatedApp(),orders=await app.load('orders'),{db}=await app.load('db');
const module=await app.load('paymentState').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const money=value=>({currency_code:'USD',value});
const terms={invoiceId:'INV2-TEST',merchantEmail:'merchant@example.com',currency:'USD',totalMinor:7000,
 representation:'itemized-v1',reference:'order:test;revision:1;scope:scope-1',lineItems:[
 {description:'Desktop screens',quantity:2,unitAmountMinor:2500},{description:'Mobile screens',quantity:1,unitAmountMinor:2000}]};
function raw(status='UNPAID',due='70.00',paid,refund){return {id:'INV2-TEST',status,invoicer:{email_address:'merchant@example.com'},
 detail:{currency_code:'USD',reference:terms.reference,metadata:{recipient_view_url:'https://www.sandbox.paypal.com/invoice/p/#opaque'}},
 items:[{name:'Desktop screens',description:'Desktop screens',quantity:'2',unit_amount:money('25.00')},{name:'Mobile screens',description:'Mobile screens',quantity:'1',unit_amount:money('20.00')}],
 amount:money('70.00'),due_amount:money(due),...(paid!==undefined?{payments:{paid_amount:money(paid),transactions:[{type:'PAYPAL',payment_id:'P1',amount:money(paid)}]}}:{}),
 ...(refund!==undefined?{refunds:{refund_amount:money(refund),transactions:[{type:'PAYPAL',refund_id:'R1',amount:money(refund)}]}}:{})};}
function derive(body,approved=terms){assert.equal(typeof module.deriveFinancialState,'function','financial state derivation must exist');return module.deriveFinancialState({id:body.id,status:body.status,raw:body},approved);}
for(const [status,due,paid,refund,invoice,payment] of [
 ['DRAFT','70.00',undefined,undefined,'draft','not_started'],['SCHEDULED','70.00',undefined,undefined,'scheduled','not_started'],
 ['SENT','70.00',undefined,undefined,'payable','due'],['UNPAID','70.00',undefined,undefined,'payable','due'],['SHARED','70.00',undefined,undefined,'payable','due'],
 ['PARTIALLY_PAID','50.00','20.00',undefined,'payable','partial'],['PAYMENT_PENDING','0.00',undefined,undefined,'closed','pending'],
 ['PAID','0.00','70.00',undefined,'closed','paid'],['MARKED_AS_PAID','0.00','70.00',undefined,'closed','review_required'],['PAID_EXTERNAL','0.00','70.00',undefined,'closed','review_required'],
 ['CANCELLED','70.00',undefined,undefined,'cancelled','unknown'],['AUTO_CANCELLED','70.00',undefined,undefined,'cancelled','unknown'],
 ['REFUNDED','50.00','20.00','20.00','closed','refunded'],['PARTIALLY_REFUNDED','0.00','70.00','10.00','closed','partially_refunded'],
 ['MARKED_AS_REFUNDED','0.00','70.00','70.00','closed','review_required'],['REFUNDED_EXTERNAL','0.00','70.00','70.00','closed','review_required'],
 ['NEW_STATUS','0.00','70.00',undefined,'unknown','unknown'],[undefined,'0.00','70.00',undefined,'unknown','unknown'],['paid','0.00','70.00',undefined,'unknown','unknown']]) {
 test(`provider ${status} derives ${invoice}/${payment}`,()=>{const body=raw(status,due,paid,refund);if(status===undefined)delete body.status;const result=derive(body);assert.equal(result.invoiceState,invoice);assert.equal(result.paymentState,payment);});
}
for(const [name,change] of [
 ['changed description',r=>r.items[0].description='Other work'],['missing item',r=>r.items.pop()],['missing reference',r=>delete r.detail.reference],
 ['same total changed prices',r=>{r.items[0].unit_amount.value='20.00';r.items[1].unit_amount.value='30.00';}],
 ['wrong currency',r=>r.payments.paid_amount.currency_code='EUR'],['missing paid aggregate',r=>delete r.payments.paid_amount],
 ['nonzero due',r=>r.due_amount.value='1.00'],['positive refund',r=>r.refunds={refund_amount:money('1.00')}],
 ['external payment',r=>r.payments.transactions[0].type='EXTERNAL'],['reversed payment',r=>r.payments.transactions[0].status='REVERSED'],
 ['unknown transaction status',r=>r.payments.transactions[0].status='WHATEVER'],['empty payment transactions',r=>r.payments.transactions=[]],
 ['conflicting transactions',r=>r.payments.transactions[0].amount.value='60.00'],['duplicate transaction',r=>r.payments.transactions.push(r.payments.transactions[0])],
 ['wrong identity',r=>r.id='INV2-OTHER'],['unapproved tax',r=>r.amount.breakdown={tax_total:money('1.00')}],
 ['wrong refund alias',r=>{r.status='REFUNDED';r.refunds={refunded_amount:money('70.00')};}],
 ])test(`review is visible for ${name}`,()=>{const body=raw('PAID','0.00','70.00');change(body);assert.equal(derive(body).paymentState,'review_required');});
for(const value of ['1junk','1e2','NaN','0.001','-1','90071992547409999.00',null,1])test(`strict money rejects ${value}`,()=>{const body=raw('PAID','0.00','70.00');body.payments.paid_amount.value=value;assert.equal(derive(body).paymentState,'review_required');});
for(const value of ['0','0.0','0.00'])test(`explicit zero ${value} is valid`,()=>assert.equal(derive(raw('PAID',value,'70.00')).paymentState,'paid'));
test('legacy representation validates original aggregate without requiring new reference',()=>{
 const body=raw('PAID','0','70');delete body.detail.reference;body.items=[{name:'Legacy work',description:'Legacy work',quantity:'1',unit_amount:money('70')}];
 assert.equal(derive(body,{...terms,representation:'aggregate-v0',legacyDescription:'Legacy work'}).paymentState,'paid');
 body.items[0].description='Other';assert.equal(derive(body,{...terms,representation:'aggregate-v0',legacyDescription:'Legacy work'}).paymentState,'review_required');
});
test('unknown provenance and missing new fields cannot downgrade item verification',()=>{const body=raw('PAID','0','70');delete body.items;assert.equal(derive(body).paymentState,'review_required');assert.equal(derive(raw(),{...terms,representation:null}).paymentState,'review_required');});
test('a refunded invoice with an impossible outstanding balance requires review',()=>assert.equal(derive(raw('REFUNDED','71','70','70')).paymentState,'review_required'));

async function approved(){const order=orders.createChangeOrder({...draftInput(),lineItems:terms.lineItems.map(x=>({...x,priceSource:'designer',rateCardId:null}))});orders.submitForApproval(order.id);return orders.approveChangeOrder(order.id,{changeOrderId:order.id,changeOrderRevision:order.revision});}
test('creation preserves two approved items and revision; financial outcomes never revoke approval or permit edits',async()=>{
 const provider=providerFixture();globalThis.fetch=provider.fetch;const order=await approved();const invoice=await orders.ensureInvoice(order.id),body=provider.invoices.get(invoice.paypalInvoiceId);
 assert.equal(body.items?.length,2,'provider must receive both approved line items');assert.equal(body.items[0].quantity,'2');assert.equal(body.amount.value,'70.00');
 assert.match(body.detail.reference,new RegExp(order.id));assert.match(body.detail.reference,/revision:1/);
 const history=()=>JSON.stringify({approvals:db.prepare('SELECT * FROM approvals WHERE change_order_id=?').all(order.id),snapshots:db.prepare('SELECT * FROM proposal_revisions WHERE change_order_id=?').all(order.id)}),before=history();
 body.detail.metadata={recipient_view_url:'https://www.sandbox.paypal.com/invoice/p/#opaque'};
 for(const [status,due,paid,refund,want] of [['DRAFT','70',null,null,'not_started'],['SCHEDULED','70',null,null,'not_started'],['SENT','70',null,null,'due'],['UNPAID','70',null,null,'due'],['SHARED','70',null,null,'due'],['PARTIALLY_PAID','50','20',null,'partial'],['MARKED_AS_PAID','0','70',null,'review_required'],['PAID_EXTERNAL','0','70',null,'review_required'],['AUTO_CANCELLED','70',null,null,'unknown'],['MARKED_AS_REFUNDED','0','70','70','review_required'],['REFUNDED_EXTERNAL','0','70','70','review_required'],['PAID','0','70',null,'paid'],['PARTIALLY_REFUNDED','0','70','10','partially_refunded'],['REFUNDED','0','70','70','refunded'],['CANCELLED','0','70','70','refunded'],['PAYMENT_PENDING','0','70',null,'pending'],['NEW_STATUS','0','70',null,'unknown']]) {
  Object.assign(body,{status,due_amount:money(due),payments:{paid_amount:money(paid),transactions:[{type:'PAYPAL',payment_id:'P1',amount:money(paid)}]}});if(paid===null)delete body.payments;if(refund)body.refunds={refund_amount:money(refund),transactions:[{type:'PAYPAL',refund_id:'R1',amount:money(refund)}]};else delete body.refunds;
  const result=await orders.refreshPaymentStatus(order.id);assert.equal(result.financialState?.paymentState,want);assert.equal(result.approvalStatus,'approved');assert.equal(history(),before);assert.throws(()=>orders.editChangeOrder(order.id,{title:'Changed'}),/immutable/);assert.throws(()=>orders.submitForApproval(order.id),/immutable/);
 }
 body.status='PAID';body.payments.transactions[0].status='REVERSED';assert.equal((await orders.refreshPaymentStatus(order.id)).financialState.paymentState,'review_required');assert.equal(history(),before);
 assert.equal(db.prepare('SELECT count(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,19);assert.equal(provider.counts().creates,1);
});
test('authoritative reads serialize and reset fences a pending observation',async()=>{
 const provider=providerFixture({idPrefix:'INV2-SERIAL-'});globalThis.fetch=provider.fetch;const order=await approved(),invoice=await orders.ensureInvoice(order.id);let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let reads=0;
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/'+invoice.paypalInvoiceId)){reads++;if(reads===1){const response=await provider.fetch(url,init);entered();await gate;return response;}}return provider.fetch(url,init);};
 const first=orders.refreshPaymentStatus(order.id);await started;const second=orders.refreshPaymentStatus(order.id);await new Promise(r=>setImmediate(r));assert.equal(reads,1,'second retrieval must not start before first completes');provider.invoices.get(invoice.paypalInvoiceId).status='CANCELLED';release();await first;assert.equal((await second).financialState.invoiceState,'cancelled');
 let unblock,ready;const blocked=new Promise(r=>unblock=r),began=new Promise(r=>ready=r);globalThis.fetch=async(url,init)=>{const result=await provider.fetch(url,init);ready();await blocked;return result;};const pending=orders.refreshPaymentStatus(order.id);await began;orders.resetDemoRun(order.runId);unblock();await assert.rejects(pending,/reset|active/i);assert.equal(orders.getChangeOrder(order.id),null);
});
test('cancelled and refunded approved quotes remain visible and renewable without widening client grant',async()=>{
 const judging=await app.load('judging'),portal=await app.load('agentPortal'),{saveAgentPolicy}=await app.load('agentPolicy');
 const context=await app.load('context'),service=await app.load('changeOrderService');
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=judging.startJudgeRun(access.credential);
 saveAgentPolicy(owner,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1});
 const credential=portal.createPortalAccess(owner),client=portal.getPortalSession(credential.credential),request=portal.addPortalRequest(client,'Mobile please','financial-access');
 const order=orders.submitForApproval(orders.createChangeOrder(draftInput(),owner.runId).id),second=orders.createChangeOrder(draftInput(),owner.runId);
 db.prepare("UPDATE agent_requests SET state='paid',order_id=?,quote_revision=? WHERE id=?").run(order.id,order.revision,request.id);
 const link=judging.createClientAccess(owner,order),renewal=link.approvalUrl.split('resume=')[1];orders.approveChangeOrder(order.id,{changeOrderId:order.id,changeOrderRevision:order.revision});
 const provider=providerFixture({idPrefix:'INV2-ACCESS-'});globalThis.fetch=provider.fetch;const invoiced=await orders.ensureInvoice(order.id),body=provider.invoices.get(invoiced.paypalInvoiceId);
 for(const status of ['CANCELLED','REFUNDED','PARTIALLY_REFUNDED','NEW_STATUS']){
  body.status=status;if(status.includes('REFUNDED')){body.payments={paid_amount:money('250'),transactions:[{type:'PAYPAL',payment_id:'P',amount:money('250')}]};body.refunds={refund_amount:money(status==='REFUNDED'?'250':'50'),transactions:[{type:'PAYPAL',refund_id:'R',amount:money(status==='REFUNDED'?'250':'50')}]};}
  await orders.refreshPaymentStatus(order.id);const latest=db.prepare('SELECT body FROM agent_messages WHERE request_id=? ORDER BY rowid DESC LIMIT 1').get(request.id);assert.match(latest.body,/Current financial status/);const view=portal.portalView(client).requests[0];assert.equal(view.order?.id,order.id,'financial outcome must not hide approved quote');assert.notEqual(view.state,'paid');
  const renewed=judging.renewJudgeSession(renewal);assert.ok(renewed,'client must retain renewal');const ctx=context.contextFromSessionToken(renewed.token);assert.equal(service.getScopedOrder(ctx,order.id).approvalStatus,'approved');assert.throws(()=>service.getScopedOrder(ctx,second.id),e=>e.status===403);
  assert.ok(judging.createClientAccess(owner,orders.getChangeOrder(order.id)).approvalUrl);
 }
});
test('send acknowledgement alone cannot leave an actionable due status when final retrieval fails',async()=>{
 const provider=providerFixture({idPrefix:'INV2-FAILED-GET-'});let reads=0;globalThis.fetch=async(url,init)=>{if(/\/invoices\/INV2-FAILED-GET-\d+$/.test(String(url))&&++reads===3)throw new Error('Final retrieval failed');return provider.fetch(url,init);};
 const order=await approved();await assert.rejects(orders.ensureInvoice(order.id),e=>e.category==='provider_transport' && e.retryable);assert.notEqual(orders.getChangeOrder(order.id).status,'payment_due');assert.equal(orders.getChangeOrder(order.id).approvalStatus,'approved');
});
test('legacy invoice identity survives refresh while a new invoice with missing items never downgrades',async()=>{
 const provider=providerFixture({idPrefix:'INV2-LEGACY-'});globalThis.fetch=provider.fetch;const order=await approved(),invoiced=await orders.ensureInvoice(order.id),body=provider.invoices.get(invoiced.paypalInvoiceId);
 db.prepare("UPDATE invoice_operations SET representation='aggregate-v0',approved_terms_json=NULL WHERE change_order_id=?").run(order.id);
 const description=order.deliverables.join('; ');body.items=[{name:description.slice(0,120),description:description.slice(0,1000),quantity:'1',unit_amount:money('70')}];delete body.detail.reference;
 assert.equal((await orders.refreshPaymentStatus(order.id)).financialState.representation,'aggregate-v0');assert.equal((await orders.ensureInvoice(order.id)).status,'payment_due');assert.equal(provider.counts().creates,1);
 const second=await approved(),next=await orders.ensureInvoice(second.id);delete provider.invoices.get(next.paypalInvoiceId).items;
 const invalid=await orders.refreshPaymentStatus(second.id);assert.equal(invalid.financialState.paymentState,'review_required');assert.equal(invalid.financialState.representation,'itemized-v1');assert.equal(invalid.approvalStatus,'approved');
 const sends=provider.counts().sends;await assert.rejects(orders.ensureInvoice(second.id),/match/);assert.equal(provider.counts().sends,sends);assert.equal(provider.counts().creates,2);
});
test('queued refresh rechecks authorization and synchronous fencing rolls back the entire observation',async()=>{
 const provider=providerFixture({idPrefix:'INV2-AUTH-'});globalThis.fetch=provider.fetch;const order=await approved(),invoiced=await orders.ensureInvoice(order.id);let release,entered,reads=0,allowed=true;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 globalThis.fetch=async(url,init)=>{reads++;const response=await provider.fetch(url,init);entered();await gate;return response;};
 const first=orders.refreshPaymentStatus(order.id);await started;const queued=orders.refreshPaymentStatus(order.id,()=>{if(!allowed)throw new Error('Authority revoked');});allowed=false;release();await first;await assert.rejects(queued,/Authority revoked/);assert.equal(reads,1);
 globalThis.fetch=provider.fetch;const before=db.prepare('SELECT count(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n;provider.invoices.get(invoiced.paypalInvoiceId).status='CANCELLED';
 await assert.rejects(orders.refreshPaymentStatus(order.id,undefined,()=>{throw new Error('Lease lost');}),/Lease lost/);assert.equal(db.prepare('SELECT count(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,before);assert.equal(orders.getChangeOrder(order.id).status,'payment_due');
});
