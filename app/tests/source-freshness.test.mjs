import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './source-freshness-fixture.mjs';

// T11a: a known authoritative source unavailability is a persistent fence on new effects only.
// Every row asserts durable rows and provider/model counts; an error status alone is not evidence.
const UNAVAILABLE=/unavailable/i;
const isBounds=variant=>['long','replies','bounds-file'].includes(variant);

function holdNextRead(f){
 let release,entered;const pending=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 f.readHook=()=>{f.readHook=null;entered();return pending;};return {started,release:()=>release()};
}
for(const recover of [true,false])test(`C1 old missing read cannot overwrite newer ${recover?'recovery':'unchanged successful observation'}`,async()=>{
 const f=await fixture();let held,oldRead;
 try{
  f.enable();const root=f.root('c1-ordering','Mobile checkout ordering request'),a=await f.assessThread(root.id);
  const draft=await f.draft([a.assessment.items[0].id],'c1-ordering-draft',a.assessment.id);assert.equal(draft.status,201);
  const submitted=await f.submit(draft.body.id),client=await f.redeem(submitted.approvalUrl),before=f.head(root.id),history=f.db.prepare('SELECT * FROM proposal_revisions ORDER BY rowid').all();
  f.remove(root.id);if(recover)assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:root.id})).status,400);
  held=holdNextRead(f);oldRead=f.http('/api/inbox/refresh','POST',{commentId:root.id});await held.started;
  f.comments=[root];const newer=await f.http('/api/inbox/refresh','POST',{commentId:root.id});assert.equal(newer.status,200,JSON.stringify(newer.body));
  const current=f.head(root.id),counts=f.counts();held.release();const older=await oldRead;
  assert.equal(older.status,409,'stale missing read must be rejected');assert.equal(f.sources.sourceUnavailable(before.id),false);
  assert.deepEqual(f.head(root.id),current);assert.equal(f.inbox.listRequestInbox(f.ctx).find(r=>r.rootId===root.id).availability,'available');
  assert.equal(current.version,before.version+(recover?1:0));assert.deepEqual(f.counts(),counts);assert.deepEqual(f.db.prepare('SELECT * FROM proposal_revisions ORDER BY rowid').all(),history);
  if(recover){const refused=await f.http('/api/change-orders/'+draft.body.id+'/approve','POST',{},client);assert.equal(refused.status,409);assert.equal(f.orders.getChangeOrder(draft.body.id).approvalStatus,'awaiting_client_approval');}
 }finally{held?.release();if(oldRead)await oldRead.catch(()=>{});await f.close();}
});

test('C1 old successful read cannot roll back a newer source or inbox projection',async()=>{
 const f=await fixture();let held,oldRead;
 try{
  f.enable();const root=f.root('c1-success','Mobile checkout alpha');await f.assessThread(root.id);
  held=holdNextRead(f);oldRead=f.http('/api/inbox/refresh','POST',{commentId:root.id});await held.started;
  f.comment(root.id).message='Mobile checkout bravo';const newer=await f.http('/api/inbox/refresh','POST',{commentId:root.id});assert.equal(newer.status,200);
  const current=f.head(root.id),counts=f.counts();held.release();assert.equal((await oldRead).status,409);
  assert.deepEqual(f.head(root.id),current);assert.equal(f.inbox.listRequestInbox(f.ctx).find(r=>r.rootId===root.id).text,'Mobile checkout bravo');assert.deepEqual(f.counts(),counts);
 }finally{held?.release();if(oldRead)await oldRead.catch(()=>{});await f.close();}
});

test('C1 direct manual same-byte recovery advances version without reviving pending approval',async()=>{
 const f=await fixture();try{
  const root=f.root('c1-manual','Mobile checkout manual recovery'),a=await f.http('/api/assessments','POST',{commentId:root.id});assert.equal(a.status,201);
  const draft=await f.draft([a.body.items[0].id],'c1-manual-draft',a.body.id);assert.equal(draft.status,201);
  const submitted=await f.submit(draft.body.id),client=await f.redeem(submitted.approvalUrl),before=f.head(root.id),counts=f.counts();
  f.remove(root.id);await assert.rejects(f.sources.refreshFigmaSource(f.ctx.runId,root.id,()=>f.m.context.requireDesignerContext(f.ctx)),e=>e.status===400);
  assert.equal(f.sources.sourceUnavailable(before.id),true);f.comments=[root];
  const recovered=await f.sources.refreshFigmaSource(f.ctx.runId,root.id,()=>f.m.context.requireDesignerContext(f.ctx));
  assert.equal(recovered.reference.version,before.version+1);assert.equal(recovered.reference.contentHash,before.contentHash);assert.equal(f.sources.sourceUnavailable(before.id),false);
  assert.equal((await f.http('/api/change-orders/'+draft.body.id+'/approve','POST',{},client)).status,409);assert.deepEqual(f.counts(),counts);
 }finally{await f.close();}
});

