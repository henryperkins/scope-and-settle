import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedApp,draftInput,canonicalDraftFactory} from './helpers.mjs';
import {DatabaseSync} from 'node:sqlite';
const app=await isolatedApp();
const database=await app.load('db');const {db,getProject,updateScopeBaseline}=database;
const sessions=await app.load('sessions'),context=await app.load('context'),orders=await app.load('orders'),judging=await app.load('judging');
const ledger=await app.load('scopeLedger').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const policy=await app.load('agentPolicy'),portal=await app.load('agentPortal');
after(()=>db.close());
function owner(runId){const session=sessions.createSession({projectId:'demo',role:'designer',...(runId?{runId}:{})});return {session,ctx:context.contextFromSessionToken(session.token)};}
function scope(ctx){assert.equal(typeof ledger.getScopeContext,'function','immutable scope ledger is required');return ledger.getScopeContext(ctx);}
function client(ctx,snapshot){const link=ledger.issueScopeAccess(ctx,snapshot.id,snapshot.version);const credential=link.scopeUrl.split('#')[1];const s=credential.startsWith('resume=')?judging.renewJudgeSession(credential.slice(7)):sessions.redeemInvitation(credential);return {session:s,ctx:context.contextFromSessionToken(s.token),credential};}
test('supplied brief has immutable scoped versions and no fabricated acknowledgement',()=>{
 const o=owner(),a=scope(o.ctx);assert.equal(a.acknowledgement.state,'supplied_unacknowledged');assert.equal(a.scopeSnapshot.version,1);assert.equal(a.rateSnapshot.entries[0].unitAmountMinor,25000);
 updateScopeBaseline([{id:'new',text:'A replacement agreement.'}]);const b=scope(o.ctx);assert.notEqual(a.scopeSnapshot.id,b.scopeSnapshot.id);assert.equal(b.scopeSnapshot.version,2);
 assert.equal(ledger.getScopeSnapshot(o.ctx,a.scopeSnapshot.id).scopeSnapshot.clauses[0].id,'desktop-1');
 assert.throws(()=>db.prepare("UPDATE scope_snapshots SET clauses_json='[]' WHERE id=?").run(a.scopeSnapshot.id),/immutable/i);
});
test('acknowledgement requires exact scope kind/run/version and never approves or invoices',()=>{
 const o=owner(),a=scope(o.ctx),c=client(o.ctx,a.scopeSnapshot),other=owner('other-run');
 assert.throws(()=>ledger.acknowledgeScope(o.ctx,a.scopeSnapshot.id),/client|scope/i);
 assert.throws(()=>ledger.getScopeSnapshot(other.ctx,a.scopeSnapshot.id),/access|scope/i);
 const order=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
 const p=context.contextFromSessionToken(sessions.createSession({projectId:'demo',role:'client',changeOrderId:order.id,changeOrderRevision:order.revision}).token);
 assert.throws(()=>ledger.acknowledgeScope(p,a.scopeSnapshot.id),/scope/i);
 assert.throws(()=>ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id,a.scopeSnapshot.version+1),/version|revision/i);
 const saved=ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id);assert.equal(ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id).id,saved.id);
 assert.equal(db.prepare('SELECT count(*) n FROM approvals').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM invoice_operations').get().n,0);
 updateScopeBaseline([{id:'next',text:'Another agreement.'}]);const b=scope(o.ctx);assert.throws(()=>ledger.acknowledgeScope(c.ctx,b.scopeSnapshot.id),/scope|access/i);
 assert.equal(scope(o.ctx).acknowledgement.state,'supplied_unacknowledged');
});
test('scope invitation and minted contexts follow expiry and parent revocation',()=>{
 for(const invalidate of [s=>sessions.revokeSession(s.token),s=>db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE token=?").run(s.token)]){
  const o=owner(),a=scope(o.ctx),c=client(o.ctx,a.scopeSnapshot);invalidate(o.session);
  assert.throws(()=>ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id),/expired|revoked|session/i);
 }
});
test('frozen judging runs retain distinct original JSON and scope grants renew without widening',()=>{
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),s=judging.startJudgeRun(access.credential),ctx=context.contextFromSessionToken(s.token),a=scope(ctx);
 updateScopeBaseline([{id:'frozen-b',text:'The second captured agreement.'}]);const access2=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),s2=judging.startJudgeRun(access2.credential),b=scope(context.contextFromSessionToken(s2.token));
 assert.notDeepEqual(a.scopeSnapshot.clauses,b.scopeSnapshot.clauses);assert.deepEqual(scope(ctx).scopeSnapshot.clauses,a.scopeSnapshot.clauses);
 const c=client(ctx,a.scopeSnapshot),renewed=judging.renewJudgeSession(c.credential.slice(7));assert.equal(renewed.grantKind,'scope');assert.equal(renewed.resourceId,a.scopeSnapshot.id);
 assert.throws(()=>ledger.publishScope(ctx,[],a.contextVersion),/fixed|edit|designer/i);judging.revokeJudgeAccess(access.id);
 assert.equal(judging.renewJudgeSession(c.credential.slice(7)),null);assert.throws(()=>ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id),/revoked|session/i);
});
test('rate changes stale pending terms while approved commitments survive refunds',()=>{
 const o=owner(),a=scope(o.ctx),pending=orders.submitForApproval(orders.createChangeOrder(draftInput()).id),approved=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
 orders.approveChangeOrder(approved.id,{changeOrderId:approved.id,changeOrderRevision:approved.revision});
 const saved=db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=?').get(approved.id).snapshot_json;
 ledger.publishRates(o.ctx,getProject().rateCard.map(r=>({...r,unitAmountMinor:r.unitAmountMinor+100})),scope(o.ctx).contextVersion);
 assert.equal(orders.getChangeOrder(pending.id).stale,true);assert.equal(orders.getChangeOrder(approved.id).stale,false);
 assert.throws(()=>orders.approveChangeOrder(pending.id,{changeOrderId:pending.id,changeOrderRevision:pending.revision}),/changed|review/i);
 db.prepare("INSERT INTO payment_observations(change_order_id,paypal_invoice_id,raw_status,display_status,checked_at,financial_json) VALUES(?,?,?,?,?,?)").run(approved.id,'fixture','REFUNDED','refunded',new Date().toISOString(),JSON.stringify({paymentState:'refunded',invoiceState:'closed'}));
 const commitment=scope(o.ctx).commitments.find(x=>x.resourceId===approved.id);assert.equal(commitment.workDisposition,'committed');assert.equal(commitment.financialState.paymentState,'refunded');
 assert.equal(db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=?').get(approved.id).snapshot_json,saved);
 assert.ok(orders.getChangeOrder(approved.id).scopeContext.scopeSnapshotId);assert.ok(a.rateSnapshot.id);
});
test('ledger metadata preserves existing policy/portal authority; actual terms invalidate it',()=>{
 const o=owner(),p=policy.saveAgentPolicy(o.session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:50000,maxTotalMinor:100000,maxQuantity:2,figmaClientIds:[]});
 const link=portal.createPortalAccess(o.session),credential=link.credential;scope(o.ctx);
 assert.equal(policy.policyAuthority(p),true);assert.ok(portal.getPortalSession(credential));
 assert.equal(policy.projectHash({...getProject(),scopeContext:{id:'metadata'}}),p.projectHash);
 const a=scope(o.ctx);ledger.publishScope(o.ctx,[{id:'terms',text:'Changed actual terms'}],a.contextVersion);
 assert.equal(policy.policyAuthority(p),false);assert.equal(portal.getPortalSession(credential),null);
});
test('portal can mint a narrow scope capability but broad portal authority cannot acknowledge',()=>{
 const o=owner();policy.saveAgentPolicy(o.session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:50000,maxTotalMinor:100000,maxQuantity:2,figmaClientIds:[]});
 const access=portal.createPortalAccess(o.session),ps=portal.getPortalSession(access.credential);
 assert.equal(typeof portal.issuePortalScopeAccess,'function');
 assert.throws(()=>ledger.acknowledgeScope(ps,scope(o.ctx).scopeSnapshot.id),/scope|client/i);
 const link=portal.issuePortalScopeAccess(ps),s=sessions.redeemInvitation(link.scopeUrl.split('#')[1]),ctx=context.contextFromSessionToken(s.token);
 assert.equal(ctx.grant.kind,'scope');assert.equal(s.changeOrderId,null);assert.ok(ledger.acknowledgeScope(ctx,ctx.grant.resourceId).id);
 db.prepare('UPDATE agent_portals SET revoked=1 WHERE id=?').run(ps.id);assert.throws(()=>ledger.acknowledgeScope(ctx,ctx.grant.resourceId),/session|revoked/i);
});
test('HTTP scope views bind exact immutable snapshots and require explicit consent',async()=>{
 const {server}=await app.load('server');if(!server.listening)await new Promise(r=>server.once('listening',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`,o=owner(),a=scope(o.ctx),c=client(o.ctx,a.scopeSnapshot);
  const call=(path,token,method='GET',body)=>fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await call('/api/scope/snapshots/'+a.scopeSnapshot.id,c.session.token)).status,200);
  assert.equal((await call('/api/scope',c.session.token)).status,403);
  assert.equal((await call('/api/scope/snapshots/'+a.scopeSnapshot.id+'/acknowledge',c.session.token,'POST',{expectedVersion:a.scopeSnapshot.version,consent:false})).status,400);
  assert.equal((await call('/api/scope/snapshots/'+a.scopeSnapshot.id+'/acknowledge',c.session.token,'POST',{expectedVersion:a.scopeSnapshot.version,consent:true})).status,200);
  const changed=await call('/api/project/scope',o.session.token,'POST',{expectedContextVersion:a.contextVersion,clauses:[{id:'http-next',text:'Second HTTP snapshot'}]});assert.equal(changed.status,200);
  const b=await changed.json();assert.equal((await call('/api/scope/snapshots/'+b.scopeSnapshot.id,c.session.token)).status,403);
  const old=await (await call('/api/scope/snapshots/'+a.scopeSnapshot.id,c.session.token)).json();assert.deepEqual(old.scopeSnapshot.clauses,a.scopeSnapshot.clauses);
  assert.equal((await fetch(base+'/scope')).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
test('legacy import preserves contradictory historical evidence and explicitly unknown context',async()=>{
 const {migrate,migrations}=await app.load('migrations'),d=new DatabaseSync(':memory:');
 try{
  migrate(d,migrations.slice(0,3));const p=getProject(),old={...p,scopeRevisionId:'same-label',scopeClauses:[{id:'one',text:'Old exact agreement'}]},other={...old,scopeClauses:[{id:'one',text:'Different actual agreement'}]};
  for(const [id,project] of [['old-a',old],['old-b',other],['unknown',null]])d.prepare('INSERT INTO assessments VALUES(?,?,?,?,?,?,?)').run(id,'demo','run-1','same-label',JSON.stringify(project?{project}:{}),'{}','2020-01-01');
  const original=JSON.stringify({scopeSnapshot:old,title:'Historic immutable proposal',totalMinor:123});
  d.prepare("INSERT INTO change_orders(id,project_id,title,deliverables_json,line_items_json,total_minor,currency,status,created_at,run_id,revision) VALUES('old-order','demo','Old','[]','[]',123,'USD','paid','2020','run-1',1)").run();
  d.prepare('INSERT INTO proposal_revisions VALUES(?,?,?,?)').run('old-order',1,original,'2020');
  d.prepare("INSERT INTO approvals(change_order_id,change_order_revision,scope_revision_id,actor_role,created_at) VALUES('old-order',1,'same-label','client','2020')").run();
  migrate(d);assert.equal(d.prepare('SELECT snapshot_json FROM proposal_revisions').get().snapshot_json,original);
  const historical=d.prepare("SELECT content_hash FROM scope_snapshots WHERE source_reference LIKE 'assessment:%'").all();assert.equal(new Set(historical.map(r=>r.content_hash)).size,2);
  const missing=d.prepare("SELECT c.* FROM scope_contexts c JOIN scope_context_links l ON l.context_id=c.id WHERE l.resource_id='unknown'").get();assert.equal(missing.scope_snapshot_id,null);assert.equal(missing.rate_snapshot_id,null);assert.equal(missing.commitment_fingerprint,null);
  assert.equal(d.prepare('SELECT count(*) n FROM scope_acknowledgements').get().n,0);assert.equal(d.prepare("SELECT count(*) n FROM scope_context_links WHERE kind='approval'").get().n,1);
 }finally{d.close();}
});
test('published provenance records server actor and rejects invalid rate descriptions atomically',()=>{
 const o=owner(),a=scope(o.ctx),b=ledger.publishScope(o.ctx,[{id:'creator',text:'A version with known publisher.'}],a.contextVersion);
 assert.equal(b.scopeSnapshot.provenance.createdBy,o.ctx.actorId);
 assert.throws(()=>ledger.publishRates(o.ctx,[{id:'bad',description:'x'.repeat(1001),unitAmountMinor:100}],b.contextVersion),/description|1000/i);assert.equal(scope(o.ctx).contextVersion,b.contextVersion);
});
test('acknowledgement records cannot be removed independently of their immutable evidence',()=>{
 const o=owner(),a=scope(o.ctx),c=client(o.ctx,a.scopeSnapshot);const ack=ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id);
 assert.throws(()=>db.prepare('DELETE FROM scope_acknowledgements WHERE id=?').run(ack.id),/immutable/i);
});
test('assessment evidence stays bound to its context and approved commitments invalidate stale drafts',async()=>{
 const service=await app.load('changeOrderService'),o=owner(),a=ledger.captureScopeContext(o.session.runId);
 const canonicalInput=await canonicalDraftFactory(app),input=canonicalInput(o.ctx,{assessmentId:'context-test',scopeContext:a,count:2});
 const pending=service.draftChangeOrder(o.ctx,{...input,itemIds:input.itemIds.slice(0,1)});
 const other=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);orders.approveChangeOrder(other.id,{changeOrderId:other.id,changeOrderRevision:other.revision});
 assert.throws(()=>service.draftChangeOrder(o.ctx,{...input,itemIds:input.itemIds.slice(1),operationId:'stale-context-new-operation'}),/assessment/i);
 assert.throws(()=>orders.submitForApproval(pending.id),/context|review/i);
 assert.equal(ledger.linkedScopeContext('assessment','context-test').id,a.id);
});
test('legacy policy projection survives metadata backfill without new consent',()=>{
 const o=owner(),p=policy.saveAgentPolicy(o.session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:50000,maxTotalMinor:100000,maxQuantity:2,figmaClientIds:[]});
 delete p.scopeSnapshotId;delete p.rateSnapshotId;db.prepare('UPDATE agent_policies SET policy_json=? WHERE run_id=?').run(JSON.stringify(p),o.session.runId);
 const access=portal.createPortalAccess(o.session);scope(o.ctx);assert.equal(policy.policyAuthority(p),true);assert.ok(portal.getPortalSession(access.credential));
});
test('renewing an exact scope grant preserves the acknowledgement actor and expiry bounds',()=>{
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+600000).toISOString()}),s=judging.startJudgeRun(access.credential),ctx=context.contextFromSessionToken(s.token),a=scope(ctx),c=client(ctx,a.scopeSnapshot);
 const ack=ledger.acknowledgeScope(c.ctx,a.scopeSnapshot.id),renewed=judging.renewJudgeSession(c.credential.slice(7));
 assert.equal(ledger.acknowledgeScope(context.contextFromSessionToken(renewed.token),a.scopeSnapshot.id).id,ack.id);
 assert.ok(Date.parse(renewed.expiresAt)<=Date.parse(access.expiresAt));
 db.prepare("UPDATE renewal_grants SET resource_revision=resource_revision+1 WHERE id=?").run(renewed.grantId);assert.equal(judging.renewJudgeSession(c.credential.slice(7)),null);
});
test('unredeemed scope invitations reject expired parents and reset revokes all prior scope authority',()=>{
 const o=owner(),a=scope(o.ctx),link=ledger.issueScopeAccess(o.ctx,a.scopeSnapshot.id,a.scopeSnapshot.version);
 sessions.revokeSession(o.session.token);assert.equal(sessions.redeemInvitation(link.scopeUrl.split('#')[1]),null);
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+600000).toISOString()}),s=judging.startJudgeRun(access.credential),ctx=context.contextFromSessionToken(s.token),b=scope(ctx),c=client(ctx,b.scopeSnapshot);
 judging.resetJudgeRun(s);assert.equal(judging.renewJudgeSession(c.credential.slice(7)),null);assert.throws(()=>ledger.acknowledgeScope(c.ctx,b.scopeSnapshot.id),/session|reset/i);
});
test('proposal clients see their captured version references without unrelated commitment terms',async()=>{
 const service=await app.load('changeOrderService'),o=owner(),first=orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
 orders.approveChangeOrder(first.id,{changeOrderId:first.id,changeOrderRevision:first.revision});
 const second=orders.submitForApproval(orders.createChangeOrder(draftInput()).id),s=sessions.createSession({projectId:'demo',role:'client',changeOrderId:second.id,changeOrderRevision:second.revision}),view=service.getScopedOrder(context.contextFromSessionToken(s.token),second.id);
 assert.equal(view.scopeContext.commitments.length,0);assert.ok(view.scopeContext.scopeSnapshotId);assert.ok(orders.getChangeOrder(second.id).scopeContext.commitments.some(x=>x.resourceId===first.id));
});
test('a scope renewal grant never outlives a shortened parent grant',()=>{
 const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+600000).toISOString()}),s=judging.startJudgeRun(access.credential),short=new Date(Date.now()+120000).toISOString();
 db.prepare('UPDATE renewal_grants SET expires_at=? WHERE id=?').run(short,s.grantId);
 const ctx=context.contextFromSessionToken(s.token),a=scope(ctx),link=ledger.issueScopeAccess(ctx,a.scopeSnapshot.id,a.scopeSnapshot.version);
 assert.equal(link.expiresAt,short);
});
test('new assessment persists both context versions and includes approved commitments in fake inference',async()=>{
 const {assess}=await app.load('assessment'),o=owner(),before=scope(o.ctx),originalFetch=globalThis.fetch;let sent;
 globalThis.fetch=async(url,init)=>{sent=JSON.parse(JSON.parse(init.body).messages[1].content[0].text);return Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({classification:'needs_clarification',explanation:'Clarify request',evidence:[],deliverables:[],rates:[],questions:['Which deliverable?'],designObservations:[]})}}]});};
 try{const record=await assess({project:getProject(),comment:{id:'context-input',message:'Please clarify this request'},replies:[]},o.session.runId,()=>context.requireActiveContext(o.ctx));assert.equal(record.scopeContext.scopeSnapshotId,before.scopeSnapshot.id);assert.equal(record.scopeContext.rateSnapshotId,before.rateSnapshot.id);assert.equal(sent.scopeContext.commitments.length,before.commitments.length);assert.ok(sent.scopeContext.commitments.length>0);assert.equal(ledger.linkedScopeContext('assessment',record.id).id,record.scopeContext.id);}finally{globalThis.fetch=originalFetch;}
});
test('changed rate terms require explicit re-review and cannot label old amounts with a new rate context',()=>{
 const o=owner(),pending=orders.submitForApproval(orders.createChangeOrder(draftInput()).id),original=pending.totalMinor;
 ledger.publishRates(o.ctx,getProject().rateCard.map(r=>({...r,unitAmountMinor:r.unitAmountMinor+100})),scope(o.ctx).contextVersion);
 assert.throws(()=>orders.submitForApproval(pending.id),/rates.*changed|review.*rates/i);
 const edited=orders.editChangeOrder(pending.id,{title:'Reviewed changed rates'}),submitted=orders.submitForApproval(edited.id);
 assert.equal(submitted.totalMinor,original+100);assert.equal(submitted.scopeContext.rateSnapshotId,scope(o.ctx).rateSnapshot.id);
});
test('legacy pending proposal keeps exact old URL after metadata import but never revives after a terms edit',async()=>{
 const o=owner(),p=getProject(),capture=await app.load('scopePersistence'),pair=capture.capturePair(db,p,o.session.runId,'legacy_import','proposal:legacy-pending:1','2020');
 db.prepare('INSERT INTO scope_contexts VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-pending-context','demo',o.session.runId,pair.scopeSnapshotId,pair.rateSnapshotId,null,'[]','legacy_import','now');
 const item=draftInput().lineItems;item[0].description=p.rateCard[0].description;item[0].unitAmountMinor=p.rateCard[0].unitAmountMinor;
 db.prepare("INSERT INTO change_orders(id,project_id,title,deliverables_json,line_items_json,total_minor,currency,status,created_at,run_id,revision,scope_revision_id,scope_snapshot_json) VALUES(?,?,?,?,?,?,?,'awaiting_client_approval','2020',?,1,?,?)").run('legacy-pending','demo','Legacy pending','["Original work"]',JSON.stringify(item),item[0].unitAmountMinor,'USD',o.session.runId,p.scopeRevisionId,JSON.stringify(p));
 ledger.linkScopeContext('proposal','legacy-pending',1,'legacy-pending-context');
 assert.equal(orders.getChangeOrder('legacy-pending').stale,false);
 const oldRates=p.rateCard;ledger.publishRates(o.ctx,oldRates.map(r=>({...r,unitAmountMinor:r.unitAmountMinor+100})),scope(o.ctx).contextVersion);
 ledger.publishRates(o.ctx,oldRates,scope(o.ctx).contextVersion);
 assert.throws(()=>orders.approveChangeOrder('legacy-pending',{changeOrderId:'legacy-pending',changeOrderRevision:1}),/review|Cannot approve|changed/i);
});
test('legacy delegation stays invalid after rates are reverted until fresh owner consent',()=>{
 const o=owner(),p=policy.saveAgentPolicy(o.session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:50000,maxTotalMinor:100000,maxQuantity:2,figmaClientIds:[]});delete p.scopeSnapshotId;delete p.rateSnapshotId;db.prepare('UPDATE agent_policies SET policy_json=? WHERE run_id=?').run(JSON.stringify(p),o.session.runId);
 const original=getProject().rateCard;ledger.publishRates(o.ctx,original.map(r=>({...r,unitAmountMinor:r.unitAmountMinor+100})),scope(o.ctx).contextVersion);ledger.publishRates(o.ctx,original,scope(o.ctx).contextVersion);
 assert.equal(policy.policyAuthority(policy.getAgentPolicy(o.session.runId)),false);
});
