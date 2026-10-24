import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';
const app=await isolatedApp();
const {db}=await app.load('db'), orders=await app.load('orders'), webhooks=await app.load('webhooks');
const provider=providerFixture(), originalFetch=globalThis.fetch;
globalThis.fetch=provider.fetch;
after(()=>{globalThis.fetch=originalFetch;db.close();});
const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/test','paypal-transmission-id':'fixture','paypal-transmission-sig':'valid','paypal-transmission-time':new Date().toISOString()};
async function invoice(){let o=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(o.id,{changeOrderId:o.id,changeOrderRevision:o.revision});return orders.ensureInvoice(o.id);}
const event=(id,invoiceId)=>({id,event_type:'INVOICING.INVOICE.PAID',resource:{invoice:{id:invoiceId}}});
test('verified acceptance commits a receipt and job before any authoritative retrieval',async()=>{
 const o=await invoice(), before=db.prepare('SELECT COUNT(*) n FROM payment_observations').get().n;
 assert.deepEqual(await webhooks.receiveWebhook(headers,event('durable',o.paypalInvoiceId)),{state:'queued'});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations').get().n,before);
 const receipt=db.prepare('SELECT * FROM webhook_receipts WHERE id=?').get('durable');
 assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get(receipt.job_id).state,'pending');
});
const jobs=await app.load('jobs');
function run(now=new Date()){assert.equal(typeof jobs.runDueJobs,'function','durable worker required');return jobs.runDueJobs(now);}
function job(id){return db.prepare('SELECT * FROM jobs WHERE job_key=?').get(`paypal:event:${jobs.paypalRoute}:${id}`);}
function due(id){db.prepare("UPDATE jobs SET due_at=? WHERE id=?").run(new Date().toISOString(),id);}
function paid(o){const i=provider.invoices.get(o.paypalInvoiceId);i.status='PAID';i.due_amount.value='0.00';i.payments={paid_amount:{...i.amount},transactions:[{type:'PAYPAL',payment_id:'PAY-'+o.id,amount:{...i.amount}}]};}
function approvals(o){return JSON.stringify(db.prepare('SELECT * FROM approvals WHERE change_order_id=?').all(o.id));}

