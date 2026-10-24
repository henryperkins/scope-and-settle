import {test} from 'node:test';
import assert from 'node:assert/strict';
import {milestoneFixture,splitSchedule} from './milestone-fixture.mjs';

test('T14 connector refresh retrieves created installment records and does not claim a cached read is fresh',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();f.markPaid(f.order.installments[0].paypalInvoiceId);
  const p=await f.service.getPaymentStatus(f.ctx,{orderId:f.order.id,expectedRevision:2,refresh:true});assert.equal(p.source,'provider_retrieval');assert.equal(p.paidMinor,10000);
 }finally{await f.close();}
});

test('T14 ambiguous legacy associations remain review-only on later reads and invoice recovery',async()=>{
 const f=await milestoneFixture();try{
  await f.approve();const first=f.order,other=f.orders.createChangeOrder({...first,title:'Other legacy',assessmentId:null},f.ctx.runId);
  f.db.prepare('UPDATE change_orders SET paypal_invoice_id=? WHERE id=?').run(first.paypalInvoiceId,other.id);
  const view=f.orders.getChangeOrder(first.id);assert.equal(view.status,'payment_review_required');assert.equal(view.invoiceUrl,null);
  await assert.rejects(f.orders.ensureInvoice(first.id),/association|review/i);await assert.rejects(f.orders.refreshPaymentStatus(first.id),/association|review/i);
 }finally{await f.close();}
});

test('T14 changed issue recipients invalidate the exact reviewed installment',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const balance=f.order.installments[1];f.db.prepare('INSERT INTO milestone_due_events VALUES(?,?,?,?,?)').run(balance.id,f.order.id,2,'fixture-review','now');
  const p=await f.actions.prepareMilestoneAction(f.ctx,{kind:'issue_approved_invoice',milestoneId:balance.id,expectedRevision:2});f.m.env.config.paypalBuyerEmail='changed@example.com';
  await assert.rejects(f.actions.confirmMilestoneAction(f.ctx,p.id,{previewHash:p.previewHash,consent:true}),/recipient/i);assert.equal(f.provider.counts().creates,1);
 }finally{await f.close();}
});

test('T14 unknown cancellation never repeats a notification and an owner revocation is enforced after reads',async()=>{
 const f=await milestoneFixture();const inner=globalThis.fetch;let writes=0;try{
  f.order=f.schedule();await f.approve();const p=await f.actions.prepareMilestoneAction(f.ctx,{kind:'cancel_invoice',milestoneId:f.order.installments[0].id,expectedRevision:2});
  globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/cancel')){writes++;throw new Error('lost notification');}return inner(url,init);};
  assert.equal((await f.actions.confirmMilestoneAction(f.ctx,p.id,{previewHash:p.previewHash,consent:true})).state,'uncertain');
  await f.actions.confirmMilestoneAction(f.ctx,p.id,{previewHash:p.previewHash,consent:true});assert.equal(writes,1);
  globalThis.fetch=async(url,init)=>{const response=await inner(url,init);if(String(url).includes('/invoices/'))f.db.prepare('UPDATE sessions SET revoked=1 WHERE token=?').run(f.session.token);return response;};
  await assert.rejects(f.actions.confirmMilestoneAction(f.ctx,p.id,{previewHash:p.previewHash,consent:true}),e=>e.status===401);assert.equal(writes,1);
 }finally{globalThis.fetch=inner;await f.close();}
});

test('T14 an uncertain send is checked without repeating the non-idempotent send',async()=>{
 const f=await milestoneFixture();const inner=globalThis.fetch;let sends=0;try{
  f.order=f.schedule();globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/send')){sends++;throw new Error('lost send response');}return inner(url,init);};
  await f.approve();const deposit=f.orders.getChangeOrder(f.order.id).installments[0];assert.equal(sends,1);assert.ok(deposit.paypalInvoiceId);
  await assert.rejects(f.milestones.ensureMilestoneInvoice(f.ctx,deposit.id),/uncertain|replay|review/i);assert.equal(sends,1);
 }finally{globalThis.fetch=inner;await f.close();}
});

