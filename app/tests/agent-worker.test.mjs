import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture} from './helpers.mjs';
const app=await isolatedApp(), {db,getProjectForRun}=await app.load('db');
const {createJudgeAccess,startJudgeRun,resetJudgeRun}=await app.load('judging');
const {saveAgentPolicy}=await app.load('agentPolicy');
const {createRequest,requestById,quotedTotal}=await app.load('agentStore');
const {runAgentCycle,recoverAgentJobs}=await app.load('agentWorker');
const ledger=await app.load('scopeLedger');
after(()=>db.close());
const input={enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1};
const text='Can you add the mobile checkout?';
function setup(extra={}){const access=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()});const owner=startJudgeRun(access.credential);saveAgentPolicy(owner,{...input,...extra});return owner;}
function result(runId){const p=getProjectForRun(runId);return {classification:'new_work',explanation:'Outside desktop scope',evidence:[{clauseId:p.scopeClauses[0].id,quote:p.scopeClauses[0].text}],deliverables:[p.rateCard[0].description],rates:[{rateCardId:p.rateCard[0].id,quantity:1}],questions:[],designObservations:[],lineItems:[],proposedTotalMinor:1,automation:{allRequestsCovered:true,unpricedComponents:[],coverage:[{requestQuote:text,deliverableIndex:0,rateCardId:p.rateCard[0].id,quantity:1}]}};}
function deps(extra={}){const dependencies={fetchComments:async()=>[],assess:async(input,runId)=>({id:'assessment-'+crypto.randomUUID(),result:result(runId)}),postComment:async()=>({id:'posted'}),refreshPaymentStatus:async()=>{throw new Error('unexpected payment call');},remindInvoice:async()=>{throw new Error('unexpected reminder');},...extra};const assess=dependencies.assess;dependencies.assess=async(input,runId)=>{const ref=ledger.captureScopeContext(runId);const result=await assess(input,runId);db.prepare('INSERT OR IGNORE INTO assessments VALUES(?,?,?,?,?,?,?)').run(result.id,'demo',runId,input.project.scopeRevisionId,JSON.stringify(input),JSON.stringify(result),new Date().toISOString());ledger.linkScopeContext('assessment',result.id,1,ref.id);return result;};return dependencies;}
async function cycle(d){db.prepare("DELETE FROM agent_runtime WHERE key='figma-next-check-at'").run();return runAgentCycle(d);}
function stop(owner){saveAgentPolicy(owner,{enabled:false});}

