import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {milestoneFixture} from './milestone-fixture.mjs';
import {draftInput} from './helpers.mjs';
const DAY=86400000;
async function setup(){
 const f=await milestoneFixture();f.order=f.schedule();await f.approve();
 f.reminders=await f.app.load('installmentReminders').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 if(typeof f.reminders.prepareInstallmentReminderPolicy!=='function'){
  await f.close();assert.fail('Exact-installment reminder policy required');
 }
 f.owner=()=>{Object.assign(f.session,f.m.sessions.createSession({projectId:'demo',role:'designer',runId:f.order.runId}));f.ctx=f.m.context.contextFromSessionToken(f.session.token);};
 f.consent=async()=>{const p=await f.reminders.prepareInstallmentReminderPolicy(f.ctx,f.order.id,f.order.revision);return f.reminders.confirmInstallmentReminderPolicy(f.ctx,p.id,{previewHash:p.previewHash,consent:true});};
 f.deposit=()=>f.orders.getChangeOrder(f.order.id).installments.find(m=>m.localId==='deposit'||m.title==='Deposit');
 f.run=()=>f.jobs.runInboxJobs(new Date(),'installment_reminder');
 f.queue=()=>f.reminders.queueInstallmentReminders(new Date());
 f.age=hours=>{mock.timers.enable({apis:['Date'],now:Date.now()+hours*3600000});f.owner();};
 f.holdInvoice=()=>{const inner=globalThis.fetch;let enter,release;const reached=new Promise(r=>enter=r),held=new Promise(r=>release=r);let once=true;
  globalThis.fetch=async(url,init)=>{const response=await inner(url,init);if(once&&new URL(url).pathname.endsWith('/'+f.deposit().paypalInvoiceId)){once=false;enter();await held;}return response;};
  return {reached,release(){release();globalThis.fetch=inner;}};};
 return f;
}
async function done(f){mock.timers.reset();await f?.close();}

test('C3 reminders default off; a manual order without an agent request needs fresh designer consent',async()=>{
 let f;try {
  f=await setup();assert.equal(f.count('SELECT count(*) n FROM agent_requests'),0);
  assert.equal(f.reminders.getInstallmentReminderPolicy(f.ctx,f.order.id),null);assert.equal(f.queue(),0);
  f.m.agentPolicy.saveAgentPolicy(f.session,{enabled:true,consent:true,paypalReminders:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:100000,maxQuantity:1});
  assert.equal(f.queue(),0);
  const preview=await f.reminders.prepareInstallmentReminderPolicy(f.ctx,f.order.id,f.order.revision);
  assert.equal(f.writes,0);assert.equal(preview.installments.length,2);assert.equal(preview.cadenceMs,DAY);assert.equal(preview.maxAutomaticReminders,2);
  await assert.rejects(f.reminders.prepareInstallmentReminderPolicy(f.client,f.order.id,f.order.revision),e=>e.status===403);
  await assert.rejects(f.reminders.prepareInstallmentReminderPolicy({...f.ctx},f.order.id,f.order.revision),e=>e.status===401);
  const foreign=f.m.context.contextFromSessionToken(f.m.sessions.createSession({projectId:'demo',role:'designer',runId:'foreign-run'}).token);
  await assert.rejects(f.reminders.prepareInstallmentReminderPolicy(foreign,f.order.id,f.order.revision),e=>e.status===403);
  f.m.env.config.mcpConnectorEnabled=true;const auth=await f.app.load('mcpAuth'),credential=auth.issueConnectorCredential(f.ctx,{consent:true}),connector=auth.mintConnectorContext('Bearer '+credential.secret,'get_project_scope');
  await assert.rejects(f.reminders.prepareInstallmentReminderPolicy(connector,f.order.id,f.order.revision),e=>e.status===401);
  assert.throws(()=>f.reminders.confirmInstallmentReminderPolicy(connector,preview.id,{previewHash:preview.previewHash,consent:true}),e=>e.status===401);
  assert.throws(()=>f.reminders.confirmInstallmentReminderPolicy(f.ctx,preview.id,{previewHash:preview.previewHash,consent:false}),e=>e.status===400);
  const view=f.reminders.confirmInstallmentReminderPolicy(f.ctx,preview.id,{previewHash:preview.previewHash,consent:true});assert.equal(view.status,'active');assert.equal(f.writes,0);
  assert.doesNotMatch(JSON.stringify(view),/ownerSessionHash|parentRef|ssc1\.|secret|token/i);
 }finally{await done(f);}
});

