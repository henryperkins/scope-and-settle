import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryFixture,outputFor,deliveryPng} from './delivery-fixture.mjs';
import {draftInput} from './helpers.mjs';
import {splitSchedule} from './milestone-fixture.mjs';
async function ready(){const f=await deliveryFixture();f.pay();f.run=await f.delivery.startApprovedWork(f.ctx,f.target.id);f.snapshot=f.delivery.recordDeliveryOutput(f.ctx,f.run.id,outputFor(f.run));f.review=()=>{assert.equal(typeof f.delivery.submitDelivery,'function','T16 requires exact delivery reviews');return f.delivery.submitDelivery(f.ctx,f.target.id,f.snapshot.id);};f.clientFor=async review=>{const access=f.delivery.issueDeliveryAccess(f.ctx,review.id),token=await f.redeem(access.deliveryUrl);return {token,ctx:f.m.context.contextFromSessionToken(token),access};};return f;}

test('T16 proposal and wrong-client grants cannot accept a delivery; explicit consent binds its actual snapshot',async()=>{
 const f=await ready();try{
  const review=f.review(),client=await f.clientFor(review);assert.equal(client.ctx.grant.kind,'delivery');assert.equal(review.snapshot.hash,f.snapshot.hash);assert.deepEqual(review.acceptanceCriteria,['One mobile checkout draft reviewed']);
  await assert.rejects(f.delivery.acceptDelivery(f.client,review.id,review.revision),e=>e.status===403);
  const wrong=f.m.sessions.createSession({projectId:'demo',runId:f.ctx.runId,role:'client',changeOrderId:'other',changeOrderRevision:2});await assert.rejects(f.delivery.acceptDelivery(f.m.context.contextFromSessionToken(wrong.token),review.id,review.revision),e=>e.status===403);
  const path='/api/delivery-reviews/'+review.id+'/accept';assert.equal((await f.http(path,'POST',{expectedRevision:review.revision,snapshotHash:f.snapshot.hash,consent:false},client.token,{Origin:f.base})).status,400);
  assert.equal((await f.http(path,'POST',{expectedRevision:review.revision,snapshotHash:'0'.repeat(64),consent:true},client.token,{Origin:f.base})).status,409);assert.equal(f.provider.counts().creates,1);
 }finally{await f.close();}
});

test('T16 replaced snapshots invalidate old delivery links and stale review revisions',async()=>{
 const f=await ready();try{
  const first=f.review(),old=await f.clientFor(first);const next=f.delivery.recordDeliveryOutput(f.ctx,f.run.id,outputFor(f.run,{imageDataUrl:deliveryPng(100)}));
  const second=f.delivery.submitDelivery(f.ctx,f.target.id,next.id);assert.equal(second.revision,first.revision+1);assert.notEqual(second.id,first.id);
  await assert.rejects(f.delivery.acceptDelivery(old.ctx,first.id,first.revision),e=>[401,403,409].includes(e.status));
  const client=await f.clientFor(second);await assert.rejects(f.delivery.acceptDelivery(client.ctx,second.id,first.revision),e=>e.status===409);assert.equal(f.provider.counts().creates,1);
  assert.equal(f.db.prepare('SELECT snapshot_hash FROM delivery_reviews WHERE id=?').get(first.id).snapshot_hash,first.snapshot.hash);
 }finally{await f.close();}
});

test('T16 requested changes remain append-only and cannot release a balance invoice',async()=>{
 const f=await ready();try{
  const review=f.review(),client=await f.clientFor(review),changed=f.delivery.requestDeliveryChanges(client.ctx,review.id,'Please adjust the mobile error state');assert.equal(changed.state,'changes_requested');
  await assert.rejects(f.delivery.acceptDelivery(client.ctx,review.id,review.revision),/changes|review/i);assert.equal(f.db.prepare('SELECT count(*) n FROM milestone_due_events').get().n,0);assert.equal(f.provider.counts().creates,1);
  assert.throws(()=>f.db.prepare("UPDATE delivery_events SET kind='accepted'").run(),/append|immutable/i);assert.throws(()=>f.db.prepare('DELETE FROM delivery_events').run(),/append|retained/i);
  const next=f.delivery.recordDeliveryOutput(f.ctx,f.run.id,outputFor(f.run,{imageDataUrl:deliveryPng(101)})),replacement=f.delivery.submitDelivery(f.ctx,f.target.id,next.id);assert.equal(replacement.revision,2);assert.ok(f.db.prepare("SELECT id FROM delivery_events WHERE kind='changes_requested'").get());
 }finally{await f.close();}
});