test('T14 approved installment terms reject a modified operation before any provider effect',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const deposit=f.order.installments[0],op=f.db.prepare('SELECT * FROM invoice_operations WHERE change_order_id=?').get(f.order.id),terms=JSON.parse(op.approved_terms_json);terms.totalMinor=1;
  f.db.prepare('UPDATE invoice_operations SET approved_terms_json=? WHERE operation_key=?').run(JSON.stringify(terms),op.operation_key);
  const before=f.provider.counts();await assert.rejects(f.milestones.ensureMilestoneInvoice(f.ctx,deposit.id),/terms|operation|immutable/i);assert.deepEqual(f.provider.counts(),before);
 }finally{await f.close();}
});

test('T14 installment confirmation issues a due balance and enforces browser origin and exact selection',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const balance=f.order.installments[1];
  f.db.prepare('INSERT INTO milestone_due_events VALUES(?,?,?,?,?)').run(balance.id,f.order.id,f.order.revision,'synthetic-review',new Date().toISOString());
  const preview=await f.actions.prepareMilestoneAction(f.ctx,{kind:'issue_approved_invoice',milestoneId:balance.id,expectedRevision:2});
  const result=await f.actions.confirmMilestoneAction(f.ctx,preview.id,{previewHash:preview.previewHash,consent:true});assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(f.provider.counts().creates,2);assert.equal(f.provider.counts().sends,2);
  const next=await f.actions.prepareMilestoneAction(f.ctx,{kind:'cancel_invoice',milestoneId:balance.id,expectedRevision:2});
  const path='/api/installment-actions/'+next.id+'/confirm',body={previewHash:next.previewHash,consent:true};
  assert.equal((await f.http(path,'POST',body)).status,403);assert.equal((await f.http(path,'POST',body,f.session.token,{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await f.http(path,'POST',body,f.session.token,{Origin:f.base})).status,200);
 }finally{await f.close();}
});

test('T14 all payment projections retain installment identity and finance never changes scope fingerprints',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const ledger=await f.app.load('scopeLedger'),projection=await f.app.load('connectorProjections'),cards=await f.app.load('statusCards');
  const before=ledger.scopeContextForRun(f.ctx.runId);f.markPaid(f.order.installments[0].paypalInvoiceId);await f.orders.refreshPaymentStatus(f.order.id);const order=f.orders.getChangeOrder(f.order.id);
  const p=projection.projectPayment(order,'stored_observation');assert.equal(p.hasInvoice,true);assert.equal(p.paidMinor,10000);assert.equal(p.paymentState,'partial');assert.equal(p.installments.length,2);assert.equal(p.summary.futureUnbilledMinor,15000);assert.ok(!JSON.stringify(p).includes('paypal.com'));
  const card=cards.getStatusCard(f.ctx,order.id,2);assert.equal(card.paymentState,'partial');assert.equal(card.money,null);
  const after=ledger.scopeContextForRun(f.ctx.runId);assert.equal(after.contextFingerprint,before.contextFingerprint);assert.equal(after.commitments[0].financialState,null);assert.equal(after.commitments[0].installmentSummary.netPaidMinor,10000);
  await assert.rejects(f.actions.prepareOrderAction(f.ctx,'issue_approved_invoice',{orderId:order.id,expectedRevision:2}),/installment/i);
 }finally{await f.close();}
});

