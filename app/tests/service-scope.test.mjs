import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, draftInput, providerFixture, canonicalDraftFactory } from './helpers.mjs';

const app = await isolatedApp();
const { db, getProject, updateScopeBaseline } = await app.load('db');
const sessions = await app.load('sessions');
const orders = await app.load('orders');
const judging = await app.load('judging');
const context = await app.load('context').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const scopeLedger = await app.load('scopeLedger');
const service = await app.load('changeOrderService').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const canonicalInput=await canonicalDraftFactory(app);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; db.close(); });
function designer(runId) {
  assert.equal(typeof context.contextFromSessionToken, 'function', 'server-derived context factory is required');
  const session = sessions.createSession({ projectId:'demo', role:'designer', ...(runId ? {runId} : {}) });
  return { session, ctx:context.contextFromSessionToken(session.token) };
}
function client(order) {
  const session = sessions.createSession({ projectId:'demo', role:'client', runId:order.runId, changeOrderId:order.id, changeOrderRevision:order.revision });
  return { session, ctx:context.contextFromSessionToken(session.token) };
}

test('scoped service rejects forged, cloned and prototype-derived actor contexts', () => {
  const {ctx,session}=designer();
  const order=service.draftChangeOrder(ctx,canonicalInput(ctx));
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.grant));
  assert.ok(!JSON.stringify(ctx).includes(session.token));
  for(const fake of [{...ctx},JSON.parse(JSON.stringify(ctx)),Object.create(ctx),{...ctx,role:'client'},{}]) {
    assert.throws(()=>service.getScopedOrder(fake,order.id),e=>e.status===401);
  }
  assert.equal(service.getScopedOrder(ctx,order.id).id,order.id);
});

test('project/run/order/revision isolation applies before any scoped read or write', () => {
  const {ctx}=designer('scope-run-a'), other=designer('scope-run-b');
  const order=service.draftChangeOrder(ctx,canonicalInput(ctx)), second=service.draftChangeOrder(ctx,canonicalInput(ctx));
  assert.throws(()=>service.getScopedOrder(other.ctx,order.id),e=>e.status===403);
  db.prepare('UPDATE change_orders SET project_id = ? WHERE id = ?').run('foreign',second.id);
  assert.throws(()=>service.getScopedOrder(ctx,second.id),e=>e.status===403);
  assert.deepEqual(service.listScopedOrders(ctx).map(o=>o.id),[order.id]);
  const c=client(order);
  assert.throws(()=>service.getScopedOrder(c.ctx,second.id),e=>e.status===403);
  service.editScopedOrder(ctx,order.id,{title:'Revised'});
  assert.throws(()=>service.getScopedOrder(c.ctx,order.id),e=>e.status===403);
  assert.throws(()=>context.contextFromSessionToken(sessions.createSession({projectId:'foreign',role:'designer'}).token),e=>e.status===403);
});

test('client cannot draft/edit/submit/list/invoice/issue access and designer cannot approve', async () => {
  const {ctx}=designer(), order=service.draftChangeOrder(ctx,canonicalInput(ctx)), c=client(order);
  for(const action of [()=>service.draftChangeOrder(c.ctx,draftInput()),()=>service.editScopedOrder(c.ctx,order.id,{title:'Bad'}),
    ()=>service.submitScopedOrder(c.ctx,order.id),()=>service.listScopedOrders(c.ctx),()=>service.issueScopedClientAccess(c.ctx,order.id)])
    assert.throws(action,e=>e.status===403);
  await assert.rejects(service.prepareScopedInvoice(c.ctx,order.id),e=>e.status===403);
  await assert.rejects(service.approveScopedOrder(ctx,order.id),e=>e.status===403);
});

test('draft and edit field allowlists discard trusted metadata and nested line-item injection', () => {
  const {ctx}=designer();
  const input=canonicalInput(ctx); input.lineItems[0].paypalInvoiceId='forged'; input.lineItems[0].unitAmountMinor=1;
  const order=service.draftChangeOrder(ctx,{...input,projectId:'foreign',runId:'foreign',role:'client',status:'paid',paypalInvoiceId:'forged',totalMinor:1});
  assert.equal(order.projectId,'demo'); assert.equal(order.runId,ctx.runId); assert.equal(order.status,'draft');
  assert.equal(order.totalMinor,25000); assert.equal(order.paypalInvoiceId,null); assert.equal(order.lineItems[0].paypalInvoiceId,undefined);
  assert.equal(service.editScopedOrder(ctx,order.id,{title:'Edited',status:'paid',revision:999}).revision,2);
});