test('T16 concurrent acceptance saves one exact acceptance and one balance operation before creating it',async()=>{
 const f=await ready();const inner=globalThis.fetch;try{
  const review=f.review(),client=await f.clientFor(review);globalThis.fetch=async(url,init={})=>{if(String(url).endsWith('/invoices')&&init.method==='POST'){assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_acceptances').get().n,1);assert.equal(f.db.prepare('SELECT review_id FROM milestone_due_events').get().review_id,review.id);}return inner(url,init);};
  const outcomes=await Promise.all([f.delivery.acceptDelivery(client.ctx,review.id,review.revision),f.delivery.acceptDelivery(client.ctx,review.id,review.revision)]);assert.equal(outcomes[0].id,outcomes[1].id);assert.equal(outcomes[0].snapshotHash,f.snapshot.hash);assert.equal(f.db.prepare("SELECT count(*) n FROM delivery_events WHERE kind='accepted'").get().n,1);assert.equal(f.provider.counts().creates,2);assert.equal(f.provider.counts().sends,2);
  const order=f.orders.getChangeOrder(f.order.id);assert.equal(order.installmentSummary.netPaidMinor,10000);assert.equal(order.installmentSummary.payableDueMinor,15000);assert.equal(order.delivery.state,'accepted');assert.equal(order.status,'payment_due');
 }finally{globalThis.fetch=inner;await f.close();}
});

test('T16 a lost balance create resumes the same operation and acceptance without issuing another invoice',async()=>{
 const f=await ready();const inner=globalThis.fetch;let lost=false;try{
  const review=f.review(),client=await f.clientFor(review);globalThis.fetch=async(url,init={})=>{const response=await inner(url,init);if(!lost&&String(url).endsWith('/invoices')&&init.method==='POST'){lost=true;throw new Error('Lost create response');}return response;};
  const first=await f.delivery.acceptDelivery(client.ctx,review.id,review.revision);assert.ok(first.invoiceError);assert.equal(f.provider.counts().creates,2);const retry=await f.delivery.acceptDelivery(client.ctx,review.id,review.revision);assert.equal(retry.id,first.id);assert.equal(retry.invoiceError,undefined);assert.equal(f.provider.counts().creates,2);assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_acceptances').get().n,1);
 }finally{globalThis.fetch=inner;await f.close();}
});

test('T16 late reversal retains accepted version and generated history while payment independently requires review',async()=>{
 const f=await ready();try{
  const review=f.review(),client=await f.clientFor(review),accepted=await f.delivery.acceptDelivery(client.ctx,review.id,review.revision);const before=f.db.prepare('SELECT * FROM delivery_acceptances').get();
  const invoice=f.provider.invoices.get(f.deposit.paypalInvoiceId);invoice.status='REFUNDED';invoice.refunds={refund_amount:invoice.amount,transactions:[{type:'PAYPAL',refund_id:'late-reversal',amount:invoice.amount}]};await f.milestones.refreshInvoiceRecord(f.deposit.invoiceRecordId);
  const after=f.delivery.getDeliveryReview(client.ctx,review.id);assert.equal(after.acceptance.id,accepted.id);assert.equal(after.snapshot.hash,f.snapshot.hash);assert.equal(after.financialReviewRequired,true);assert.deepEqual(f.db.prepare('SELECT * FROM delivery_acceptances').get(),before);assert.equal(f.orders.getChangeOrder(f.order.id).delivery.state,'accepted');assert.equal(f.delivery.getDeliveryRun(f.ctx,f.run.id).financialReviewRequired,true);
  const cards=await f.app.load('statusCards');assert.equal(cards.getStatusCard(f.ctx,f.order.id,2).deliveryState,'accepted');
 }finally{await f.close();}
});

test('T16 a later balance refund also requires financial review while the deposit remains paid',async()=>{
 const f=await ready();try{
  const review=f.review(),client=await f.clientFor(review);await f.delivery.acceptDelivery(client.ctx,review.id,review.revision);let order=f.orders.getChangeOrder(f.order.id);const balance=order.installments[1];f.markPaid(balance.paypalInvoiceId);await f.milestones.refreshInvoiceRecord(balance.invoiceRecordId);
  const invoice=f.provider.invoices.get(balance.paypalInvoiceId);invoice.status='REFUNDED';invoice.refunds={refund_amount:invoice.amount,transactions:[{type:'PAYPAL',refund_id:'balance-refund',amount:invoice.amount}]};await f.milestones.refreshInvoiceRecord(balance.invoiceRecordId);
  assert.equal(f.orders.getChangeOrder(f.order.id).installmentSummary.workStartSatisfied,true);assert.equal(f.delivery.getDeliveryReview(client.ctx,review.id).financialReviewRequired,true);assert.equal(f.delivery.getDeliveryRun(f.ctx,f.run.id).financialReviewRequired,true);
  const projection=await f.app.load('connectorProjections');assert.equal(projection.projectPayment(f.orders.getChangeOrder(f.order.id),'stored_observation').paymentState,'partially_refunded');
 }finally{await f.close();}
});

test('T16 a delivery grant for another work item cannot accept this snapshot',async()=>{
 const f=await ready();try{
  const review=f.review(),other=f.milestones.setMilestoneSchedule(f.ctx,f.orders.createChangeOrder(draftInput(),f.ctx.runId).id,1,splitSchedule()),submitted=await f.submit(other.id),proposalToken=await f.redeem(submitted.approvalUrl);
  assert.equal((await f.http('/api/change-orders/'+other.id+'/approve','POST',{},proposalToken)).status,200);const order=f.orders.getChangeOrder(other.id);f.markPaid(order.installments[0].paypalInvoiceId);
  const run=await f.delivery.startApprovedWork(f.ctx,order.installments[1].id),snapshot=f.delivery.recordDeliveryOutput(f.ctx,run.id,outputFor(run)),otherReview=f.delivery.submitDelivery(f.ctx,run.milestoneId,snapshot.id),otherClient=await f.clientFor(otherReview);
  await assert.rejects(f.delivery.acceptDelivery(otherClient.ctx,review.id,review.revision),e=>e.status===403);assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_acceptances').get().n,0);
 }finally{await f.close();}
});

test('T16 client revocation after a balance create retains acceptance and known ID for a fresh authorized recovery',async()=>{
 const f=await ready();const inner=globalThis.fetch;try{
  const review=f.review(),client=await f.clientFor(review);globalThis.fetch=async(url,init={})=>{const response=await inner(url,init);if(String(url).endsWith('/invoices')&&init.method==='POST')f.m.sessions.revokeSession(client.token);return response;};
  await assert.rejects(f.delivery.acceptDelivery(client.ctx,review.id,review.revision),e=>e.status===401);assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_acceptances').get().n,1);assert.equal(f.provider.counts().creates,2);assert.equal(f.provider.counts().sends,1);
  const fresh=await f.clientFor(review),outcome=await f.delivery.acceptDelivery(fresh.ctx,review.id,review.revision);assert.equal(outcome.invoiceError,undefined);assert.equal(f.provider.counts().creates,2);assert.equal(f.provider.counts().sends,2);
 }finally{globalThis.fetch=inner;await f.close();}
});

test('T16 renewable delivery grants in a frozen judging run stay exact and expire on review replacement',async()=>{
 const f=await deliveryFixture();try{
  const judging=await f.app.load('judging'),access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=judging.startJudgeRun(access.credential),ctx=f.m.context.contextFromSessionToken(owner.token);
  const order=f.milestones.setMilestoneSchedule(ctx,f.orders.createChangeOrder(draftInput(),owner.runId).id,1,splitSchedule()),proposal=f.service.submitScopedOrder(ctx,order.id),proposalSession=judging.renewJudgeSession(proposal.approvalUrl.split('resume=')[1]);
  await f.service.approveScopedOrder(f.m.context.contextFromSessionToken(proposalSession.token),order.id);const current=f.orders.getChangeOrder(order.id);f.markPaid(current.installments[0].paypalInvoiceId);
  const run=await f.delivery.startApprovedWork(ctx,current.installments[1].id),snapshot=f.delivery.recordDeliveryOutput(ctx,run.id,outputFor(run)),review=f.delivery.submitDelivery(ctx,run.milestoneId,snapshot.id),link=f.delivery.issueDeliveryAccess(ctx,review.id),credential=link.deliveryUrl.split('resume=')[1];
  assert.ok(credential);const first=judging.renewJudgeSession(credential);assert.equal(first.grantKind,'delivery');assert.equal(first.resourceId,review.id);f.db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE token=?").run(first.token);
  const renewed=judging.renewJudgeSession(credential);assert.equal(f.delivery.getDeliveryReview(f.m.context.contextFromSessionToken(renewed.token),review.id).snapshot.hash,snapshot.hash);
  const replacement=f.delivery.recordDeliveryOutput(ctx,run.id,outputFor(run,{imageDataUrl:deliveryPng(111)}));f.delivery.submitDelivery(ctx,run.milestoneId,replacement.id);assert.equal(judging.renewJudgeSession(credential),null);
 }finally{await f.close();}
});