test('T14 split schedule is exact immutable consent and obsolete proposal links cannot approve it',async()=>{
 const f=await milestoneFixture();try{
  const old=await f.submit(f.order.id),oldToken=await f.redeem(old.approvalUrl);
  const next=f.schedule();assert.equal(next.revision,2);assert.equal(next.status,'draft');assert.equal(next.milestoneSchedule.milestones.length,2);
  assert.equal((await f.http('/api/change-orders/'+f.order.id+'/approve','POST',{},oldToken)).status,403);
  const approved=await f.approve();assert.equal(approved.approvalStatus,'approved');
  const saved=JSON.parse(f.db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=2').get(f.order.id).snapshot_json);
  assert.deepEqual(saved.milestoneSchedule,approved.milestoneSchedule);
  assert.throws(()=>f.milestones.setMilestoneSchedule(f.ctx,f.order.id,2,splitSchedule()),/immutable|approved/i);
 }finally{await f.close();}
});

test('T14 deposit payment never pays the whole order and delivery balance cannot be invoiced early',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();const order=await f.approve(),[deposit,balance]=order.installments;
  assert.equal(f.provider.counts().creates,1);assert.equal(deposit.amountMinor,10000);assert.equal(balance.amountMinor,15000);assert.equal(balance.paypalInvoiceId,null);
  await assert.rejects(f.milestones.ensureMilestoneInvoice(f.ctx,balance.id),/acceptance|trigger/i);
  await Promise.all([f.milestones.ensureMilestoneInvoice(f.ctx,deposit.id),f.milestones.ensureMilestoneInvoice(f.ctx,deposit.id)]);assert.equal(f.provider.counts().creates,1);
  f.markPaid(deposit.paypalInvoiceId);await f.orders.refreshPaymentStatus(order.id);
  const paid=f.orders.getChangeOrder(order.id);assert.equal(paid.status,'payment_due');assert.equal(paid.paypalInvoiceId,null);assert.equal(paid.invoiceUrl,null);
  assert.equal(paid.installmentSummary.workStartSatisfied,true);assert.equal(paid.installmentSummary.allObligationsPaid,false);assert.equal(paid.installmentSummary.netPaidMinor,10000);assert.equal(paid.installmentSummary.futureUnbilledMinor,15000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM invoice_operations WHERE change_order_id=?').get(order.id).n,1);
  const ctx=f.m.context.contextFromSessionToken(f.m.sessions.createSession({projectId:'demo',role:'designer',runId:'different-run'}).token);
  await assert.rejects(f.milestones.ensureMilestoneInvoice(ctx,deposit.id),e=>e.status===404);
 }finally{await f.close();}
});

test('T14 schedule rejects rounding, invalid IDs, self-funded work, missing prerequisites and stale edit revisions',async()=>{
 const f=await milestoneFixture();try{
  assert.equal(typeof f.milestones.setMilestoneSchedule,'function');
  const bad=[s=>s.milestones[1].amountMinor++,s=>s.milestones[0].amountMinor=.1,s=>s.milestones[1].id='deposit',s=>s.workStartPaymentMilestoneIds=['balance'],s=>s.workStartPaymentMilestoneIds=['missing'],s=>s.workStartPaymentMilestoneIds=[]];
  for(const change of bad){const s=splitSchedule();change(s);assert.throws(()=>f.milestones.setMilestoneSchedule(f.ctx,f.order.id,1,s));}
  f.schedule();assert.throws(()=>f.milestones.setMilestoneSchedule(f.ctx,f.order.id,1,splitSchedule()),/revision/i);assert.equal(f.provider.counts().creates,0);
 }finally{await f.close();}
});

test('T14 readback validates the exact installment number/amount and a reversed deposit requires financial review',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const [deposit]=f.order.installments,invoice=f.provider.invoices.get(deposit.paypalInvoiceId);
  f.markPaid(invoice.id);await f.milestones.refreshInvoiceRecord(deposit.invoiceRecordId);assert.equal(f.orders.getChangeOrder(f.order.id).installmentSummary.workStartSatisfied,true);
  invoice.payments={paid_amount:invoice.amount,transactions:[{type:'PAYPAL',payment_id:'deposit-pay',amount:invoice.amount}]};invoice.refunds={refund_amount:invoice.amount,transactions:[{type:'PAYPAL',refund_id:'refund',amount:invoice.amount}]};invoice.status='REFUNDED';
  await f.milestones.refreshInvoiceRecord(deposit.invoiceRecordId);assert.equal(f.orders.getChangeOrder(f.order.id).installmentSummary.workStartSatisfied,false);
  invoice.detail.invoice_number='WRONG';const result=await f.milestones.refreshInvoiceRecord(deposit.invoiceRecordId);assert.equal(result.financialState.paymentState,'review_required');
 }finally{await f.close();}
});