test('revoked, expired and mutated server sessions cannot reuse an already minted context', () => {
  for(const change of [s=>sessions.revokeSession(s.token),s=>db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE token=?").run(s.token),
    s=>db.prepare("UPDATE sessions SET run_id='forged' WHERE token=?").run(s.token)]) {
    const {ctx,session}=designer(); change(session);
    assert.throws(()=>service.draftChangeOrder(ctx,canonicalInput(ctx)),e=>e.status===401);
  }
});

test('judge grants retain frozen scope and reject mismatched persisted session grant scope', () => {
  assert.equal(typeof context.contextFromSessionToken,'function');
  const access=judging.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()});
  const s=judging.startJudgeRun(access.credential), ctx=context.contextFromSessionToken(s.token);
  const scope=getProject().scopeRevisionId;
  updateScopeBaseline([{id:'new',text:'Changed development scope'}]);
  const draft=service.draftChangeOrder(ctx,canonicalInput(ctx)), submitted=service.submitScopedOrder(ctx,draft.id);
  assert.equal(submitted.order.scopeRevisionId,scope); assert.match(submitted.approvalUrl,/#resume=/);
  assert.ok(service.issueScopedClientAccess(ctx,draft.id).approvalUrl);
  db.prepare("UPDATE sessions SET run_id='foreign' WHERE token=?").run(s.token);
  assert.equal(sessions.getSession(s.token),null);
  assert.throws(()=>service.getScopedOrder(ctx,draft.id),e=>e.status===401);
});

test('assessment attachment requires same project/run and current new-work classification atomically', () => {
  const {ctx}=designer();
  const count=()=>db.prepare('SELECT count(*) n FROM change_orders').get().n;
  const before=count();
  assert.throws(()=>service.draftChangeOrder(ctx,{...draftInput(),assessmentId:'missing'}),/assessment/i);
  assert.equal(count(),before);
  const valid=canonicalInput(ctx,{assessmentId:'assessment-scoped'});
  assert.equal(service.draftChangeOrder(ctx,valid).assessmentId,'assessment-scoped');
});

for(const stage of ['oauth','create','send','refresh']) test(`revocation during ${stage} stops further provider actions and disclosure while preserving recovery`,async()=>{
  // A fresh app gives each case an empty OAuth cache and independently owned locks.
  const a=await isolatedApp(); const d=await a.load('db'), s=await a.load('sessions'), o=await a.load('orders');
  const c=await a.load('context').catch(()=>({})), v=await a.load('changeOrderService').catch(()=>({}));
  assert.equal(typeof c.contextFromSessionToken,'function');
  const designer=s.createSession({projectId:'demo',role:'designer'}), dc=c.contextFromSessionToken(designer.token);
  const valid=await canonicalDraftFactory(a);const draft=v.draftChangeOrder(dc,valid(dc)); v.submitScopedOrder(dc,draft.id);
  const cs=s.createSession({projectId:'demo',role:'client',changeOrderId:draft.id,changeOrderRevision:1}), cc=c.contextFromSessionToken(cs.token);
  const fixture=providerFixture(); let reached,release;
  const gate=new Promise(r=>release=r), arrived=new Promise(r=>reached=r); let armed=true;
  globalThis.fetch=async(url,init)=>{
    const path=new URL(url).pathname;
    const matches=stage==='oauth'?path.endsWith('/token'):stage==='create'?path.endsWith('/invoices')&&init.method==='POST':stage==='send'?path.endsWith('/send'):path.includes('/invoices/')&&!path.endsWith('/send');
    const response=await fixture.fetch(url,init);
    if(armed&&matches){armed=false;reached();await gate;}
    return response;
  };
  let operation;
  try {
    if(stage==='refresh') {
      armed=false; await v.approveScopedOrder(cc,draft.id); armed=true;
      operation=v.getSettlement(cc,draft.id);
    }else operation=v.approveScopedOrder(cc,draft.id);
    await arrived; s.revokeSession(cs.token); release();
    await assert.rejects(operation,e=>e.status===401);
    assert.equal(d.db.prepare('SELECT count(*) n FROM approvals WHERE change_order_id=?').get(draft.id).n,1);
    if(stage==='oauth') assert.deepEqual(fixture.counts(),{creates:0,sends:0});
    if(stage==='create') {
      assert.deepEqual(fixture.counts(),{creates:1,sends:0});
      assert.equal(o.getChangeOrder(draft.id).paypalInvoiceId,'INV2-TEST-1');
      await v.prepareScopedInvoice(dc,draft.id);
      assert.deepEqual(fixture.counts(),{creates:1,sends:1});
    }
    if(stage==='send') assert.equal(d.db.prepare('SELECT state FROM invoice_operations WHERE change_order_id=?').get(draft.id).state,'sent');
    if(stage==='refresh') assert.equal(d.db.prepare('SELECT count(*) n FROM payment_observations WHERE change_order_id=?').get(draft.id).n,1);
  }finally{release();globalThis.fetch=originalFetch;d.db.close();}
});