test('C1 stale file refresh preserves a newer manual recovery and still commits its healthy peer',async()=>{
 const f=await fixture();let held,oldRead;
 try{
  f.enable();const root=f.root('c1-file-root','Mobile checkout restored');await f.assessThread(root.id);f.root('c1-file-peer','Carousel peer');f.remove(root.id);
  await f.event('c1-file-peer');held=holdNextRead(f);oldRead=f.jobs.runInboxJobs(new Date(),'figma_refresh');await held.started;
  f.comments.push(root);assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:root.id})).status,200);
  const current=f.head(root.id);held.release();await oldRead;
  assert.equal(f.sources.sourceUnavailable(current.id),false);assert.deepEqual(f.head(root.id),current);
  assert.equal(f.inbox.listRequestInbox(f.ctx).find(r=>r.rootId===root.id).availability,'available');assert.ok(f.head('c1-file-peer'));
 }finally{held?.release();if(oldRead)await oldRead.catch(()=>{});await f.close();}
});

for(const enabled of [true,false])test(`C1 legacy changed-source recovery ${enabled?'retains existing consent':'cannot queue work after policy pause'}`,async()=>{
 const f=await fixture();try{
  f.m.agentPolicy.saveAgentPolicy(f.session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:50000,maxQuantity:1,figmaClientIds:['client']});
  const root=f.root('c1-legacy','Mobile checkout alpha'),request=f.store.createRequest(f.ctx.runId,'figma',root.id,root.message);
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:root.id})).status,200);
  f.db.prepare("UPDATE agent_requests SET state='needs_clarification' WHERE id=?").run(request.id);f.remove(root.id);
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:root.id})).status,400);
  if(!enabled)f.m.agentPolicy.saveAgentPolicy(f.session,{enabled:false});
  const policy=f.m.agentPolicy.getAgentPolicy(f.ctx.runId),budget=f.db.prepare('SELECT * FROM ai_calls ORDER BY id').all(),calls=f.calls;
  f.comments=[{...root,message:'Mobile checkout bravo'}];assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:root.id})).status,200);
  assert.equal(f.store.requestById(request.id,f.ctx.runId).state,enabled?'queued':'needs_clarification');assert.deepEqual(f.m.agentPolicy.getAgentPolicy(f.ctx.runId),policy);
  assert.deepEqual(f.db.prepare('SELECT * FROM ai_calls ORDER BY id').all(),budget);assert.equal(f.calls,calls);assert.equal(f.count('SELECT count(*) n FROM connector_budget_reservations'),0);
 }finally{await f.close();}
});