test('T14 each installment reconciles its own webhook and reset tombstones both provider identities',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();let [deposit,balance]=f.order.installments;
  f.db.prepare('INSERT INTO milestone_due_events VALUES(?,?,?,?,?)').run(balance.id,f.order.id,f.order.revision,'synthetic-accepted-review',new Date().toISOString());
  balance=await f.milestones.ensureMilestoneInvoice(f.ctx,balance.id);assert.equal(f.provider.counts().creates,2);
  f.markPaid(balance.paypalInvoiceId);
  f.jobs.enqueueJob({key:'balance-only-test',kind:'paypal_reconcile',projectId:'demo',runId:f.ctx.runId,payload:{invoiceId:balance.paypalInvoiceId,route:f.jobs.paypalRoute},dueAt:new Date().toISOString()});
  await f.jobs.runDueJobs(new Date());
  const result=f.orders.getChangeOrder(f.order.id);
  assert.equal(result.installments[1].financialState.paymentState,'paid');assert.equal(result.installments[0].financialState.paymentState,'due');assert.equal(result.installmentSummary.allObligationsPaid,false);
  f.markPaid(deposit.paypalInvoiceId);await f.orders.refreshPaymentStatus(f.order.id);assert.equal(f.orders.getChangeOrder(f.order.id).installmentSummary.netPaidMinor,25000);assert.equal(f.orders.getChangeOrder(f.order.id).status,'paid');
  f.orders.resetDemoRun(f.ctx.runId);assert.equal(f.orders.isTombstonedInvoice(deposit.paypalInvoiceId),true);assert.equal(f.orders.isTombstonedInvoice(balance.paypalInvoiceId),true);
 }finally{await f.close();}
});

test('T14 installment action previews have zero writes and confirmation affects only the selected invoice once',async()=>{
 const f=await milestoneFixture();try{
  f.order=f.schedule();await f.approve();const [deposit,balance]=f.order.installments;
  assert.equal(typeof f.actions.prepareMilestoneAction,'function','Exact installment human confirmation is required');
  await assert.rejects(f.actions.prepareMilestoneAction(f.ctx,{kind:'issue_approved_invoice',milestoneId:balance.id,expectedRevision:2}),/acceptance|trigger/i);
  const writes=f.writes,preview=await f.actions.prepareMilestoneAction(f.ctx,{kind:'cancel_invoice',milestoneId:deposit.id,expectedRevision:2});
  assert.equal(f.writes,writes);assert.equal(preview.amountMinor,10000);assert.equal(preview.invoiceRecordId,deposit.invoiceRecordId);
  await assert.rejects(f.actions.confirmMilestoneAction(f.client,preview.id,{previewHash:preview.previewHash,consent:true}),e=>e.status===403);
  await assert.rejects(f.actions.confirmMilestoneAction(f.ctx,preview.id,{previewHash:preview.previewHash,consent:false}),e=>e.status===400);
  const confirmed=await f.actions.confirmMilestoneAction(f.ctx,preview.id,{previewHash:preview.previewHash,consent:true});assert.equal(confirmed.state,'succeeded');assert.equal(f.writes,writes+1);
  await f.actions.confirmMilestoneAction(f.ctx,preview.id,{previewHash:preview.previewHash,consent:true});assert.equal(f.writes,writes+1);assert.equal(f.provider.invoices.get(deposit.paypalInvoiceId).status,'CANCELLED');
 }finally{await f.close();}
});
