import {test} from 'node:test';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {isolatedApp} from './helpers.mjs';
import {seedContainerSmoke} from './container-smoke-fixture.mjs';

test('C5 smoke fixture satisfies the current public draft contract without provider work',async()=>{
 const app=await isolatedApp(),nativeFetch=globalThis.fetch;
 let server,db,providerRequests=0;
 try{
  globalThis.fetch=(url,init)=>{if(new URL(url).hostname==='127.0.0.1')return nativeFetch(url,init);providerRequests++;throw new Error('Smoke fixture attempted external traffic');};
  ({db}=await app.load('db'));
  const {session,otherSession,input}=await seedContainerSmoke(app);
  ({server}=await app.load('server'));if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,token=session.token,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const before={providerRequests,calls:db.prepare('SELECT count(*) n FROM ai_calls').get().n};
  const legacy=await request('/api/change-orders',session.token,{title:'Legacy smoke',currency:'USD',deliverables:['Synthetic mobile layout'],lineItems:[{rateCardId:'mobile_checkout',priceSource:'rate_card',quantity:1}]});
  assert.equal(legacy.status,400);assert.match((await legacy.json()).error,/canonical|item|operation/i);
  const createdResponse=await request('/api/change-orders',session.token,input),created=await createdResponse.json();
  assert.equal(createdResponse.status,201,JSON.stringify(created));
  assert.ok(input.itemIds.length&&input.operationId);
  assert.equal(created.totalMinor,25000);assert.equal(created.runId,session.runId);
  const repeated=await request('/api/change-orders',session.token,input);assert.equal(repeated.status,201);
  assert.equal((await repeated.json()).id,created.id);
  assert.equal(db.prepare('SELECT count(*) n FROM change_orders WHERE run_id=?').get(session.runId).n,1);
  assert.equal((await request('/api/change-orders/'+created.id,otherSession.token)).status,403);
  assert.deepEqual({providerRequests,calls:db.prepare('SELECT count(*) n FROM ai_calls').get().n},before);
 }finally{
  if(server)await new Promise(r=>server.close(r));globalThis.fetch=nativeFetch;db?.close();
 }
});