test('C3 an accepted balance starts its own issue clock while a paid deposit is excluded from fresh consent',async()=>{
 let f;try {
  f=await setup();f.age(25);f.markPaid(f.deposit().paypalInvoiceId);await f.milestones.refreshInvoiceRecord(f.deposit().invoiceRecordId);
  const balance=f.orders.getChangeOrder(f.order.id).installments.find(m=>m.title==='Delivery balance');
  f.db.prepare('INSERT INTO milestone_due_events VALUES(?,?,?,?,?)').run(balance.id,f.order.id,f.order.revision,'synthetic-accepted-review',new Date().toISOString());
  await f.milestones.ensureMilestoneInvoice(f.ctx,balance.id);
  const issued=Date.parse(f.db.prepare('SELECT updated_at FROM invoice_operations WHERE operation_key=(SELECT operation_key FROM invoice_records WHERE id=?)').get(balance.invoiceRecordId).updated_at);
  const first=await f.consent();assert.equal(first.installments.find(m=>m.title==='Deposit').covered,false);assert.equal(f.queue(),0);
  mock.timers.tick(23*3600000);f.owner();await f.consent();
  mock.timers.setTime(issued+DAY-1);assert.equal(f.queue(),0);mock.timers.setTime(issued+DAY);assert.equal(f.queue(),1);
  assert.equal((await f.run()).completed,1);assert.equal(f.writes,1);
  assert.equal(JSON.parse(f.db.prepare("SELECT payload_json FROM jobs WHERE kind='installment_reminder'").get().payload_json).invoiceRecordId,balance.invoiceRecordId);
 }finally{await done(f);}
});

test('C3 retained legacy and shared automatic history count once and enforce the same lifetime cap',async()=>{
 for(const indexed of [false,true]){
  let f;try {
   f=await setup();f.age(73);const invoiceId=f.deposit().paypalInvoiceId,at=new Date(Date.now()-2*DAY).toISOString();
   const request=f.store.createRequest(f.ctx.runId,'portal','legacy-auto','Legacy reminder fixture',{inboxOnly:true});
   f.db.prepare("INSERT INTO agent_outbox(id,request_id,run_id,kind,body,state,marker,attempts,created_at,updated_at) VALUES('legacy-auto',?,?,'reminder',?,'sent','legacy-reminder-marker',1,?,?)").run(request.id,f.ctx.runId,JSON.stringify({invoiceId}),at,at);
   const outbound=await f.app.load('outboundActions');
   if(indexed)f.db.prepare("INSERT INTO outbound_operations(outbox_id,authority,run_id,invoice_key,kind,state,dispatch_started,attempted_at,created_at,updated_at) VALUES('legacy-auto','policy',?,?,'reminder','acknowledged',1,?,?,?)").run(f.ctx.runId,outbound.invoiceActionKey(invoiceId),at,at,at);
   assert.equal(outbound.reminderHistory(invoiceId).automaticAttempts,1);
   await f.consent();assert.equal(f.queue(),1);assert.equal((await f.run()).completed,1);assert.equal(f.writes,1);
   assert.equal(outbound.reminderHistory(invoiceId).automaticAttempts,2);
   mock.timers.tick(DAY+1);f.owner();await f.consent();assert.equal(f.queue(),0);
  }finally{await done(f);}
 }
});

test('C3 malformed queue payload and changed provider recipient refuse without a send',async()=>{
 for(const mode of ['payload','recipient']){
  let f;try {
   f=await setup();f.age(25);await f.consent();assert.equal(f.queue(),1);
   if(mode==='payload'){const row=f.db.prepare("SELECT id,payload_json FROM jobs WHERE kind='installment_reminder'").get(),p=JSON.parse(row.payload_json);p.ownerId='forged';f.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(p),row.id);}
   else f.provider.invoices.get(f.deposit().paypalInvoiceId).primary_recipients[0].billing_info.email_address='wrong@example.com';
   await f.run();const job=f.db.prepare("SELECT state,error_category FROM jobs WHERE kind='installment_reminder'").get();assert.equal(job.state,'failed');
   assert.equal(job.error_category,mode==='payload'?'invalid_payload':'reminder_review_required');assert.equal(f.writes,0);
  }finally{await done(f);}
 }
});