for(const variant of ['long','replies','missing-root','missing-parent'])test(`T11a row 1 ${variant}: a manually assessed root without an inbox row is fenced and cannot reserve or draft`,async()=>{
 const f=await fixture();
 try{
  f.enable();
  f.root('m1','Gallery alpha screen');f.reply('m1r','m1','Banner bravo screen');f.root('peer','Carousel charlie screen');
  const selected=variant==='missing-parent'?'m1r':'m1';
  const assessed=await f.http('/api/assessments','POST',{commentId:selected});
  assert.equal(assessed.status,201,JSON.stringify(assessed.body));
  assert.equal(f.count("SELECT COUNT(*) n FROM agent_requests WHERE source_id='m1'"),0);
  assert.equal(f.count('SELECT COUNT(*) n FROM request_inbox'),0);
  const before=f.head('m1'),paid=f.calls;
  if(variant==='long')f.comment('m1').message='x'.repeat(4001);
  if(variant==='replies')for(let n=0;n<30;n++)f.reply('m1-extra-'+n,'m1','Extra reply '+n); // 32 messages
  if(variant==='missing-root')f.remove('m1','m1r');
  if(variant==='missing-parent')f.remove('m1');
  // A successful authoritative read observes the known source as missing or out of bounds.
  const observed=await f.http('/api/assessments','POST',{commentId:selected});
  assert.ok([400,409].includes(observed.status),JSON.stringify(observed));
  assert.equal(f.calls,paid);
  // A healthy peer refresh through the file path remains committed.
  await f.fileRefresh('peer');
  assert.equal(f.count("SELECT COUNT(*) n FROM agent_requests WHERE source='figma' AND source_id='peer'"),1);
  assert.ok(f.head('peer'));
  // New reservation and draft fail through HTTP and the domain service.
  const item=assessed.body.items[0];
  const drafted=await f.draft([item.id],'row1-'+variant,assessed.body.id);
  assert.equal(drafted.status,409,JSON.stringify(drafted.body));
  assert.match(drafted.body.error,UNAVAILABLE);
  assert.throws(()=>f.service.draftChangeOrder(f.ctx,{itemIds:[item.id],operationId:'row1-domain-'+variant}),UNAVAILABLE);
  assert.throws(()=>f.items.reserveProposalItems(f.ctx,[item.id],'row1-reserve-'+variant),UNAVAILABLE);
  assert.equal(f.count('SELECT COUNT(*) n FROM change_orders'),0);
  assert.equal(f.count('SELECT COUNT(*) n FROM proposal_item_reservations'),0);
  // The fence is durable and source-keyed; the old canonical head and history are unchanged.
  const fence=f.fence(before.id);
  assert.equal(fence?.state,'unavailable');
  assert.equal(fence.reason,isBounds(variant)?'source_bounds':'source_missing');
  assert.equal(fence.run_id,f.ctx.runId);
  assert.deepEqual(f.head('m1'),before);
  assert.equal(f.fence(f.head('peer').id),null);
  assert.equal(f.calls,paid);
 }finally{await f.close();}
});

for(const variant of ['bounds-file','missing-http'])test(`T11a row 2 ${variant}: eligible items, saved draft replay, submit and pending approvals fail before any new effect`,async()=>{
 const f=await fixture();
 try{
  f.enable();
  const credential=f.portalAccess();
  f.root('ta','Gallery alpha screen');f.reply('tar','ta','Banner bravo screen');f.root('tb','Carousel charlie screen');
  const a=await f.assessThread('ta'),b=await f.assessThread('tb');
  const [a1,a2]=a.assessment.items,[b1]=b.assessment.items;
  const d1=await f.draft([a1.id],'op-d1',a.assessment.id);assert.equal(d1.status,201,JSON.stringify(d1.body));
  const d2=await f.draft([b1.id],'op-d2',b.assessment.id);assert.equal(d2.status,201,JSON.stringify(d2.body));
  const submitted=await f.submit(d2.body.id),revision=submitted.order.revision;
  assert.equal((await f.http('/api/agent/requests/'+b.thread.id+'/publish','POST',{orderId:d2.body.id,revision,consent:true})).status,200);
  const client=await f.redeem(submitted.approvalUrl);
  const before=f.counts(),heads={ta:f.head('ta'),tb:f.head('tb')};
  if(variant==='bounds-file'){f.comment('ta').message='x'.repeat(4001);f.comment('tb').message='y'.repeat(4001);await f.fileRefresh('ta','tb');}
  else{f.remove('ta','tar','tb');for(const id of ['ta','tb'])assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:id})).status,400);}
  // New reservation of a still-eligible item.
  const fresh=await f.draft([a2.id],'op-new',a.assessment.id);
  assert.equal(fresh.status,409,JSON.stringify(fresh.body));
  // Saved draft-operation replay with identical terms.
  const replay=await f.draft([a1.id],'op-d1',a.assessment.id);
  assert.equal(replay.status,409,JSON.stringify(replay.body));
  assert.throws(()=>f.items.reserveProposalItems(f.ctx,[a1.id],'op-d1'),UNAVAILABLE);
  // Submit for client approval.
  assert.equal((await f.http('/api/change-orders/'+d1.body.id+'/submit','POST')).status,409);
  assert.throws(()=>f.orders.submitForApproval(d1.body.id),UNAVAILABLE);
  // Old pending scoped client session and portal approval.
  const scoped=await f.http('/api/change-orders/'+d2.body.id+'/approve','POST',{},client);
  assert.equal(scoped.status,409,JSON.stringify(scoped.body));
  const portal=await f.http('/api/portal/requests/'+b.thread.id+'/approve','POST',{revision,consent:true,orderId:d2.body.id},credential);
  assert.equal(portal.status,409,JSON.stringify(portal.body));
  await assert.rejects(f.portal.approvePortalQuote(f.portalSession(credential),b.thread.id,revision,true,d2.body.id),UNAVAILABLE);
  // Zero new effects: no approval, commitment, reservation, revision, invoice, provider, outbox or model work.
  assert.deepEqual(f.counts(),before);
  assert.equal(f.orders.getChangeOrder(d1.body.id).status,'draft');
  assert.equal(f.orders.getChangeOrder(d2.body.id).approvalStatus,'awaiting_client_approval');
  assert.deepEqual(f.reservations(d2.body.id),['reserved']);
  for(const id of ['ta','tb']){
   const fence=f.fence(heads[id].id);
   assert.equal(fence?.state,'unavailable',id);
   assert.equal(fence.reason,isBounds(variant)?'source_bounds':'source_missing');
   assert.deepEqual(f.head(id),heads[id]);
  }
  assert.ok(f.inbox.listRequestInbox(f.ctx).filter(t=>['ta','tb'].includes(t.rootId)).every(t=>t.availability==='unavailable'));
 }finally{await f.close();}
});