test('worker retrieves truth, preserves approval and duplicate deliveries never repeat financial effects',async()=>{
 const o=await invoice();paid(o);const approval=approvals(o),calls=provider.counts();
 await webhooks.receiveWebhook(headers,event('process',o.paypalInvoiceId));
 assert.equal((await run()).completed>=1,true);
 assert.equal(orders.getChangeOrder(o.id).financialState.paymentState,'paid');
 assert.equal(approvals(o),approval);assert.deepEqual(provider.counts(),calls);
 const before=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n;
 assert.deepEqual(await webhooks.receiveWebhook(headers,event('process',o.paypalInvoiceId)),{state:'duplicate'});
 await run();assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,before);
 assert.equal(job('process').state,'completed');
});
test('receipt and job rollback together when receipt storage fails',async()=>{
 const o=await invoice();db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON webhook_receipts WHEN NEW.id='atomic' BEGIN SELECT RAISE(ABORT,'fixture'); END");
 try{await assert.rejects(()=>webhooks.receiveWebhook(headers,event('atomic',o.paypalInvoiceId)),/fixture/);assert.equal(job('atomic'),undefined);}finally{db.exec('DROP TRIGGER fail_receipt');}
});
test('unmatched work never fetches unknown invoices and wakes after a bounded matching failure when association appears',async()=>{
 const o=await invoice(),id=o.paypalInvoiceId;db.prepare('UPDATE change_orders SET paypal_invoice_id=NULL WHERE id=?').run(o.id);db.prepare('UPDATE invoice_operations SET paypal_invoice_id=NULL WHERE change_order_id=?').run(o.id);
 let reads=0;globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+id))reads++;return provider.fetch(u,i);};
 await webhooks.receiveWebhook(headers,event('unmatched',id));await run();assert.equal(reads,0);
 db.prepare("UPDATE jobs SET attempts=7,due_at=? WHERE id=?").run(new Date().toISOString(),job('unmatched').id);await run();assert.equal(job('unmatched').state,'failed');
 db.prepare('UPDATE change_orders SET paypal_invoice_id=? WHERE id=?').run(id,o.id);db.prepare('UPDATE invoice_operations SET paypal_invoice_id=? WHERE change_order_id=?').run(id,o.id);
 await run();assert.equal(reads,1);assert.equal(job('unmatched').state,'completed');assert.equal(job('unmatched').run_id,o.runId);globalThis.fetch=provider.fetch;
});
test('failed legacy receipts recover without a new webhook; ignored receipts require fresh verification',async()=>{
 const o=await invoice();db.prepare("INSERT INTO webhook_receipts (id,invoice_id,state) VALUES (?,?,'failed')").run('legacy-failed',o.paypalInvoiceId);
 db.prepare("INSERT INTO webhook_receipts (id,state) VALUES (?,'ignored')").run('legacy-ignored');
 await run();assert.equal(db.prepare('SELECT state FROM webhook_receipts WHERE id=?').get('legacy-failed').state,'reconciled');
 assert.equal(db.prepare('SELECT job_id FROM webhook_receipts WHERE id=?').get('legacy-ignored').job_id,null);
 await webhooks.receiveWebhook(headers,event('legacy-ignored',o.paypalInvoiceId));await run();assert.equal(db.prepare('SELECT state FROM webhook_receipts WHERE id=?').get('legacy-ignored').state,'reconciled');
});
test('429 guidance is persisted without shortening provider minimum and exhaustion pauses automatic retries',async()=>{
 const o=await invoice(),before=approvals(o);let reads=0;
 globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){reads++;return Promise.resolve(new Response('private provider body',{status:429,headers:{'Retry-After':'7200'}}));}return provider.fetch(u,i);};
 await webhooks.receiveWebhook(headers,event('rate',o.paypalInvoiceId));const now=new Date();await run(now);
 assert.equal(job('rate').state,'pending');assert.ok(Date.parse(job('rate').due_at)>=now.getTime()+7200000);assert.equal(job('rate').http_status,429);assert.equal(job('rate').error_category,'provider_rate_limit');
 assert.ok(!JSON.stringify(job('rate')).includes('private provider body'));
 db.prepare("UPDATE jobs SET attempts=7,due_at=? WHERE id=?").run(new Date().toISOString(),job('rate').id);await run();assert.equal(job('rate').state,'failed');
 await run(new Date(Date.now()+86400000));assert.equal(reads,2);assert.equal(approvals(o),before);
 globalThis.fetch=provider.fetch;
 assert.equal(typeof jobs.retryFailedJob,'function');jobs.retryFailedJob(job('rate').id,o.projectId,o.runId);await run();assert.equal(job('rate').state,'completed');assert.equal(job('rate').recovery_generation,1);
});
test('expired lease responses cannot commit after token changes on another SQLite connection',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {join}=await import('node:path');
 const o=await invoice();await webhooks.receiveWebhook(headers,event('fence',o.paypalInvoiceId));
 let release,entered;const blocked=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 globalThis.fetch=async(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){entered();await gate;}return provider.fetch(u,i);};
 const before=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n;
 const active=run();await blocked;const other=new DatabaseSync(join(app.app,'data','scope-and-settle.db'));
 other.prepare("UPDATE jobs SET lease_token='replacement',state='completed' WHERE id=?").run(job('fence').id);other.close();release();await active;
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,before);assert.equal(job('fence').lease_token,'replacement');globalThis.fetch=provider.fetch;
});
test('reset cancels jobs during a held provider GET and prevents old-run writes',async()=>{
 const o=await invoice();await webhooks.receiveWebhook(headers,event('reset-held',o.paypalInvoiceId));
 let release,entered;const blocked=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 globalThis.fetch=async(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){entered();await gate;}return provider.fetch(u,i);};
 const active=run();await blocked;orders.resetDemoRun(o.runId);release();await active;
 assert.equal(job('reset-held').state,'cancelled');assert.equal(job('reset-held').lease_token,null);assert.equal(orders.getChangeOrder(o.id),null);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,0);
 assert.throws(()=>jobs.retryFailedJob(job('reset-held').id,o.projectId,o.runId));globalThis.fetch=provider.fetch;
});
test('periodic polling includes recent Paid reversals and preserves a fixed monitoring horizon',async()=>{
 const o=await invoice();paid(o);await orders.refreshPaymentStatus(o.id);const before=approvals(o),now=new Date();await run(now);
 const poll=()=>db.prepare("SELECT * FROM jobs WHERE job_key=?").get(`paypal:poll:${jobs.paypalRoute}:${o.id}`);
 assert.ok(poll());const invoiceData=provider.invoices.get(o.paypalInvoiceId);invoiceData.status='REFUNDED';invoiceData.refunds={refund_amount:{...invoiceData.amount},transactions:[{type:'PAYPAL',refund_id:'REFUND-1',amount:{...invoiceData.amount}}]};
 await run(new Date(now.getTime()+16*60000));assert.equal(orders.getChangeOrder(o.id).financialState.paymentState,'refunded');assert.equal(approvals(o),before);assert.equal(poll().state,'completed');
 const old=await invoice();db.prepare('UPDATE change_orders SET created_at=? WHERE id=?').run(new Date(Date.now()-31*86400000).toISOString(),old.id);db.prepare('UPDATE invoice_operations SET created_at=? WHERE change_order_id=?').run(new Date(Date.now()-31*86400000).toISOString(),old.id);await run();
 assert.equal(db.prepare('SELECT * FROM jobs WHERE job_key=?').get(`paypal:poll:${jobs.paypalRoute}:${old.id}`).state,'completed');
});
test('overlapping runs share one promise and scheduler failures are recorded',async()=>{
 assert.equal(typeof jobs.runDueJobs,'function');const a=jobs.runDueJobs(new Date()),b=jobs.runDueJobs(new Date());assert.equal(a,b);await a;
 db.exec("CREATE TRIGGER fail_runtime BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 const o=await invoice();try{await assert.rejects(()=>run());assert.equal(jobs.jobDiagnostics(o.projectId,o.runId).scheduler.error,'scheduler_failure');}finally{db.exec('DROP TRIGGER fail_runtime');}
});

test('a second event and an existing poll cannot bypass a provider retry deadline',async()=>{
 const o=await invoice();await run();const poll=db.prepare('SELECT * FROM jobs WHERE job_key=?').get(`paypal:poll:${jobs.paypalRoute}:${o.id}`);due(poll.id);
 let reads=0;globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){reads++;return Promise.resolve(new Response('{}',{status:503,headers:{'Retry-After':'3600'}}));}return provider.fetch(u,i);};
 await run();await webhooks.receiveWebhook(headers,event('blocked-by-poll',o.paypalInvoiceId));await run();assert.equal(reads,1);globalThis.fetch=provider.fetch;
});
test('provider error metadata handles seconds/date/invalid guidance and OAuth without retaining provider bodies',async()=>{
 const paypal=await app.load('paypal'),base=Date.parse('2026-10-23T12:00:00Z');
 assert.equal(typeof paypal.parseRetryAfter,'function');
 for(const [value,want] of [['60',base+60000],['0',base],['Fri, 23 Oct 2026 12:02:00 GMT',base+120000],['bad',null],['-5',null],['Thu, 22 Oct 2026 12:00:00 GMT',null],[null,null]])assert.equal(paypal.parseRetryAfter(value,base),want);
 const fresh=await isolatedApp(),p=await fresh.load('paypal');globalThis.fetch=async()=>new Response('credential-private',{status:503,headers:{'Retry-After':'20'}});
 await assert.rejects(()=>p.getAccessToken(),e=>e instanceof p.PayPalRequestError && e.status===503 && e.retryable && e.retryAfterAt>Date.now() && !e.message.includes('credential-private'));globalThis.fetch=provider.fetch;
});
test('signature rejection creates no work while verifier outage remains retryable',async()=>{
 const o=await invoice();assert.equal(await webhooks.receiveWebhook({...headers,'paypal-transmission-sig':'bad'},event('bad-sig',o.paypalInvoiceId)),null);
 globalThis.fetch=(u,i)=>new URL(u).pathname.includes('verify-webhook')?Promise.resolve(new Response('{}',{status:503})):provider.fetch(u,i);
 await assert.rejects(()=>webhooks.receiveWebhook(headers,event('verifier-outage',o.paypalInvoiceId)),e=>e.status===503 && e.retryable);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM webhook_receipts WHERE id IN ('bad-sig','verifier-outage')").get().n,0);globalThis.fetch=provider.fetch;
});
test('ambiguous associations and conflicting replay IDs fail closed',async()=>{
 const a=await invoice(),b=await invoice();db.prepare('UPDATE change_orders SET paypal_invoice_id=? WHERE id=?').run(a.paypalInvoiceId,b.id);
 await webhooks.receiveWebhook(headers,event('ambiguous',a.paypalInvoiceId));await run();assert.equal(job('ambiguous').error_category,'ambiguous_association');
 await assert.rejects(()=>webhooks.receiveWebhook(headers,event('ambiguous','different')),/Conflicting/);
 await assert.rejects(()=>webhooks.receiveWebhook(headers,{...event('conflict',a.paypalInvoiceId),resource:{id:'other',invoice:{id:a.paypalInvoiceId}}}),/conflicting/);
});