test('C3 reminder consent expires no later than the parent designer grant',async()=>{
 let f;try {
  f=await setup();const judging=await f.app.load('judging'),expiresAt=new Date(Date.now()+30*60000).toISOString(),entry=judging.createJudgeAccess({expiresAt});
  Object.assign(f.session,judging.startJudgeRun(entry.credential));f.ctx=f.m.context.contextFromSessionToken(f.session.token);
  f.order=f.orders.createChangeOrder(draftInput(),f.ctx.runId);f.order=f.schedule();
  const submitted=await f.submit(f.order.id),renewed=await f.http('/api/session/renew','POST',{credential:submitted.approvalUrl.split('#resume=')[1]},null);assert.equal(renewed.status,200);
  f.clientToken=renewed.body.token;f.client=f.m.context.contextFromSessionToken(f.clientToken);
  assert.equal((await f.http('/api/change-orders/'+f.order.id+'/approve','POST',{},f.clientToken)).status,200);f.order=f.orders.getChangeOrder(f.order.id);
  const p=await f.consent();assert.equal(p.parentKind,'grant');assert.ok(Date.parse(p.expiresAt)<=Date.parse(expiresAt));
  assert.ok(Date.parse(p.expiresAt)<=Date.now()+DAY);assert.equal(f.writes,0);
 }finally{await done(f);}
});

test('C3 policy HTTP confirmation requires active designer, same origin and exact displayed consent',async()=>{
 let f;try {
  f=await setup();const path='/api/change-orders/'+f.order.id+'/installment-reminder-policy';
  const prepared=await f.http(path+'/prepare','POST',{expectedRevision:f.order.revision},f.session.token,{Origin:f.base});assert.equal(prepared.status,201);
  const p=prepared.body,confirm='/api/installment-reminder-policies/'+p.id+'/confirm',body={previewHash:p.previewHash,consent:true};
  assert.equal((await f.http(confirm,'POST',body,f.session.token,{Origin:'https://wrong.example'})).status,403);
  assert.equal((await f.http(confirm,'POST',{...body,consent:false},f.session.token,{Origin:f.base})).status,400);
  assert.equal((await f.http(confirm,'POST',body,f.clientToken,{Origin:f.base})).status,403);
  assert.equal((await f.http(confirm,'POST',body,f.session.token,{Origin:f.base})).status,200);
  assert.equal((await f.http(path)).body.status,'active');assert.equal(f.writes,0);
 }finally{await done(f);}
});

test('C3 exact deposit reminder starts at later issue eligibility and never reminds an unaccepted balance',async()=>{
 let f;try {
  f=await setup();const issued=Date.parse(f.db.prepare('SELECT updated_at FROM invoice_operations WHERE paypal_invoice_id=?').get(f.deposit().paypalInvoiceId).updated_at);
  f.age(23);const policy=await f.consent();
  mock.timers.setTime(issued+DAY-1);assert.equal(f.queue(),0);
  mock.timers.setTime(issued+DAY);assert.equal(f.queue(),1);assert.equal(f.queue(),0);
  assert.equal((await f.run()).completed,1);assert.equal(f.writes,1);assert.equal(f.queue(),0);
  assert.deepEqual(f.notifications,[{kind:'remind',invoiceId:f.deposit().paypalInvoiceId}]);
  const attempt=f.db.prepare("SELECT * FROM outbound_operations WHERE authority='policy'").get();assert.equal(attempt.dispatch_started,1);assert.equal(attempt.state,'acknowledged');
  const jobs=f.db.prepare("SELECT payload_json FROM jobs WHERE kind='installment_reminder'").all();assert.equal(jobs.length,1);assert.equal(JSON.parse(jobs[0].payload_json).invoiceRecordId,f.deposit().invoiceRecordId);
  assert.equal(f.orders.getChangeOrder(f.order.id).installments.find(m=>m.title==='Delivery balance').paypalInvoiceId,null);
  assert.equal(f.reminders.getInstallmentReminderPolicy(f.ctx,f.order.id).id,policy.id);
  const paused=f.reminders.pauseInstallmentReminderPolicy(f.ctx,policy.id,policy.version);
  assert.equal(paused.lastResult?.state,'acknowledged');assert.equal(paused.lastResult?.policyId,policy.id);assert.equal(paused.lastResult?.policyVersion,1);
 }finally{await done(f);}
});

