import {test,after} from 'node:test';
import assert from 'node:assert/strict';
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
