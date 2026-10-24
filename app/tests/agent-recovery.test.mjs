import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture,draftInput} from './helpers.mjs';
const app=await isolatedApp(),{db,getProjectForRun,getProject,updateScopeBaseline}=await app.load('db');
const {createJudgeAccess,startJudgeRun}=await app.load('judging');
const {createSession}=await app.load('sessions');
const {saveAgentPolicy,activeAgentPolicy}=await app.load('agentPolicy');
const {createRequest,requestById}=await app.load('agentStore');
const portal=await app.load('agentPortal'),orders=await app.load('orders'),{runAgentCycle}=await app.load('agentWorker');
const {FigmaRequestError}=await app.load('figma'),provider=providerFixture(),originalFetch=globalThis.fetch;
globalThis.fetch=provider.fetch;after(()=>{globalThis.fetch=originalFetch;db.close();});
const policy={enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1};
const requestText='Can you add the mobile checkout?';
function setup(extra={}){const key=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=startJudgeRun(key.credential);saveAgentPolicy(owner,{...policy,...extra});const link=portal.createPortalAccess(owner);return {owner,client:portal.getPortalSession(link.credential)};}
function result(project){return {classification:'new_work',explanation:'Excluded',evidence:[{clauseId:project.scopeClauses[0].id,quote:project.scopeClauses[0].text}],deliverables:[project.rateCard[0].description],rates:[{rateCardId:'mobile_checkout',quantity:1}],questions:[],designObservations:[],lineItems:[],proposedTotalMinor:25000,automation:{allRequestsCovered:true,unpricedComponents:[],coverage:[{requestQuote:requestText,deliverableIndex:0,rateCardId:'mobile_checkout',quantity:1}]}};}
const dependencies={fetchComments:async()=>[],assess:async(input,run)=>({id:'a-'+crypto.randomUUID(),result:result(getProjectForRun(run))}),postComment:async()=>({id:'message-fixture'})};
function stop(owner){saveAgentPolicy(owner,{enabled:false});}
test('slow invoice publication is not an agent exception and client recovery remains usable',async()=>{
 const {owner,client}=setup(),r=portal.addPortalRequest(client,requestText,'request-001');await runAgentCycle(dependencies);
 let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/send')){entered();await held;}return provider.fetch(url,init);};
 const approval=portal.approvePortalQuote(client,r.id,1,true);await started;await runAgentCycle(dependencies);
 const during=requestById(r.id,owner.runId);release();await approval;globalThis.fetch=provider.fetch;
 assert.equal(during.state,'quoted');assert.equal(during.exception,null);
 await portal.approvePortalQuote(client,r.id,1,true);stop(owner);
});
test('a rejected Figma reply preserves portal approval and subsequent Paid tracking',async()=>{
 const {owner,client}=setup({figmaClientIds:['delivery-client'],figmaReplies:true});
 const r=createRequest(owner.runId,'figma','root-delivery',requestText);
 await runAgentCycle({...dependencies,postComment:async()=>{throw new FigmaRequestError(403);}});
 const row=requestById(r.id,owner.runId);assert.equal(row.state,'quoted');assert.match(row.delivery_exception,/Figma/);
 portal.handleAgentRequest(owner,r.id,'acknowledge');assert.equal(requestById(r.id,owner.runId).state,'quoted');assert.equal(requestById(r.id,owner.runId).delivery_exception,null);
 const approved=await portal.approvePortalQuote(client,r.id,1,true);assert.ok(approved.order.paypalInvoiceId);
 db.prepare("UPDATE change_orders SET status='paid' WHERE id=?").run(row.order_id);
 await runAgentCycle(dependencies);assert.equal(requestById(r.id,owner.runId).state,'paid');stop(owner);
});
test('a saved assessment from another brief is never reused after policy reapproval',async()=>{
 const owner=createSession({projectId:'demo',role:'designer'});saveAgentPolicy(owner,{...policy,maxQuoteMinor:20000});
 const r=createRequest(owner.runId,'portal','request-scope',requestText);let calls=0;
 const d={...dependencies,assess:async(input,run)=>{calls++;const record={id:'scope-assessment-'+calls,scopeRevisionId:input.project.scopeRevisionId,result:result(input.project)};
 db.prepare('INSERT INTO assessments (id,project_id,run_id,scope_revision_id,input_json,result_json,created_at) VALUES (?,?,?,?,?,?,?)').run(record.id,'demo',run,record.scopeRevisionId,JSON.stringify(input),JSON.stringify(record),new Date().toISOString());return record;}};
 await runAgentCycle(d);assert.equal(requestById(r.id,owner.runId).state,'exception');
 updateScopeBaseline([{id:'mobile-included',text:'Mobile checkout is included in the agreement.'}]);saveAgentPolicy(owner,policy);portal.handleAgentRequest(owner,r.id,'retry');
 await runAgentCycle({...d,assess:async()=>{calls++;return {id:'new-scope-result',result:{...result(getProject()),classification:'included',rates:[],deliverables:[]}};}});
 assert.equal(calls,2);assert.equal(requestById(r.id,owner.runId).state,'included');stop(owner);
});
test('a pause while PayPal OAuth is in flight prevents a reminder POST',async()=>{
 // A separate application avoids the other tests' cached PayPal token.
 const second=await isolatedApp(),{db:secondDb}=await second.load('db'),{remindInvoice}=await second.load('paypal');
 let allowed=true,posts=0,release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 globalThis.fetch=async url=>{if(String(url).endsWith('/oauth2/token')){entered();await held;return Response.json({access_token:'fixture',expires_in:3600});}posts++;return new Response(null,{status:202});};
 const attempt=remindInvoice('INV2-TEST',()=>allowed);await started;allowed=false;release();
 await assert.rejects(attempt,/authority|paused|cancel/i);assert.equal(posts,0);globalThis.fetch=provider.fetch;secondDb.close();
});
test('reviewing follow-up work cannot replace an existing request invoice or disconnect its Paid status',async()=>{
 const {owner,client}=setup(),r=portal.addPortalRequest(client,requestText,'request-001');await runAgentCycle(dependencies);
 const first=await portal.approvePortalQuote(client,r.id,1,true);
 portal.replyToRequest(client,r.id,'Please add a logo too','reply-001');
 const next=orders.submitForApproval(orders.createChangeOrder(draftInput(),owner.runId).id);
 assert.throws(()=>portal.publishReviewedQuote(owner,r.id,next.id,next.revision,true),/separate request|existing quote/i);
 assert.equal(portal.portalView(client).requests[0].order.id,first.order.id);
 const recovered=await portal.approvePortalQuote(client,r.id,1,true);assert.equal(recovered.order.paypalInvoiceId,first.order.paypalInvoiceId);stop(owner);
});