test('C3 policy renewals never refill the two automatic reminder lifetime allowance',async()=>{
 let f;try {
  f=await setup();f.age(25);
  for(let n=1;n<=2;n++){
   f.owner();await f.consent();assert.equal(f.queue(),1);assert.equal((await f.run()).completed,1);assert.equal(f.writes,n);mock.timers.tick(DAY+1);
  }
  f.owner();await f.consent();assert.equal(f.queue(),0);assert.equal(f.writes,2);
  assert.equal(f.reminders.getInstallmentReminderPolicy(f.ctx,f.order.id).installments.find(m=>m.title==='Deposit').automaticAttempts,2);
 }finally{await done(f);}
});

test('C3 paused, revoked, changed-revision and reset authority fences queued work after a held invoice GET',async()=>{
 for(const mode of ['pause','revoke','merchant','recipient','revision','reset']) {
  let f,gate;try {
   f=await setup();f.age(25);const policy=await f.consent();assert.equal(f.queue(),1);gate=f.holdInvoice();const pending=f.run();await gate.reached;
   if(mode==='pause')f.reminders.pauseInstallmentReminderPolicy(f.ctx,policy.id,policy.version);
   if(mode==='revoke')f.m.sessions.revokeSession(f.session.token);
   if(mode==='merchant')f.m.env.config.paypalMerchantEmail='other@example.com';
   if(mode==='recipient')f.m.env.config.paypalBuyerEmail='other@example.com';
   if(mode==='revision')f.db.prepare('UPDATE change_orders SET revision=revision+1 WHERE id=?').run(f.order.id);
   if(mode==='reset')f.orders.resetDemoRun(f.ctx.runId);
   gate.release();await pending;assert.equal(f.writes,0,mode);assert.equal(f.queue(),0,mode);
  }finally{gate?.release();await done(f);}
 }
});

test('C3 explicit delegation survives natural session expiry but not policy expiry',async()=>{
 let f;try {
  f=await setup();f.age(25);await f.consent();
  f.db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE token=?").run(f.session.token);
  assert.equal(f.queue(),1);assert.equal((await f.run()).completed,1);assert.equal(f.writes,1);
  mock.timers.tick(DAY);assert.equal(f.queue(),0);
 }finally{await done(f);}
});

test('C3 lost notification response remains one durable uncertain send through restart and renewed consent',async()=>{
 let f;try {
  f=await setup();f.age(25);await f.consent();assert.equal(f.queue(),1);
  const inner=globalThis.fetch;globalThis.fetch=async(url,init)=>{const reply=await inner(url,init);if(new URL(url).pathname.endsWith('/remind'))throw new TypeError('lost response');return reply;};
  assert.equal((await f.run()).failed,1);globalThis.fetch=inner;assert.equal(f.writes,1);
  const outbound=await f.app.load('outboundActions');outbound.recoverOutbound();
  mock.timers.tick(DAY+1);f.owner();await f.consent();assert.equal(f.queue(),0);await f.run();assert.equal(f.writes,1);
  assert.equal(f.db.prepare("SELECT state FROM outbound_operations WHERE dispatch_started=1").get().state,'uncertain');
 }finally{await done(f);}
});

test('C3 authoritative payment, cancellation, refund and unknown invoice states refuse before dispatch',async()=>{
 for(const state of ['PAID','CANCELLED','PARTIALLY_PAID','PAYMENT_PENDING','SCHEDULED','UNKNOWN','refund']){
  let f;try {
   f=await setup();f.age(25);await f.consent();assert.equal(f.queue(),1);
   const invoice=f.provider.invoices.get(f.deposit().paypalInvoiceId);if(state==='refund')invoice.refunds={transactions:[{}]};else invoice.status=state;
   assert.equal((await f.run()).failed,1);assert.equal(f.writes,0,state);
  }finally{await done(f);}
 }
});