test('an approved rate creates one durable quote, exact revision and no invoice before client consent',async()=>{
 const owner=setup(),r=createRequest(owner.runId,'portal','request-1',text);let calls=0;
 const d=deps({assess:async(i,run)=>{calls++;return {id:'assessment-one',result:result(run)};}});
 await cycle(d);let row=requestById(r.id,owner.runId);assert.equal(row.state,'quoted');assert.equal(row.quoted_minor,25000);assert.equal(row.quote_revision,1);
 const order=db.prepare('SELECT * FROM change_orders WHERE id=?').get(row.order_id);assert.equal(order.status,'awaiting_client_approval');assert.equal(order.paypal_invoice_id,null);
 await cycle(d);recoverAgentJobs();await cycle(d);assert.equal(calls,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM change_orders WHERE run_id=?').get(owner.runId).n,1);stop(owner);
});
test('cumulative allowance spans requests and policy edits; over-limit work is an exception',async()=>{
 const owner=setup();for(let i=0;i<3;i++){const distinct=`Can you add the mobile checkout for flow ${i+1}?`;createRequest(owner.runId,'portal','request-'+i,distinct);await cycle(deps({assess:async(input,runId)=>{const r=result(runId);r.automation.coverage[0].requestQuote=distinct;return {id:'distinct-'+crypto.randomUUID(),result:r};}}));}
 assert.equal(quotedTotal(owner.runId),50000);assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_requests WHERE run_id=? AND state='exception'").get(owner.runId).n,1);
 saveAgentPolicy(owner,input);assert.equal(quotedTotal(owner.runId),50000);stop(owner);
});
test('pause and reset during assessment prevent late publication',async()=>{
 for(const mode of ['pause','reset']){const owner=setup(),r=createRequest(owner.runId,'portal','request-1',text);await cycle(deps({assess:async(i,run)=>{if(mode==='pause')stop(owner);else resetJudgeRun(owner);return {id:'assessment-race',result:result(run)};}}));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM change_orders WHERE run_id=?').get(owner.runId).n,0);
 if(mode==='pause')assert.equal(requestById(r.id,owner.runId).state,'exception');else assert.equal(requestById(r.id,owner.runId),null);}
});
test('clarification is bounded and missing component coverage never produces a quote',async()=>{
 const owner=setup(),r=createRequest(owner.runId,'portal','request-1',text);
 const unclear=deps({assess:async()=>({id:'unclear',result:{...result(owner.runId),classification:'needs_clarification',rates:[],questions:['Which screen?']}})});
 await cycle(unclear);assert.equal(requestById(r.id,owner.runId).state,'needs_clarification');
 for(let i=0;i<2;i++){db.prepare("UPDATE agent_requests SET state='queued',assessment_id=NULL WHERE id=?").run(r.id);await cycle(unclear);}
 assert.equal(requestById(r.id,owner.runId).state,'exception');
 const extra=createRequest(owner.runId,'portal','request-2',text);await cycle(deps({assess:async()=>({id:'extra',result:{...result(owner.runId),automation:{...result(owner.runId).automation,unpricedComponents:['Logo']}}})}));
 assert.equal(requestById(extra.id,owner.runId).state,'exception');stop(owner);
});
test('Figma intake routes stable client IDs, ignores historical/self/staff comments and deduplicates',async()=>{
 const owner=setup({figmaClientIds:['client-a']});
 const comments=[{id:'new',userId:'client-a',message:text,createdAt:new Date(Date.now()+1000).toISOString(),parentId:null},
 {id:'old',userId:'client-a',message:text,createdAt:'2000-01-01',parentId:null},{id:'staff',userId:'staff',message:text,createdAt:new Date().toISOString(),parentId:null},
 {id:'self',userId:'client-a',message:'[Scope & Settle reply] '+text,createdAt:new Date().toISOString(),parentId:null}];
 const d=deps({fetchComments:async()=>comments});await cycle(d);await cycle(d);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_requests WHERE run_id=?').get(owner.runId).n,1);stop(owner);
});
test('an uncertain Figma send is not treated as received from a copied marker',async()=>{
 const owner=setup({figmaClientIds:['client-b'],figmaReplies:true});let comments=[{id:'root',userId:'client-b',message:text,createdAt:new Date(Date.now()+1000).toISOString(),parentId:null}],sends=0;
 const d=deps({fetchComments:async()=>comments,postComment:async(file,parent,body)=>{sends++;comments.push({id:'delivered',userId:'owner',message:body,parentId:parent,createdAt:new Date().toISOString()});throw new Error('lost response');}});
 await cycle(d);assert.equal(sends,1);await cycle(d);assert.equal(sends,1);assert.equal(db.prepare("SELECT state FROM agent_outbox WHERE run_id=?").get(owner.runId).state,'uncertain');stop(owner);
});
test('restart recovers ambiguous assessments to an exception without automatically spending again',()=>{
 const owner=setup(),r=createRequest(owner.runId,'portal','request-1',text);db.prepare("UPDATE agent_requests SET state='processing' WHERE id=?").run(r.id);recoverAgentJobs();assert.equal(requestById(r.id,owner.runId).state,'exception');stop(owner);
});
test('payment tracking publishes Paid once and reminders recheck authoritative unpaid state',async()=>{
 const owner=setup({paypalReminders:true}),r=createRequest(owner.runId,'portal','request-1',text);await cycle(deps());
 const row=requestById(r.id,owner.runId);
 const orders=await app.load('orders'),provider=providerFixture(),originalFetch=globalThis.fetch;
 globalThis.fetch=provider.fetch;
 orders.approveChangeOrder(row.order_id,{changeOrderId:row.order_id,changeOrderRevision:1});await orders.ensureInvoice(row.order_id);
 db.prepare("UPDATE approvals SET created_at=? WHERE change_order_id=?").run(new Date(Date.now()-86400001).toISOString(),row.order_id);
 let reminders=0,checks=0;const {getChangeOrder}=await app.load('orders');
 await cycle(deps({refreshPaymentStatus:async id=>{checks++;return getChangeOrder(id);},remindInvoice:async(id,authorized,dispatch)=>{assert.ok(authorized());dispatch();reminders++;}}));
 assert.equal(checks,1);assert.equal(reminders,1);
 await cycle(deps());assert.equal(reminders,1);
 db.prepare("UPDATE change_orders SET status='paid' WHERE id=?").run(row.order_id);await cycle(deps());await cycle(deps());
 assert.equal(requestById(r.id,owner.runId).state,'paid');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_messages WHERE request_id=? AND body LIKE 'PayPal confirms%'").get(r.id).n,1);stop(owner);globalThis.fetch=originalFetch;
});

test('agent payment tracking consumes persisted reconciliation without independently polling PayPal',async()=>{
 const owner=setup(),r=createRequest(owner.runId,'portal','durable-payment',text);await cycle(deps());const row=requestById(r.id,owner.runId);
 db.prepare("UPDATE change_orders SET status='payment_due',paypal_invoice_id='INV2-QUEUED',created_at='2000-01-01' WHERE id=?").run(row.order_id);
 let checks=0;await cycle(deps({refreshPaymentStatus:async()=>{checks++;throw new Error('must not bypass durable jobs');}}));assert.equal(checks,0);stop(owner);
});