test('T11a row 3: exact review refs, a prepared T10 preview and cached inputs cannot bypass the fence after provider restoration',async()=>{
 const f=await fixture();
 try{
  f.enable();
  f.root('to','Receipt flow alpha');
  const o=await f.assessThread('to');
  const od=await f.draft([o.assessment.items[0].id],'row3-original',o.assessment.id);assert.equal(od.status,201);
  const os=await f.submit(od.body.id);
  f.orders.approveChangeOrder(od.body.id,{changeOrderId:od.body.id,changeOrderRevision:os.order.revision});
  f.root('tp','Receipt flow bravo');f.reply('tpr','tp','Receipt flow charlie');
  const p=await f.assessThread('tp'),[dup,priced]=p.assessment.items;
  const ref=dup.reviewReferences.find(r=>r.resourceId===od.body.id);
  assert.ok(ref,'the original approved receipt flow is a displayed duplicate reference');
  const preview=await f.actions.prepareReviewedAction(f.ctx,{kind:'post_clarification',requestId:p.thread.id,text:'Which receipt flow?',expected:f.displayed(p.thread.id)});
  const head=f.head('tp'),cached=f.cachedSource('tp'),saved=structuredClone(f.comments.filter(c=>['tp','tpr'].includes(c.id)));
  const prices=f.count('SELECT COUNT(*) n FROM designer_item_prices'),decisions=f.count('SELECT COUNT(*) n FROM duplicate_decisions');
  f.remove('tp','tpr');
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'tp'})).status,400);
  // The provider is restored, but no validated recovery read has happened yet.
  f.comments=[...f.comments,...saved];
  const before=f.counts();
  const price={unitAmountMinor:30000,quantity:1,description:priced.requestedDeliverable,reason:'Reviewed exact displayed terms',expected:priced.review};
  const httpPrice=await f.http('/api/request-items/'+priced.id+'/designer-price','POST',price);
  assert.equal(httpPrice.status,409,JSON.stringify(httpPrice.body));
  assert.throws(()=>f.items.setItemPrice(f.ctx,priced.id,price),UNAVAILABLE);
  const decision={decision:'distinct_work',reason:'A different receipt flow',commitmentId:ref.resourceId,commitmentRevision:ref.revision,expected:dup.review};
  const httpDecision=await f.http('/api/request-items/'+dup.id+'/duplicate-decision','POST',decision);
  assert.equal(httpDecision.status,409,JSON.stringify(httpDecision.body));
  assert.throws(()=>f.items.resolveDuplicate(f.ctx,dup.id,'distinct_work','A different receipt flow',ref.resourceId,ref.revision,dup.review),UNAVAILABLE);
  // Application confirmation of the prepared exact preview, and a new preparation.
  const confirmed=await f.http('/api/reviewed-actions/'+preview.id+'/confirm','POST',{previewHash:preview.previewHash,consent:true},undefined,{Origin:f.base});
  assert.equal(confirmed.status,409,JSON.stringify(confirmed.body));
  await assert.rejects(f.actions.confirmReviewedAction(f.ctx,preview.id,preview.previewHash),UNAVAILABLE);
  await assert.rejects(f.actions.prepareReviewedAction(f.ctx,{kind:'post_clarification',requestId:p.thread.id,text:'Which receipt flow?',expected:f.displayed(p.thread.id)}),UNAVAILABLE);
  // Generic capture, shared-work preparation and paid assessment from cached bytes fail closed.
  const input={project:f.project(),comment:cached.messages[0],replies:cached.messages.slice(1),itemized:true};
  assert.throws(()=>f.sources.captureRequestSource(f.ctx.runId,cached),UNAVAILABLE);
  assert.throws(()=>f.work.prepareAssessmentWork(f.ctx.runId,cached,input,()=>{}),UNAVAILABLE);
  await assert.rejects(async()=>f.work.runAssessmentWork(f.ctx.runId,cached,input,()=>{}),UNAVAILABLE);
  assert.deepEqual(f.counts(),before);
  assert.equal(f.writes,0);
  assert.equal(f.count('SELECT COUNT(*) n FROM designer_item_prices'),prices);
  assert.equal(f.count('SELECT COUNT(*) n FROM duplicate_decisions'),decisions);
  assert.equal(f.count('SELECT COUNT(*) n FROM assessment_attempts WHERE source_id=?',head.id),1);
  assert.equal(f.db.prepare('SELECT state FROM reviewed_actions WHERE id=?').get(preview.id).state,'prepared');
  assert.equal(f.fence(head.id)?.state,'unavailable');
  assert.deepEqual(f.head('tp'),head);
 }finally{await f.close();}
});