test('C3 a manual reminder racing a policy read claims the shared cadence and only one send occurs',async()=>{
 let f,gate;try {
  f=await setup();f.age(25);await f.consent();
  const p=await f.actions.prepareMilestoneAction(f.ctx,{kind:'remind_invoice',milestoneId:f.deposit().id,expectedRevision:f.order.revision});
  assert.equal(f.queue(),1);gate=f.holdInvoice();const pending=f.run();await gate.reached;
  await f.actions.confirmMilestoneAction(f.ctx,p.id,{previewHash:p.previewHash,consent:true});
  gate.release();await pending;assert.equal(f.writes,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM outbound_operations WHERE authority='policy' AND dispatch_started=1").get().n,0);
  assert.equal(f.queue(),0);
 }finally{gate?.release();await done(f);}
});

test('C3 a known provider rejection retains backoff and is not relabeled uncertain',async()=>{
 let f;try {
  f=await setup();f.age(25);await f.consent();assert.equal(f.queue(),1);
  const inner=globalThis.fetch;globalThis.fetch=async(url,init)=>{const response=await inner(url,init);return new URL(url).pathname.endsWith('/remind')?new Response(null,{status:429,headers:{'Retry-After':'3600'}}):response;};
  assert.equal((await f.run()).failed,1);globalThis.fetch=inner;
  const row=f.db.prepare("SELECT * FROM outbound_operations WHERE authority='policy'").get();assert.equal(row.state,'denied');assert.equal(row.dispatch_started,1);assert.ok(row.retry_after_at>Date.now());assert.equal(f.queue(),0);
 }finally{await done(f);}
});

test('C3 unissued record metadata cannot differ from the immutable approved schedule',async()=>{
 let f;try {
  f=await setup();const balance=f.orders.getChangeOrder(f.order.id).installments.find(m=>m.title==='Delivery balance');
  f.db.prepare("UPDATE milestones SET amount_minor=1 WHERE id=?").run(balance.id);
  await assert.rejects(f.reminders.prepareInstallmentReminderPolicy(f.ctx,f.order.id,f.order.revision),e=>e.status===409);assert.equal(f.writes,0);
 }finally{await done(f);}
});

test('C3 canonical merchant spelling changes cannot refill history or bypass an uncertain invoice lock',async()=>{
 for(const uncertain of [false,true]){
  let f;try {
   f=await setup();f.age(25);await f.consent();assert.equal(f.queue(),1);
   const inner=globalThis.fetch;if(uncertain)globalThis.fetch=async(url,init)=>{const response=await inner(url,init);if(new URL(url).pathname.endsWith('/remind'))throw new TypeError('lost response');return response;};
   await f.run();globalThis.fetch=inner;assert.equal(f.writes,1);
   // A retained key from the historical writer that did not trim merchant input.
   f.db.prepare("UPDATE outbound_operations SET invoice_key=? WHERE authority='policy'").run('sandbox: merchant@example.com :'+f.deposit().paypalInvoiceId);
   f.m.env.config.paypalMerchantEmail=' MERCHANT@example.com ';mock.timers.tick(DAY+1);f.owner();const renewed=await f.consent();
   assert.equal(renewed.installments.find(m=>m.title==='Deposit').automaticAttempts,1);
   if(uncertain){assert.equal(renewed.installments.find(m=>m.title==='Deposit').actionBlocked,true);assert.equal(f.queue(),0);}
   else {
    assert.equal(f.queue(),1);await f.run();assert.equal(f.writes,2);
    f.m.env.config.paypalMerchantEmail='Merchant@EXAMPLE.COM';mock.timers.tick(DAY+1);f.owner();const last=await f.consent();
    assert.equal(last.installments.find(m=>m.title==='Deposit').automaticAttempts,2);assert.equal(f.queue(),0);
   }
  }finally{await done(f);}
 }
});
