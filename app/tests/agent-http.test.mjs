import {test,after} from 'node:test';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {isolatedApp,providerFixture} from './helpers.mjs';
const app=await isolatedApp(),{db}=await app.load('db'),{createJudgeAccess,startJudgeRun}=await app.load('judging');
const provider=providerFixture(),originalFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>new URL(url).hostname==='127.0.0.1'?originalFetch(url,init):provider.fetch(url,init);
const {server}=await app.load('server');if(!server.listening)await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;db.close();});
async function req(path,token,body){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const policy={enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1};
const access=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=startJudgeRun(access.credential);
test('client assets are public but all agent and portal data require the right authority',async()=>{
 for(const path of ['/client','/assets/client.js','/assets/agent.js'])assert.equal((await req(path)).status,200,path);
 assert.equal((await req('/api/agent')).status,401);assert.equal((await req('/api/portal',owner.token)).status,401);
 assert.equal((await req('/api/agent/policy',owner.token,{...policy,consent:false})).status,400);
 assert.equal((await req('/api/agent/policy',owner.token,policy)).status,200);
 const created=await req('/api/agent/portal-access',owner.token,{});assert.equal(created.status,201);const portal=await created.json();
 assert.equal((await req('/api/agent',portal.credential)).status,401);
 assert.equal((await req('/api/portal',portal.credential)).status,200);
 const r=await req('/api/portal/requests',portal.credential,{text:'Can you add the mobile checkout?',key:'request-001'});assert.equal(r.status,201);
 const id=(await r.json()).id;assert.equal((await req('/api/portal/requests/'+id+'/approve',portal.credential,{revision:1,consent:true})).status,409);
 const view=await (await req('/api/agent',owner.token)).json();assert.equal(view.requests.length,1);assert.ok(!JSON.stringify(view).includes(owner.grantId));
 assert.equal((await req('/api/agent/requests/'+id+'/dismiss',portal.credential,{})).status,401);
 assert.equal((await req('/api/agent/requests/'+id+'/dismiss',owner.token,{})).status,200);
});
