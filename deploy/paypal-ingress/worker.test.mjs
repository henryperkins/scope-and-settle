import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const signatures={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fixture','paypal-transmission-id':'fixture-transmission','paypal-transmission-sig':'PRIVATE SIGNATURE SENTINEL','paypal-transmission-time':'2026-10-23T03:00:00Z'};
const signed=body=>new Request('https://ingress.test/webhooks/paypal?ignored=true',{method:'POST',headers:{...signatures,'Content-Type':'application/json',Authorization:'PRIVATE AUTH SENTINEL',Cookie:'PRIVATE COOKIE SENTINEL'},body});
test('ingress forwards raw bytes and signature fields only to the fixed verifier',async t=>{
  const raw='{\n "id": "WH-fixture", "text":"café", "extra": [1,  2]\n}';
  const logs=[];t.mock.method(console,'info',v=>logs.push(v));
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://scope-and-settle.hperkins.com/webhooks/paypal');assert.equal(init.redirect,'manual');
    assert.equal(await new Response(init.body).text(),raw);
    for(const[name,value]of Object.entries(signatures))assert.equal(init.headers.get(name),value);
    assert.equal(init.headers.get('authorization'),null);assert.equal(init.headers.get('cookie'),null);
    return Response.json({state:'reconciled'});
  });
  const response=await worker.fetch(signed(raw));assert.equal(response.status,200);assert.deepEqual(await response.json(),{state:'reconciled'});
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'));assert.ok(!JSON.stringify(logs).includes(raw));
});
test('ingress never acknowledges rejection, upstream failure or redirects as successful delivery',async t=>{
  t.mock.method(console,'info',()=>{});t.mock.method(console,'warn',()=>{});
  for(const status of [401,502,503,302]){
    t.mock.method(globalThis,'fetch',async()=>new Response('upstream',{status}));
    const r=await worker.fetch(signed('{}'));assert.equal(r.status,status===302?502:status);
  }
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('PRIVATE ERROR SENTINEL');});
  const r=await worker.fetch(signed('{}'));assert.equal(r.status,502);assert.ok(!(await r.text()).includes('PRIVATE'));
});
test('unsigned and unrelated requests cannot proxy to another endpoint',async t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('Unexpected upstream request'));
  assert.equal((await worker.fetch(new Request('https://ingress.test/webhooks/paypal',{method:'POST',body:'{}'}))).status,401);
  assert.equal((await worker.fetch(new Request('https://ingress.test/admin?url=https://evil.test'))).status,404);
  assert.equal((await worker.fetch(new Request('https://ingress.test/webhooks/paypal'))).status,404);
});
