import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webhookTargets,ensureInvoiceWebhook} from './webhook-subscription.mjs';
const original='https://app.example/webhooks/paypal', callback='https://ingress.example/webhooks/paypal';
const names=['INVOICING.INVOICE.PAID','INVOICING.INVOICE.UPDATED'];
const types=names.map(name=>({name}));

test('callback selection persists separately from the app origin and rejects unsafe URLs',()=>{
  assert.equal(webhookTargets('https://app.example',undefined,'PAYPAL_WEBHOOK_URL='+callback+'\n').callback,callback);
  assert.equal(webhookTargets('https://app.example',original,'PAYPAL_WEBHOOK_URL='+callback+'\n').callback,original);
  assert.equal(webhookTargets('https://app.example').callback,original);
  assert.equal(webhookTargets('https://app.example',callback).origin.origin,'https://app.example');
  for(const value of ['http://ingress.example/webhooks/paypal','https://user:pass@ingress.example/webhooks/paypal','https://ingress.example:8443/webhooks/paypal','https://ingress.example/other','https://ingress.example/webhooks/paypal?q=1','https://ingress.example/webhooks/paypal#x'])assert.throws(()=>webhookTargets('https://app.example',value));
  for(const value of ['https://app.example/path','https://app.example/?x=1','https://app.example/#x'])assert.throws(()=>webhookTargets(value));
});

test('moving an explicitly selected hook preserves its ID and unrelated event types',async()=>{
  let hook={id:'HOOK-owned',url:original,event_types:[...types,{name:'OTHER.EVENT'}]};const writes=[];
  const api=async(path,init={})=>{
    if(init.method==='PATCH'){writes.push(JSON.parse(init.body));for(const patch of writes.at(-1))hook={...hook,[patch.path.slice(1)]:patch.value};return hook;}
    assert.equal(init.method,undefined);return path.endsWith('/webhooks')?{webhooks:[hook]}:hook;
  };
  const result=await ensureInvoiceWebhook(api,{callback,names,webhookId:hook.id});
  assert.equal(result.hook.id,'HOOK-owned');assert.equal(result.hook.url,callback);assert.equal(result.created,false);assert.equal(result.updated,true);
  assert.deepEqual(writes,[[{op:'replace',path:'/url',value:callback}]]);assert.ok(result.hook.event_types.some(x=>x.name==='OTHER.EVENT'));
  writes.length=0;assert.equal((await ensureInvoiceWebhook(api,{callback,names,webhookId:hook.id})).updated,false);assert.equal(writes.length,0);
});

test('missing IDs and conflicting callbacks fail before any mutation',async()=>{
  for(const webhooks of [[{id:'OTHER',url:original,event_types:types}],[{id:'HOOK-owned',url:original,event_types:types},{id:'OTHER',url:callback,event_types:types}],[{id:'A',url:callback,event_types:types},{id:'B',url:callback,event_types:types}]]){
    const api=async(_path,init={})=>{assert.equal(init.method,undefined);return{webhooks};};
    await assert.rejects(ensureInvoiceWebhook(api,{callback,names,webhookId:'HOOK-owned'}));
  }
});

test('new setup creates once, reads back and validates the invoice subscription',async()=>{
  let hook;let created=0;
  const api=async(path,init={})=>{
    if(init.method==='POST'){created++;hook={id:'NEW',...JSON.parse(init.body)};return hook;}
    return path.endsWith('/webhooks')?{webhooks:hook?[hook]:[]}:hook;
  };
  assert.equal((await ensureInvoiceWebhook(api,{callback,names})).created,true);
  assert.equal((await ensureInvoiceWebhook(api,{callback,names})).created,false);assert.equal(created,1);
});

test('required invoice types are added without removing existing subscriptions',async()=>{
  let hook={id:'HOOK-owned',url:callback,event_types:[{name:'OTHER.EVENT'}]};
  const api=async(path,init={})=>{
    if(init.method==='PATCH'){const patches=JSON.parse(init.body);assert.deepEqual(patches.map(x=>x.path),['/event_types']);hook={...hook,event_types:patches[0].value};return hook;}
    return path.endsWith('/webhooks')?{webhooks:[hook]}:hook;
  };
  const {hook:verified}=await ensureInvoiceWebhook(api,{callback,names,webhookId:hook.id});
  assert.deepEqual(verified.event_types.map(x=>x.name).sort(),[...names,'OTHER.EVENT'].sort());
});

test('a mismatched provider readback cannot report successful registration',async()=>{
  const hook={id:'HOOK-owned',url:callback,event_types:types};
  const api=async path=>path.endsWith('/webhooks')?{webhooks:[hook]}:{...hook,url:original};
  await assert.rejects(ensureInvoiceWebhook(api,{callback,names,webhookId:hook.id}),/readback/);
});
