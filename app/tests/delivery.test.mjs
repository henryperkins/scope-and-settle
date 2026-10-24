import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryFixture,outputFor,deliveryPng} from './delivery-fixture.mjs';
import {pluginFixture} from './figma-card-fixture.mjs';

test('T15 authority loss during refreshed payment and cancelled native font loading cause no new work',async()=>{
 const f=await deliveryFixture(),inner=globalThis.fetch;try{
  f.pay();globalThis.fetch=async(url,init)=>{const response=await inner(url,init);if(String(url).includes('/invoices/'))f.m.sessions.revokeSession(f.session.token);return response;};
  await assert.rejects(f.delivery.startApprovedWork(f.ctx,f.target.id),e=>e.status===401);assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_runs').get().n,0);
 }finally{globalThis.fetch=inner;await f.close();}
 const g=await deliveryFixture();try{
  g.pay();const run=await g.delivery.startApprovedWork(g.ctx,g.target.id),p=await pluginFixture();let release,entered;const began=new Promise(r=>entered=r),held=new Promise(r=>release=r);p.fontHook=async()=>{entered();await held;};
  await p.figma.ui.onmessage({type:'delivery-context',context:{epoch:'held',fileKey:'test-file',projectId:g.ctx.projectId,runId:g.ctx.runId}});const before=p.writes;
  const pending=p.figma.ui.onmessage({type:'generate-delivery',invocationId:'held-font',epoch:'held',run});await began;await p.figma.ui.onmessage({type:'delivery-context',context:null});release();await pending;
  assert.equal(p.writes,before);assert.equal(p.messages.findLast(m=>m.invocationId==='held-font').ok,false);
 }finally{await g.close();}
});

test('T15 HTTP start requires an authenticated designer and explicit consent; snapshots remain scoped',async()=>{
 const f=await deliveryFixture();try{
  f.pay();const path='/api/milestones/'+f.target.id+'/start-work';
  assert.equal((await f.http(path,'POST',{consent:true},f.clientToken)).status,403);
  assert.equal((await f.http(path,'POST',{consent:false})).status,400);
  const response=await f.http(path,'POST',{consent:true});assert.equal(response.status,201,JSON.stringify(response.body));
  const snapshot=await f.http('/api/delivery-runs/'+response.body.id+'/output','POST',outputFor(response.body));assert.equal(snapshot.status,201);
  assert.equal((await f.http('/api/delivery-snapshots/'+snapshot.body.id,'GET',undefined,f.clientToken)).status,403);
 }finally{await f.close();}
});

test('T15 only coherent refreshed approved deposit authorizes one immutable work run without requiring the balance',async()=>{
 const f=await deliveryFixture();try{
  assert.equal(typeof f.delivery.prepareDeliveryBrief,'function','Paid approved work needs a delivery brief');
  await assert.rejects(f.delivery.prepareDeliveryBrief(f.ctx,f.target.id),/payment|deposit|prerequisite/i);assert.equal(f.provider.counts().creates,1);
  f.pay();const brief=await f.delivery.prepareDeliveryBrief(f.ctx,f.target.id);assert.equal(brief.orderId,f.order.id);assert.equal(brief.revision,2);assert.equal(brief.paymentCondition.observations.length,1);assert.equal(brief.paymentCondition.observations[0].invoiceRecordId,f.deposit.invoiceRecordId);assert.equal(brief.allowedArea.fileKey,'test-file');assert.equal(brief.optionalCapabilities.specs,false);
  const [first,second]=await Promise.all([f.delivery.startApprovedWork(f.ctx,f.target.id),f.delivery.startApprovedWork(f.ctx,f.target.id)]);assert.equal(first.id,second.id);assert.equal(first.state,'draft');assert.equal(f.db.prepare('SELECT count(*) n FROM delivery_runs').get().n,1);assert.equal(f.provider.counts().creates,1);
  assert.throws(()=>f.db.prepare('UPDATE delivery_runs SET brief_json=? WHERE id=?').run('{}',first.id),/immutable/i);
 }finally{await f.close();}
});

test('T15 a reversed deposit and changed scope refuse starting work while keeping generated history',async()=>{
 const f=await deliveryFixture();try{
  assert.equal(typeof f.delivery.startApprovedWork,'function');f.pay();const run=await f.delivery.startApprovedWork(f.ctx,f.target.id);const snapshot=f.delivery.recordDeliveryOutput(f.ctx,run.id,outputFor(run));
  const invoice=f.provider.invoices.get(f.deposit.paypalInvoiceId);invoice.status='REFUNDED';invoice.refunds={refund_amount:invoice.amount,transactions:[{type:'PAYPAL',refund_id:'reverse',amount:invoice.amount}]};
  await assert.rejects(f.delivery.startApprovedWork(f.ctx,f.target.id),/payment|review|prerequisite/i);assert.equal(f.delivery.getDeliveryRun(f.ctx,run.id).financialReviewRequired,true);assert.equal(f.delivery.getDeliverySnapshot(f.ctx,snapshot.id).hash,snapshot.hash);
  f.pay();delete invoice.refunds;f.m.db.updateScopeBaseline([{id:'changed',text:'Changed agreement'}]);
  await assert.rejects(f.delivery.prepareDeliveryBrief(f.ctx,f.target.id),/scope|revision/i);
 }finally{await f.close();}
});