test('T11a row 4: diagnostic deletion, dismissal, job retry, restart and generic capture never restore authority',async()=>{
 const f=await fixture();
 try{
  f.enable();
  f.root('td','Gallery alpha screen');
  const d=await f.assessThread('td'),item=d.assessment.items[0],head=f.head('td'),paid=f.calls;
  f.comment('td').message='z'.repeat(4001);
  await f.fileRefresh('td');
  assert.ok(f.inbox.inboxRefreshDiagnostics(f.ctx).some(x=>x.commentId==='td'&&x.error_category==='source_bounds'));
  // Delete the UI diagnostic and dismiss the request.
  f.db.prepare("DELETE FROM agent_runtime WHERE key LIKE 'inbox-source-error:%'").run();
  assert.equal((await f.http('/api/agent/requests/'+d.thread.id+'/dismiss','POST',{})).status,200);
  // An arbitrary retry may schedule acquisition, but is not recovery itself.
  const job=f.db.prepare("SELECT id FROM jobs WHERE kind='figma_refresh' ORDER BY created_at DESC LIMIT 1").get();
  f.db.prepare("UPDATE jobs SET state='failed',error_category='synthetic_failure' WHERE id=?").run(job.id);
  assert.equal((await f.http('/api/inbox/jobs/'+job.id+'/retry','POST',{})).status,200);
  await f.jobs.runInboxJobs(new Date(),'figma_refresh');
  await f.fileRefresh('td');
  const drafted=await f.draft([item.id],'row4-after-cleanup',d.assessment.id);
  assert.equal(drafted.status,409,JSON.stringify(drafted.body));
  // Generic capture and shared-work cache reuse with the old stored bytes.
  const cached=f.cachedSource('td'),input={project:f.project(),comment:cached.messages[0],replies:[],itemized:true};
  assert.throws(()=>f.sources.captureRequestSource(f.ctx.runId,cached),UNAVAILABLE);
  await assert.rejects(async()=>f.work.runAssessmentWork(f.ctx.runId,cached,input,()=>{}),UNAVAILABLE);
  // A fresh process sees the same durable fence.
  const base=pathToFileURL(join(f.app.app,'dist/backend/')).href,J=JSON.stringify;
  const ref={id:head.id,version:head.version,contentHash:head.contentHash};
  const script=`globalThis.fetch=async()=>{throw new Error('No provider call is permitted after restart');};
const {db}=await import(${J(base+'db.js')});const context=await import(${J(base+'context.js')});
const items=await import(${J(base+'requestItems.js')});const sources=await import(${J(base+'requestSources.js')});
const ctx=context.contextFromSessionToken(${J(f.session.token)}),out={};
for(const [name,run] of Object.entries({reserve:()=>items.reserveProposalItems(ctx,[${J(item.id)}],'restart-op'),current:()=>sources.requireSourceCurrent(ctx.runId,${J(ref)}),capture:()=>sources.captureRequestSource(ctx.runId,${J(cached)})}))try{run();out[name]='allowed';}catch(error){out[name]=error.message;}
out.fence=db.prepare('SELECT state,reason FROM request_source_freshness WHERE source_id=?').get(${J(head.id)})??null;
out.reservations=db.prepare('SELECT COUNT(*) n FROM proposal_item_reservations').get().n;
console.log(JSON.stringify(out));db.close();`;
  const restarted=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:process.env,encoding:'utf8'}));
  for(const name of ['reserve','current','capture'])assert.match(restarted[name],UNAVAILABLE,name);
  assert.deepEqual({...restarted.fence},{state:'unavailable',reason:'source_bounds'});
  assert.equal(restarted.reservations,0);
  assert.equal(f.count('SELECT COUNT(*) n FROM proposal_item_reservations'),0);
  assert.equal(f.count('SELECT COUNT(*) n FROM approvals'),0);
  assert.equal(f.fence(head.id)?.state,'unavailable');
  assert.deepEqual(f.head('td'),head);
  assert.equal(f.calls,paid);
 }finally{await f.close();}
});

