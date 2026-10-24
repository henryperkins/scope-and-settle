import { test, after } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput, canonicalDraftFactory } from './helpers.mjs';

const app=await isolatedApp();
const {db,getProject,updateScopeBaseline,currentRunId}=await app.load('db');
const judging=await app.load('judging');
const sessions=await app.load('sessions');
const canonicalInput=await canonicalDraftFactory(app),contexts=await app.load('context');
const orders=await app.load('orders');
const provider=providerFixture(), originalFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>new URL(url).hostname==='127.0.0.1'?originalFetch(url,init):provider.fetch(url,init);
const {server}=await app.load('server');
if(!server.listening)await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;db.close();});
const expiry=()=>new Date(Date.now()+86400000).toISOString();
async function request(path,session,method='GET',body){return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function start(key){const r=await request('/api/judge/start',null,'POST',{credential:key.credential});assert.equal(r.status,201);return r.json();}
async function proposal(session){let r=await request('/api/change-orders',session,'POST',canonicalInput(contexts.contextFromSessionToken(session.token)));assert.equal(r.status,201);const o=await r.json();r=await request('/api/change-orders/'+o.id+'/submit',session,'POST');assert.equal(r.status,200);return r.json();}
async function clientFor(submitted){const secret=new URL(submitted.approvalUrl).hash.slice('#resume='.length);const r=await request('/api/session/renew',null,'POST',{credential:secret,role:'designer',runId:'someone-else'});assert.equal(r.status,200);return r.json();}

test('judge entry creates independent runs and never stores raw access secrets',async()=>{
  const key=judging.createJudgeAccess({expiresAt:expiry()});
  const a=await start(key),b=await start(key);
  assert.notEqual(a.runId,b.runId);assert.equal(a.role,'designer');assert.equal(a.canEditScope,false);
  assert.ok(Date.parse(a.expiresAt)-Date.now()<=3600000);
  const dump=JSON.stringify(db.prepare('SELECT * FROM judge_access').all())+JSON.stringify(db.prepare('SELECT * FROM renewal_grants').all());
  assert.ok(!dump.includes(key.credential));assert.ok(!dump.includes(a.renewalCredential));
  assert.equal((await request('/api/judge/start',null,'POST',{credential:'wrong'})).status,401);
  const o=await proposal(a);assert.equal((await request('/api/change-orders/'+o.order.id,b)).status,403);
  assert.deepEqual(await (await request('/api/change-orders',b)).json(),[]);
});

test('expired sessions renew only within their existing grant and parent credential',async()=>{
  const key=judging.createJudgeAccess({expiresAt:expiry()}),a=await start(key);
  db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01T00:00:00Z',a.token);
  assert.equal((await request('/api/project',a)).status,401);
  const r=await request('/api/session/renew',null,'POST',{credential:a.renewalCredential,runId:'run-1',role:'client'});
  assert.equal(r.status,200);const renewed=await r.json();assert.equal(renewed.runId,a.runId);assert.equal(renewed.role,'designer');
  sessions.revokeSession(renewed.token);
  assert.equal((await request('/api/session/renew',null,'POST',{credential:a.renewalCredential})).status,401);
  const b=await start(key);judging.revokeJudgeAccess(key.id);
  assert.equal((await request('/api/project',b)).status,401);
  assert.equal((await request('/api/session/renew',null,'POST',{credential:b.renewalCredential})).status,401);
  assert.equal((await request('/api/judge/start',null,'POST',{credential:key.credential})).status,401);
});

test('client renewal preserves role, run and exact revision through payment',async()=>{
  const key=judging.createJudgeAccess({expiresAt:expiry()}),a=await start(key),submitted=await proposal(a),client=await clientFor(submitted);
  assert.equal(client.role,'client');assert.equal(client.runId,a.runId);assert.equal(client.changeOrderId,submitted.order.id);assert.equal(client.changeOrderRevision,1);
  assert.equal((await request('/api/demo/reset',client,'POST')).status,403);
  const approved=await (await request('/api/change-orders/'+submitted.order.id+'/approve',client,'POST')).json();
  assert.ok(approved.paypalInvoiceId);const before=provider.counts().creates;
  db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01T00:00:00Z',client.token);
  const renewed=await (await request('/api/session/renew',null,'POST',{credential:client.renewalCredential})).json();
  assert.equal((await request('/api/change-orders/'+submitted.order.id,renewed)).status,200);
  assert.equal(provider.counts().creates,before,'Renewal never creates another invoice');
});

test('a client grant cannot renew an edited or superseded revision',async()=>{
  const a=await start(judging.createJudgeAccess({expiresAt:expiry()})),submitted=await proposal(a),client=await clientFor(submitted);
  assert.equal((await request('/api/change-orders/'+submitted.order.id,a,'PATCH',{title:'Reviewed mobile layouts'})).status,200);
  assert.equal((await request('/api/change-orders/'+submitted.order.id+'/submit',a,'POST')).status,200);
  assert.equal((await request('/api/session/renew',null,'POST',{credential:client.renewalCredential})).status,401);
  assert.equal((await request('/api/change-orders/'+submitted.order.id+'/approve',client,'POST')).status,401);
});

test('judging scope stays frozen even when a developer revises the shared brief',async()=>{
  const original=getProject(),key=judging.createJudgeAccess({expiresAt:expiry()}),a=await start(key);
  assert.equal((await request('/api/project/scope',a,'POST',{clauses:[{id:'changed',text:'Changed by judge'}]})).status,403);
  updateScopeBaseline([{id:'developer-change',text:'Changed in the separate development scenario.'}]);
  const b=await start(key);
  for(const s of [a,b]){const p=await (await request('/api/project',s)).json();assert.equal(p.scopeRevisionId,original.scopeRevisionId);assert.deepEqual(p.scopeClauses,original.scopeClauses);const submitted=await proposal(s);assert.equal(submitted.order.scopeRevisionId,original.scopeRevisionId);}
});

test('reset retires only its own run, tombstones invoices and preserves AI accounting',async()=>{
  const key=judging.createJudgeAccess({expiresAt:expiry()}),a=await start(key),b=await start(key),sa=await proposal(a),sb=await proposal(b),client=await clientFor(sa);
  const approved=await (await request('/api/change-orders/'+sa.order.id+'/approve',client,'POST')).json();
  const stateBefore=currentRunId(),ledgerBefore=JSON.stringify(db.prepare('SELECT * FROM ai_calls').all());
  const r=await request('/api/demo/reset',a,'POST');assert.equal(r.status,200);const reset=await r.json();
  assert.notEqual(reset.session.runId,a.runId);assert.equal(currentRunId(),stateBefore);
  assert.equal((await request('/api/project',a)).status,401);assert.equal((await request('/api/session/renew',null,'POST',{credential:a.renewalCredential})).status,401);
  assert.equal((await request('/api/session/renew',null,'POST',{credential:client.renewalCredential})).status,401);
  assert.equal((await request('/api/change-orders/'+sb.order.id,b)).status,200);
  assert.ok(db.prepare('SELECT * FROM invoice_tombstones WHERE paypal_invoice_id=?').get(approved.paypalInvoiceId));
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM ai_calls').all()),ledgerBefore);
  assert.deepEqual(await (await request('/api/change-orders',reset.session)).json(),[]);
  assert.equal(orders.getChangeOrder(sa.order.id),null);
});

test('parent expiry bounds sessions and client access without reviving expired grants',async()=>{
  const key=judging.createJudgeAccess({expiresAt:new Date(Date.now()+90000).toISOString()}),a=await start(key);
  assert.equal(a.expiresAt,key.expiresAt);
  const submitted=await proposal(a),client=await clientFor(submitted);
  assert.equal(client.expiresAt,key.expiresAt);
  db.prepare('UPDATE judge_access SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',key.id);
  assert.equal((await request('/api/project',a)).status,401);
  assert.equal((await request('/api/session/renew',null,'POST',{credential:client.renewalCredential})).status,401);
});

test('an invoice in flight blocks only its own reset and completes without orphaning its run',async()=>{
  const key=judging.createJudgeAccess({expiresAt:expiry()}),a=await start(key),b=await start(key),submitted=await proposal(a),client=await clientFor(submitted);
  let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const fallback=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{if(new URL(url).pathname==='/v2/invoicing/invoices'&&init?.method==='POST'){entered();await gate;}return fallback(url,init);};
  try{
    const paying=request('/api/change-orders/'+submitted.order.id+'/approve',client,'POST');await started;
    assert.equal((await request('/api/demo/reset',a,'POST')).status,409);
    assert.equal((await request('/api/demo/reset',b,'POST')).status,200);
    release();assert.equal((await paying).status,200);
    assert.ok(orders.getChangeOrder(submitted.order.id).paypalInvoiceId);
    assert.equal((await request('/api/demo/reset',a,'POST')).status,200);
  }finally{release();globalThis.fetch=fallback;}
});

test('an assessment finishing after reset keeps its charge but cannot resurrect cleared evidence',async()=>{
  const a=await start(judging.createJudgeAccess({expiresAt:expiry()})),project=await (await request('/api/project',a)).json();
  const {assess}=await app.load('assessment'),{aiBudget}=await app.load('aiBudget');
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),fallback=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(new URL(url).hostname==='inference.baseten.co'){
      entered();await gate;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({classification:'needs_clarification',explanation:'Clarify the request.',evidence:[],deliverables:[],rates:[],questions:['Which screens?'],designObservations:[]})}}],usage:{prompt_tokens:1000,completion_tokens:500}});
    }return fallback(url,init);
  };
  try{
    const before=aiBudget.status().spentMicroUsd;
    const pending=assess({project,comment:{id:'test',message:'Mobile?'},replies:[]},a.runId);
    const rejected=assert.rejects(pending,/reset/);await started;
    assert.equal((await request('/api/demo/reset',a,'POST')).status,200);release();await rejected;
    assert.equal(db.prepare('SELECT count(*) AS n FROM assessments WHERE run_id=?').get(a.runId).n,0);
    assert.ok(aiBudget.status().spentMicroUsd>before);
  }finally{release();globalThis.fetch=fallback;}
});