test('unexpired leases are not stolen and an exhausted reclaimed lease never performs a ninth GET',async()=>{
 const o=await invoice();await webhooks.receiveWebhook(headers,event('lease-limit',o.paypalInvoiceId));
 let reads=0;globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId))reads++;return provider.fetch(u,i);};
 db.prepare("UPDATE jobs SET state='running',attempts=8,lease_token='original',lease_until=? WHERE id=?").run(new Date(Date.now()+90000).toISOString(),job('lease-limit').id);await run();assert.equal(reads,0);assert.equal(job('lease-limit').lease_token,'original');
 db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),job('lease-limit').id);await run();assert.equal(reads,0);assert.equal(job('lease-limit').state,'failed');globalThis.fetch=provider.fetch;
});
test('periodic monitoring horizon is checked before a resumed overdue poll makes a GET',async()=>{
 const o=await invoice();await run();let reads=0;globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId))reads++;return provider.fetch(u,i);};
 await run(new Date(Date.now()+31*86400000));assert.equal(reads,0);globalThis.fetch=provider.fetch;
});
test('job completion failure rolls back the financial observation and projection in the same transaction',async()=>{
 const o=await invoice();paid(o);await webhooks.receiveWebhook(headers,event('commit-fail',o.paypalInvoiceId));const before=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n;
 db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON jobs WHEN NEW.state='completed' AND OLD.job_key LIKE '%:commit-fail' BEGIN SELECT RAISE(ABORT,'completion unavailable'); END");
 try{await run();assert.equal(orders.getChangeOrder(o.id).financialState.paymentState,'due');assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,before);assert.equal(job('commit-fail').state,'failed');}finally{db.exec('DROP TRIGGER fail_completion');}
});
test('enqueue validates immutable routing and rejects untyped payload fields',()=>{
 const input={key:'immutable-job',kind:'paypal_reconcile',projectId:'demo',runId:'run-test',payload:{invoiceId:'INV2-SAFE',route:jobs.paypalRoute},dueAt:new Date().toISOString()};const id=jobs.enqueueJob(input);assert.equal(jobs.enqueueJob(input),id);
 assert.throws(()=>jobs.enqueueJob({...input,projectId:'other'}),/Conflicting/);
 assert.throws(()=>jobs.enqueueJob({...input,key:'invalid-payload',payload:{...input.payload,periodic:'yes'}}),/Invalid/);
});