for(const start of ['available','latched'])test(`T11a row 5 ${start}: an older in-flight successful read cannot clear a newer unavailable observation`,async()=>{
 const f=await fixture();
 try{
  f.root('tr','Gallery alpha screen');
  const assessed=await f.http('/api/assessments','POST',{commentId:'tr'});assert.equal(assessed.status,201);
  const head=f.head('tr'),saved=structuredClone(f.comments);
  if(start==='latched'){f.remove('tr');assert.equal((await f.http('/api/assessments','POST',{commentId:'tr'})).status,400);f.comments=structuredClone(saved);}
  let release,entered;const gate=new Promise(r=>release=r),held=new Promise(r=>entered=r);
  f.readHook=async()=>{f.readHook=null;entered();await gate;};
  const older=f.http('/api/inbox/refresh','POST',{commentId:'tr'});
  await held;
  f.remove('tr');
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'tr'})).status,400);
  const generation=f.fence(head.id)?.generation;
  release();
  const completed=await older;
  assert.equal(completed.status,409,JSON.stringify(completed.body));
  const fence=f.fence(head.id);
  assert.equal(fence?.state,'unavailable');
  assert.equal(fence.generation,generation);
  assert.deepEqual(f.head('tr'),head);
  assert.equal(f.count("SELECT COUNT(*) n FROM agent_requests WHERE source_id='tr'"),0);
  assert.equal((await f.draft([assessed.body.items[0].id],'row5-'+start,assessed.body.id)).status,409);
  assert.equal(f.count('SELECT COUNT(*) n FROM proposal_item_reservations'),0);
 }finally{await f.close();}
});

