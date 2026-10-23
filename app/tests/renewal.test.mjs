import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('browser renewal coalesces concurrent expiry, preserves its credential and retries once',async t=>{
  globalThis.window={};globalThis.location={origin:'https://fixture.test'};
  const module=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../web/common.js',import.meta.url),'utf8')).toString('base64'));
  let session={token:'expired',renewalCredential:'private-grant'},renewals=0,requests=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(url.endsWith('/api/session/renew')){renewals++;return Response.json({token:'fresh',role:'designer',runId:'one'});}
    requests++;return init.headers.Authorization==='Bearer fresh'?Response.json({ok:true}):Response.json({error:'expired'},{status:401});
  });
  const api=module.sessionApi(()=>session,value=>session=value);
  assert.deepEqual(await Promise.all([api('/a'),api('/b')]),[{ok:true},{ok:true}]);
  assert.equal(renewals,1);assert.equal(requests,4);assert.equal(session.renewalCredential,'private-grant');
});

test('failed renewal and rejected retries clear private UI state without retry loops',async t=>{
  globalThis.window={};globalThis.location={origin:'https://fixture.test'};
  const module=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../web/common.js',import.meta.url),'utf8')+'\n// next test').toString('base64'));
  let calls=0,cleared=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'revoked'},{status:401});});
  const api=module.sessionApi(()=>({token:'expired',renewalCredential:'revoked'}),()=>{},()=>cleared++);
  await assert.rejects(api('/private'),/revoked/);assert.equal(calls,2);assert.equal(cleared,1);
  calls=0;cleared=0;
  const legacy=module.sessionApi(()=>({token:'old'}),()=>{},()=>cleared++);
  await assert.rejects(legacy('/private'),/revoked/);assert.equal(calls,1);assert.equal(cleared,1);
});