test('T15 output reports bind exact operation/file/allowed area, validate images, and preserve client-supplied provenance',async()=>{
 const f=await deliveryFixture();try{
  assert.equal(typeof f.delivery.recordDeliveryOutput,'function');f.pay();const run=await f.delivery.startApprovedWork(f.ctx,f.target.id);
  for(const overrides of [{fileKey:'another-file'},{operationId:'other'},{nodes:[{id:'draft-area',parentId:'draft-page',type:'FRAME'},{id:'draft-label',parentId:'original-page',type:'TEXT'}]},{imageDataUrl:'data:image/png;base64,eA=='},{nodeIds:['outside']}])assert.throws(()=>f.delivery.recordDeliveryOutput(f.ctx,run.id,outputFor(run,overrides)));
  const output=outputFor(run),s=f.delivery.recordDeliveryOutput(f.ctx,run.id,output);assert.equal(s.pixelProvenance,'client_supplied');assert.equal(s.nodeProvenance,'client_plugin_claim');assert.equal(s.accepted,false);assert.equal(f.delivery.recordDeliveryOutput(f.ctx,run.id,output).id,s.id);
  assert.throws(()=>f.delivery.recordDeliveryOutput(f.ctx,run.id,outputFor(run,{pageId:'original-page',nodes:[{id:'draft-area',parentId:'original-page',type:'FRAME'},{id:'draft-label',parentId:'draft-area',type:'TEXT'}]})),/area|page/i);
  assert.throws(()=>f.delivery.getDeliverySnapshot(f.client,s.id),e=>e.status===403);assert.equal(f.db.prepare('SELECT count(*) n FROM milestone_due_events').get().n,0);
 }finally{await f.close();}
});

test('T15 the real built plugin creates/readbacks one dedicated draft area and preserves original selection/nodes',async()=>{
 const f=await deliveryFixture();try{
  assert.equal(typeof f.delivery.startApprovedWork,'function');f.pay();const run=await f.delivery.startApprovedWork(f.ctx,f.target.id),p=await pluginFixture();const original=p.make('FRAME','original');p.page.appendChild(original);p.page.selection=[original];
  const context={epoch:'delivery-one',fileKey:'test-file',projectId:f.ctx.projectId,runId:f.ctx.runId};await p.figma.ui.onmessage({type:'delivery-context',context});
  const invoke=async id=>{await p.figma.ui.onmessage({type:'generate-delivery',invocationId:id,epoch:context.epoch,run});return p.messages.findLast(m=>m.invocationId===id);};
  const result=await invoke('one');assert.equal(result?.type,'delivery-result');assert.equal(result.ok,true,result.message);assert.notEqual(result.output.pageId,p.page.id);assert.equal(result.output.nodeIds.includes(original.id),false);assert.equal(p.page.selection[0],original);assert.equal(original.parent,p.page);
  const snapshot=f.delivery.recordDeliveryOutput(f.ctx,run.id,result.output);assert.equal(snapshot.pixelProvenance,'client_supplied');const second=await invoke('two');assert.equal(second.output.areaId,result.output.areaId);assert.equal(p.root.children.filter(n=>n.id===result.output.pageId).length,1);
  const savedRun=f.delivery.getDeliveryRun(f.ctx,run.id),savedPage=p.nodes.get(result.output.pageId);savedPage.remove();const beforeMissing=p.writes;
  await p.figma.ui.onmessage({type:'generate-delivery',invocationId:'missing-saved',epoch:context.epoch,run:savedRun});assert.equal(p.messages.findLast(m=>m.invocationId==='missing-saved').ok,false);assert.equal(p.writes,beforeMissing,'A missing saved draft needs review, not another native generation');
  const nodes=p.nodes.size;await p.figma.ui.onmessage({type:'generate-delivery',invocationId:'wrong',epoch:context.epoch,run:{...run,brief:{...run.brief,allowedArea:{...run.brief.allowedArea,fileKey:'other'}}}});assert.equal(p.messages.findLast(m=>m.invocationId==='wrong').ok,false);assert.equal(p.nodes.size,nodes);
 }finally{await f.close();}
});