for(const content of ['identical','changed'])test(`T11a row 6 ${content}: validated recovery writes exactly one version, old artifacts stay dead and the designer recovery path completes`,async()=>{
 const f=await fixture();
 const abandonFirst=content==='identical';
 try{
  f.enable(content==='changed');
  f.root('tx','Gallery alpha screen');
  const x=await f.assessThread('tx'),item=x.assessment.items[0];
  const d=await f.draft([item.id],'row6-original',x.assessment.id);assert.equal(d.status,201);
  const s=await f.submit(d.body.id),oldClient=await f.redeem(s.approvalUrl);
  const preview=await f.actions.prepareReviewedAction(f.ctx,{kind:'post_clarification',requestId:x.thread.id,text:'Which gallery?',expected:f.displayed(x.thread.id)});
  const head=f.head('tx'),paid=f.calls,saved=structuredClone(f.comments);
  const snapshots=()=>f.db.prepare('SELECT revision,snapshot_json FROM proposal_revisions WHERE change_order_id=? ORDER BY revision').all(d.body.id);
  const previewRow=()=>f.db.prepare('SELECT preview_json,preview_hash FROM reviewed_actions WHERE id=?').get(preview.id);
  const proposal=snapshots(),stored=previewRow();
  // Source loss.
  f.remove('tx');
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'tx'})).status,400);
  assert.equal(f.fence(head.id)?.state,'unavailable');
  const abandon=async()=>{
   const r=await f.http('/api/change-orders/'+d.body.id+'/abandon','POST',{reason:'The authoritative Figma thread became unavailable'});
   assert.equal(r.status,200,JSON.stringify(r.body));
   assert.deepEqual(f.reservations(d.body.id),['released']);
  };
  if(abandonFirst)await abandon();
  // Restoration followed by one validated authoritative recovery read.
  f.comments=structuredClone(saved);
  if(content==='changed')f.comment('tx').message='Gallery alpha screen with captions';
  if(content==='identical')assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'tx'})).status,200);
  else await f.fileRefresh('tx');
  const recovered=f.head('tx');
  assert.equal(recovered.id,head.id);
  assert.equal(recovered.version,head.version+1);
  assert.equal(recovered.versions,head.versions+1);
  if(content==='identical')assert.equal(recovered.contentHash,head.contentHash);else assert.notEqual(recovered.contentHash,head.contentHash);
  const fence=f.fence(head.id);
  assert.equal(fence.state,'available');
  assert.equal(fence.recovered_version,recovered.version);
  // A second healthy identical read does not churn versions.
  if(content==='identical')assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'tx'})).status,200);
  else await f.fileRefresh('tx');
  assert.deepEqual(f.head('tx'),recovered);
  // No automatic paid retry follows recovery, even with automatic assessment consent.
  await f.jobs.runInboxJobs(new Date(),'scope_assess');
  assert.equal(f.calls,paid);
  // Old review refs, reservations, pending links and T10 previews remain unusable.
  const oldPrice=await f.http('/api/request-items/'+item.id+'/designer-price','POST',{unitAmountMinor:30000,quantity:1,description:item.requestedDeliverable,reason:'Old displayed terms',expected:item.review});
  assert.equal(oldPrice.status,409,JSON.stringify(oldPrice.body));
  assert.equal((await f.draft([item.id],'row6-original',x.assessment.id)).status,409);
  assert.equal((await f.http('/api/change-orders/'+d.body.id+'/approve','POST',{},oldClient)).status,409);
  if(!abandonFirst){
   assert.deepEqual(f.reservations(d.body.id),['reserved']);
   assert.equal((await f.http('/api/change-orders/'+d.body.id+'/submit','POST')).status,409);
  }
  await assert.rejects(f.actions.confirmReviewedAction(f.ctx,preview.id,preview.previewHash),/changed/i);
  assert.equal(f.writes,0);
  if(!abandonFirst)await abandon();
  // Fresh assessment and review, a new proposal revision and fresh approval access.
  const assessed=await f.http('/api/agent/requests/'+x.thread.id+'/assess','POST',{});
  assert.equal(assessed.status,201,JSON.stringify(assessed.body));
  assert.equal(f.calls,paid+1);
  const freshItem=assessed.body.items[0];
  assert.equal(freshItem.review.sourceVersion,recovered.version);
  const d2=await f.draft([freshItem.id],'row6-fresh',assessed.body.id);
  assert.equal(d2.status,201,JSON.stringify(d2.body));
  assert.notEqual(d2.body.id,d.body.id);
  const s2=await f.submit(d2.body.id),newClient=await f.redeem(s2.approvalUrl);
  const approved=await f.http('/api/change-orders/'+d2.body.id+'/approve','POST',{},newClient);
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  assert.equal(approved.body.approvalStatus,'approved');
  assert.equal(f.provider.counts().creates,1);
  // The old link still fails; immutable proposal snapshots and previews are untouched.
  assert.equal((await f.http('/api/change-orders/'+d.body.id+'/approve','POST',{},oldClient)).status,409);
  assert.equal(f.count('SELECT COUNT(*) n FROM approvals WHERE change_order_id=?',d.body.id),0);
  assert.equal(f.orders.getChangeOrder(d.body.id).status,'cancelled');
  assert.deepEqual(snapshots(),proposal);
  assert.deepEqual(previewRow(),stored);
  assert.equal(f.writes,0);
 }finally{await f.close();}
});