test('transport timeouts retry without changing invoice or approval and unknown event actor fields never route work',async()=>{
 const o=await invoice(),before=approvals(o),counts=provider.counts();let reads=0;
 globalThis.fetch=(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){reads++;throw new DOMException('sensitive transport detail','TimeoutError');}return provider.fetch(u,i);};
 const e=event('transport',o.paypalInvoiceId);e.projectId='attacker';e.runId='attacker';e.resource.invoice.custom_id='attacker';await webhooks.receiveWebhook(headers,e);await run();
 assert.equal(job('transport').state,'pending');assert.equal(job('transport').error_category,'provider_transport');assert.equal(job('transport').project_id,o.projectId);assert.equal(job('transport').run_id,o.runId);assert.ok(!JSON.stringify(job('transport')).includes('attacker'));assert.equal(reads,1);
 globalThis.fetch=provider.fetch;due(job('transport').id);await run();assert.equal(job('transport').state,'completed');assert.equal(approvals(o),before);assert.deepEqual(provider.counts(),counts);
});
test('an expired lease with unchanged token cannot commit its held response',async()=>{
 const o=await invoice();await webhooks.receiveWebhook(headers,event('expired-response',o.paypalInvoiceId));let release,entered;const gate=new Promise(r=>release=r),blocked=new Promise(r=>entered=r);
 globalThis.fetch=async(u,i)=>{if(new URL(u).pathname.endsWith('/'+o.paypalInvoiceId)){entered();await gate;}return provider.fetch(u,i);};
 const before=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,active=run();await blocked;
 db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),job('expired-response').id);release();await active;
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(o.id).n,before);assert.equal(job('expired-response').state,'running');globalThis.fetch=provider.fetch;
 await run();assert.equal(job('expired-response').state,'completed');
});

test('an invoice created from an old draft receives a fresh association monitoring window',async()=>{
 const o=await invoice();db.prepare('UPDATE change_orders SET created_at=? WHERE id=?').run(new Date(Date.now()-31*86400000).toISOString(),o.id);await run();
 assert.equal(db.prepare('SELECT state FROM jobs WHERE job_key=?').get(`paypal:poll:${jobs.paypalRoute}:${o.id}`).state,'pending');
});
test('a new Paid observation reopens the existing expired unresolved schedule within its first-paid horizon',async()=>{
 const o=await invoice(),old=new Date(Date.now()-31*86400000).toISOString();db.prepare('UPDATE change_orders SET created_at=? WHERE id=?').run(old,o.id);db.prepare('UPDATE invoice_operations SET created_at=? WHERE change_order_id=?').run(old,o.id);await run();
 const key=`paypal:poll:${jobs.paypalRoute}:${o.id}`,poll=db.prepare('SELECT * FROM jobs WHERE job_key=?').get(key);assert.equal(poll.state,'completed');
 paid(o);await webhooks.receiveWebhook(headers,event('later-paid',o.paypalInvoiceId));await run();await run();const revived=db.prepare('SELECT * FROM jobs WHERE job_key=?').get(key);assert.equal(revived.id,poll.id);assert.equal(revived.state,'pending');assert.ok(JSON.parse(revived.payload_json).firstPaidAt);
});

