import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureWebhookLookup} from '../../deploy/gcp/webhook-lookup.mjs';
test('provisioning creates and reads back a missing account mapping once',async()=>{
  let rows=[],creates=0;
  const api=async(path,init={})=>{assert.equal(path,'/v1/notifications/webhooks-lookup');if(init.method==='POST'){creates++;const row={id:'lookup',client_id:'own-app'};rows.push(row);return row;}return{webhooks_lookups:rows};};
  assert.deepEqual(await ensureWebhookLookup(api,'own-app'),{id:'lookup',created:true});
  assert.deepEqual(await ensureWebhookLookup(api,'own-app'),{id:'lookup',created:false});assert.equal(creates,1);
});
test('provisioning never replaces another app mapping or accepts an unreadable creation',async()=>{
  await assert.rejects(ensureWebhookLookup(async(path,init)=>{assert.ok(!init);return{webhooks_lookups:[{id:'other',client_id:'other-app'}]};},'own-app'),/another app/);
  await assert.rejects(ensureWebhookLookup(async(path,init)=>init?{id:'new',client_id:'own-app'}:{webhooks_lookups:[]},'own-app'),/read back/);
});