test('T11a row 7: approved commitments, invoices, payment reconciliation and dispatched T10 reconciliation stay available while latched',async()=>{
 const f=await fixture();
 try{
  f.enable();
  const credential=f.portalAccess();
  f.root('ty','Gallery alpha screen');f.reply('tyr','ty','Banner bravo screen');
  const y=await f.assessThread('ty'),approvedOrders=[];
  // Both partial proposals are drafted, submitted and published before either approval changes the commitments.
  for(const [i,item] of y.assessment.items.entries()){
   const d=await f.draft([item.id],'row7-'+i,y.assessment.id);assert.equal(d.status,201,JSON.stringify(d.body));
   const s=await f.submit(d.body.id);
   assert.equal((await f.http('/api/agent/requests/'+y.thread.id+'/publish','POST',{orderId:d.body.id,revision:s.order.revision,consent:true})).status,200);
   approvedOrders.push({id:d.body.id,revision:s.order.revision,client:await f.redeem(s.approvalUrl)});
  }
  for(const order of approvedOrders){
   const approved=await f.http('/api/change-orders/'+order.id+'/approve','POST',{},order.client);
   assert.equal(approved.status,200,JSON.stringify(approved.body));assert.ok(approved.body.paypalInvoiceId);
   order.invoiceId=approved.body.paypalInvoiceId;
  }
  f.db.prepare('UPDATE approvals SET created_at=?').run(new Date(Date.now()-25*3600000).toISOString());
  // An already-dispatched cancellation whose read-back is still uncertain.
  const [kept,cancelled]=approvedOrders;
  const cancel=await f.actions.prepareReviewedAction(f.ctx,{kind:'cancel_invoice',requestId:y.thread.id,orderId:cancelled.id,revision:cancelled.revision,recipients:{sendToRecipient:true,sendToInvoicer:false,additionalRecipients:[]},expected:f.displayed(y.thread.id)});
  f.cancelApplies=false;
  assert.equal((await f.actions.confirmReviewedAction(f.ctx,cancel.id,cancel.previewHash)).state,'uncertain');
  assert.equal(f.writes,1);
  const ids=approvedOrders.map(o=>o.id),history=()=>({
   approvals:f.db.prepare(`SELECT id,change_order_id,change_order_revision FROM approvals WHERE change_order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids),
   terms:f.db.prepare(`SELECT change_order_id,approved_terms_json,paypal_invoice_id FROM invoice_operations WHERE change_order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY change_order_id`).all(...ids),
   orders:f.db.prepare(`SELECT id,revision,total_minor,line_items_json,paypal_invoice_id FROM change_orders WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids),
   revisions:f.db.prepare(`SELECT change_order_id,revision,snapshot_json FROM proposal_revisions WHERE change_order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY change_order_id`).all(...ids),
   reservations:f.db.prepare(`SELECT id,state FROM proposal_item_reservations WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids),
  });
  const before=history(),head=f.head('ty'),creates=f.provider.counts().creates;
  assert.ok(before.reservations.every(r=>r.state==='committed'));
  // Source loss.
  f.remove('ty','tyr');
  assert.equal((await f.http('/api/inbox/refresh','POST',{commentId:'ty'})).status,400);
  assert.equal(f.fence(head.id)?.state,'unavailable');
  // Read-only history and scope reads.
  const inbox=await f.http('/api/inbox');assert.equal(inbox.status,200);
  assert.equal(inbox.body.threads.find(t=>t.rootId==='ty').availability,'unavailable');
  assert.equal((await f.http('/api/change-orders')).status,200);
  assert.equal((await f.http('/api/assessments/'+y.assessment.id)).status,200);
  assert.equal((await f.http('/api/scope')).status,200);
  // Payment reconciliation.
  const invoice=f.provider.invoices.get(kept.invoiceId);
  invoice.status='PAID';invoice.due_amount.value='0.00';invoice.payments={paid_amount:{...invoice.amount},transactions:[{type:'PAYPAL',payment_id:'t11a-paid',amount:{...invoice.amount}}]};
  const settled=await f.http('/api/change-orders/'+kept.id+'/payment-status');
  assert.equal(settled.status,200,JSON.stringify(settled.body));
  assert.equal(settled.body.financialState.paymentState,'paid');
  // Reconciliation of the dispatched T10 cancellation, including its local financial projection.
  f.provider.invoices.get(cancelled.invoiceId).status='CANCELLED';
  const reconciled=await f.actions.confirmReviewedAction(f.ctx,cancel.id,cancel.previewHash);
  assert.equal(reconciled.state,'reconciled');
  assert.equal(reconciled.localProjection,'applied');
  assert.equal(f.orders.getChangeOrder(cancelled.id).financialState.invoiceState,'cancelled');
  assert.equal(f.writes,1);
  // Replay of already-approved commitments and invoices.
  const scopedReplay=await f.http('/api/change-orders/'+kept.id+'/approve','POST',{},kept.client);
  assert.equal(scopedReplay.status,200,JSON.stringify(scopedReplay.body));
  const portalReplay=await f.http('/api/portal/requests/'+y.thread.id+'/approve','POST',{revision:kept.revision,consent:true,orderId:kept.id},credential);
  assert.equal(portalReplay.status,200,JSON.stringify(portalReplay.body));
  assert.equal((await f.http('/api/change-orders/'+kept.id+'/invoice','POST')).status,200);
  assert.equal(f.provider.counts().creates,creates);
  // Approved work is never abandoned or released.
  assert.equal((await f.http('/api/change-orders/'+kept.id+'/abandon','POST',{reason:'Attempted release while unavailable'})).status,409);
  assert.deepEqual(history(),before);
  assert.equal(f.writes,1);
  assert.equal(f.fence(head.id)?.state,'unavailable');
  assert.deepEqual(f.head('ty'),head);
 }finally{await f.close();}
});
