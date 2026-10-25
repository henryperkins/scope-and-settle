import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {packetFixture,paddedDeliveryPng} from './evidence-packet-fixture.mjs';
import {outputFor,deliveryPng} from './delivery-fixture.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const sha256=sha;

test('T17 packet facts trace exact approved source, decisions, both delivery versions and per-invoice observations without provider effects',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function','T17 requires immutable factual evidence packets');
  const before=f.counts(),p=f.build();assert.equal(p.schemaVersion,1);assert.equal(p.orderId,f.order.id);assert.equal(p.facts.proposals[0].revision,2);assert.equal(p.facts.proposals[0].terms.totalMinor,25000);
  assert.equal(p.facts.sources[0].id,f.source.id);assert.equal(p.facts.sources[0].versions[0].sourceHash,f.source.content_hash);assert.equal(p.facts.sources[0].versions[0].messages[0].message,'Mobile checkout for the bounded packet fixture');
  assert.equal(p.facts.deliveries[0].snapshots.length,2);assert.equal(p.facts.deliveries[0].acceptances[0].snapshotHash,f.second.hash);assert.equal(p.facts.deliveries[0].acceptances[0].id,f.acceptance.id);assert.ok(p.facts.deliveries[0].events.some(e=>e.kind==='changes_requested'));
  assert.equal(p.facts.paymentSummary.netPaidMinor,10000);assert.equal(p.facts.paymentSummary.payableDueMinor,15000);assert.equal(p.facts.invoices.length,2);assert.ok(p.facts.invoices[0].observations.length>1);assert.deepEqual(f.counts(),before);
  const html=f.packets.evidencePacketFile(f.ctx,p.id,'packet.html');assert.match(html.text,/supplied|provided/i);assert.match(html.text,/client.supplied/i);assert.doesNotMatch(html.text,/<script[ >]/i);
  assert.match(html.text,/\$250\.00/);assert.match(html.text,/\$100\.00/);assert.match(html.text,/\$150\.00/);
  for(const name of ['packet.json','packet.html']){const file=f.packets.evidencePacketFile(f.ctx,p.id,name),entry=p.manifest.files.find(x=>x.name===name);assert.equal(sha(file.text),entry.sha256);assert.equal(Buffer.byteLength(file.text),entry.bytes);}
 }finally{await f.close();}
});

test('T17 designer packets and downloads deny client, another run/project and reset access',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');const p=f.build(),other=f.m.sessions.createSession({projectId:'demo',role:'designer',runId:'other-packet-run'}),ctx=f.m.context.contextFromSessionToken(other.token);
  assert.throws(()=>f.packets.buildEvidencePacket(f.client,f.order.id),e=>e.status===403);assert.throws(()=>f.packets.buildEvidencePacket(ctx,f.order.id),e=>[403,404].includes(e.status));assert.throws(()=>f.packets.getEvidencePacket(ctx,p.id),e=>e.status===404);
  assert.throws(()=>f.packets.getEvidencePacket({...f.ctx},p.id),e=>e.status===401);
  const wrong=f.m.sessions.createSession({projectId:'other-project',role:'designer',runId:f.ctx.runId});assert.throws(()=>f.packets.getEvidencePacket(f.m.context.contextFromSessionToken(wrong.token),p.id));
  f.orders.resetDemoRun(f.ctx.runId);assert.throws(()=>f.packets.evidencePacketFile(f.ctx,p.id,'packet.json'),e=>[401,404].includes(e.status));
 }finally{await f.close();}
});

test('T17 redaction removes pasted credentials/private URLs and provider internals while HTML escapes supplied text',async()=>{
 const f=await packetFixture({text:'Mobile checkout <script>alert(1)</script>'});try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');
  f.store.appendMessage(f.request,'client','Private https://www.sandbox.paypal.com/invoice/p/#secret-link and https://fixture.test/review#resume=pasted-renewal token '+f.session.token+' Bearer pasted-secret password=hunter-secret test-secret');
  f.store.createRequest(f.ctx.runId,'portal','unrelated-packet-request','UNRELATED PRIVATE REQUEST');
  f.db.prepare("UPDATE assessments SET result_json=json_set(result_json,'$.hiddenReasoning','PRIVATE CHAIN CANARY','$.prompt','PRIVATE PROMPT CANARY') WHERE id=?").run(f.order.assessmentId);
  const p=f.build(),json=f.packets.evidencePacketFile(f.ctx,p.id,'packet.json').text,html=f.packets.evidencePacketFile(f.ctx,p.id,'packet.html').text;
  for(const secret of ['secret-link','pasted-renewal',f.session.token,'pasted-secret','hunter-secret','test-secret','PRIVATE CHAIN CANARY','PRIVATE PROMPT CANARY','UNRELATED PRIVATE REQUEST','merchant@example.com','buyer@example.com']){assert.ok(!json.includes(secret),secret);assert.ok(!html.includes(secret),secret);}
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script[ >]/i);assert.ok(p.redaction.applied);assert.equal(p.disputeDraft.available,false);
 }finally{await f.close();}
});

test('T17 deleted current sources and interrupted historical restores are explicit gaps, never current-scope substitutions',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');f.db.prepare("UPDATE request_source_freshness SET state='unavailable',reason='source_missing' WHERE source_id=?").run(f.source.id);
  f.db.prepare('DROP TRIGGER immutable_request_versions_delete').run();f.db.prepare('DELETE FROM request_source_versions WHERE source_id=?').run(f.source.id);
  const p=f.build();assert.equal(p.facts.proposals[0].terms.totalMinor,25000);assert.equal(p.facts.sources[0].versions[0].available,false);assert.ok(p.gaps.some(g=>g.kind==='request_source_version_missing'));assert.equal(p.facts.deliveries[0].acceptances[0].snapshotHash,f.second.hash);
 }finally{await f.close();}
});

test('T17 a pasted standalone parent judging credential is redacted from the selected run',async()=>{
 const f=await packetFixture({judging:true});try{
  f.store.appendMessage(f.request,'client','Entry credential supplied without a label: '+f.rootCredential);
  const p=f.build();for(const name of ['packet.json','packet.html'])assert.ok(!f.packets.evidencePacketFile(f.ctx,p.id,name).text.includes(f.rootCredential),'parent judging credential must be omitted');
  assert.equal(p.facts.order.id,f.order.id);assert.equal(p.facts.sources[0].id,f.source.id);assert.ok(p.redaction.applied);
 }finally{await f.close();}
});

test('T17 a retained legacy request pointer remains visibly inferred when its explicit link is missing',async()=>{
 const f=await packetFixture();try{
  f.db.prepare('DELETE FROM request_order_links WHERE order_id=?').run(f.order.id);const p=f.build();assert.equal(p.facts.requests.length,1);assert.equal(p.facts.requests[0].id,f.request.id);assert.equal(p.facts.requests[0].linkProvenance,'legacy_primary_pointer_inferred');
 }finally{await f.close();}
});

test('T17 mismatched delivery hashes fail closed before a packet is stored',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');f.db.prepare('DROP TRIGGER immutable_delivery_snapshot').run();f.db.prepare("UPDATE delivery_snapshots SET snapshot_json=json_set(snapshot_json,'$.imageHash',?) WHERE id=?").run('0'.repeat(64),f.second.id);
  assert.throws(()=>f.build(),/hash|integrity|changed/i);assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n,0);
 }finally{await f.close();}
});

test('T17 restored metadata cannot promote a client-supplied snapshot into independently verified evidence',async()=>{
 const f=await packetFixture();try{
  f.db.prepare('DROP TRIGGER immutable_delivery_snapshot').run();f.db.prepare("UPDATE delivery_snapshots SET snapshot_json=json_set(snapshot_json,'$.pixelProvenance','independently_verified') WHERE id=?").run(f.second.id);
  assert.throws(()=>f.build(),/provenance|integrity|snapshot/i);assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n,0);
 }finally{await f.close();}
});

test('T17 a restored source reference into another run is rejected rather than exported as a missing local source',async()=>{
 const f=await packetFixture();try{
  const foreign=f.sources.captureRequestSource('other-packet-run',{source:'portal',fileKey:'',rootId:'foreign-root',messages:[{id:'foreign',message:'UNRELATED FOREIGN SOURCE'}]});
  const triggers=f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='request_item_results' AND sql LIKE '%BEFORE UPDATE%'").all();for(const t of triggers)f.db.exec('DROP TRIGGER "'+t.name+'"');
  f.db.prepare('UPDATE request_item_results SET source_id=? WHERE assessment_id=?').run(foreign.id,f.order.assessmentId);assert.throws(()=>f.build(),/scope|association/i);assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n,0);
 }finally{await f.close();}
});

test('T17 external payment/refund observations remain unverified and never become app-processed settlements',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');const balance=f.order.installments[1],invoice=f.provider.invoices.get(balance.paypalInvoiceId);invoice.status='REFUNDED_EXTERNAL';invoice.due_amount.value='0.00';invoice.payments={paid_amount:invoice.amount,transactions:[{type:'EXTERNAL',payment_id:'external-payment',amount:invoice.amount}]};invoice.refunds={refund_amount:invoice.amount,transactions:[{type:'EXTERNAL',refund_id:'external-refund',amount:invoice.amount}]};await f.milestones.refreshInvoiceRecord(balance.invoiceRecordId);
  const p=f.build(),latest=p.facts.invoices.find(i=>i.invoiceRecordId===balance.invoiceRecordId).observations.at(-1);assert.equal(latest.rawStatus,'REFUNDED_EXTERNAL');assert.equal(latest.settlementProvenance,'external_or_unverified');assert.equal(latest.applicationProcessedPayment,false);assert.equal(p.facts.paymentSummary.netPaidMinor,null);assert.ok(p.facts.deliveries[0].acceptances.length);
 }finally{await f.close();}
});

test('T17 stored packet downloads detect incomplete restore and require authenticated HTTP without token URLs',async()=>{
 const f=await packetFixture();try{
  assert.equal(typeof f.packets.buildEvidencePacket,'function');const p=f.build(),path='/api/evidence-packets/'+p.id+'/files/packet.json';
  assert.equal((await f.http(path,'GET',undefined,null)).status,401);assert.equal((await f.http(path,'GET',undefined,f.clientToken)).status,403);const file=await f.http(path);assert.equal(file.status,200);assert.equal(file.body.orderId,f.order.id);
  f.db.prepare('DROP TRIGGER immutable_evidence_packet').run();f.db.prepare("UPDATE evidence_packets SET html_text='' WHERE id=?").run(p.id);assert.throws(()=>f.packets.evidencePacketFile(f.ctx,p.id,'packet.html'),/integrity|incomplete|changed/i);
 }finally{await f.close();}
});

test('C4 default export remains schemaVersion 1 metadata-only while reviewed selection creates schemaVersion 2 immutable PNG attachments',async()=>{
 const f=await packetFixture();try{
  const before=f.counts(),defaultPacket=f.build();
  assert.equal(defaultPacket.schemaVersion,1);assert.equal(defaultPacket.manifest.files.length,2);
  assert.ok(!f.packets.evidencePacketFile(f.ctx,defaultPacket.id,'packet.html').text.includes('data:image/png;base64,'));
  assert.equal(defaultPacket.facts.deliveries[0].snapshots.every(s=>s.pixelsIncluded===false),true);
  assert.equal(typeof f.packets.listEvidenceImageChoices,'function','C4 requires listEvidenceImageChoices');
  const choices=f.packets.listEvidenceImageChoices(f.ctx,f.order.id);
  assert.equal(choices.orderRevision,f.order.revision);assert.equal(choices.choices.length,1);
  const selectedSnapshot=choices.choices[0];
  assert.equal(selectedSnapshot.reviewId,f.review.id);assert.equal(selectedSnapshot.reviewRevision,f.review.revision);
  assert.equal(selectedSnapshot.snapshotId,f.second.id);assert.equal(selectedSnapshot.snapshotHash,f.second.hash);
  assert.equal(selectedSnapshot.imageHash,f.second.imageHash);assert.equal(selectedSnapshot.imageState,'available');
  assert.equal(selectedSnapshot.accepted,true);assert.equal(selectedSnapshot.previewPath,'/api/delivery-snapshots/'+f.second.id);
  const httpChoices=await f.http('/api/change-orders/'+f.order.id+'/evidence-packets/image-choices');
  assert.equal(httpChoices.status,200);assert.equal(httpChoices.body.choices.length,1);
  assert.equal((await f.http('/api/change-orders/'+f.order.id+'/evidence-packets/image-choices','GET',undefined,f.clientToken)).status,403);
  const imagePacket=f.build({expectedRevision:f.order.revision,images:[{reviewId:f.review.id,reviewRevision:f.review.revision,snapshotId:f.second.id,snapshotHash:f.second.hash}],imagesReviewed:true});
  assert.equal(defaultPacket.schemaVersion,1);
  assert.equal(imagePacket.schemaVersion,2);
  const pngName='image-'+selectedSnapshot.imageHash+'.png';
  const pngManifestEntry=imagePacket.manifest.files.find(e=>e.name===pngName);
  assert.ok(pngManifestEntry,'PNG manifest entry must exist');
  const file=f.packets.evidencePacketFile(f.ctx,imagePacket.id,pngName);
  assert.ok(file.body instanceof Uint8Array);
  const downloadedPng=file.body;
  assert.equal(sha256(downloadedPng),selectedSnapshot.imageHash);
  assert.equal(pngManifestEntry.bytes,downloadedPng.byteLength);
  const htmlFile=f.packets.evidencePacketFile(f.ctx,imagePacket.id,'packet.html');
  assert.equal(typeof htmlFile.text,'string');assert.equal(htmlFile.body,htmlFile.text);
  assert.match(htmlFile.text,/img-src data:/);assert.match(htmlFile.text,/data:image\/png;base64,/);
  assert.match(htmlFile.text,/Accepted delivery/);assert.match(htmlFile.text,/not automatically redacted/i);
  assert.equal(imagePacket.attachedImages[0].independentVerification,false);
  assert.equal(imagePacket.attachedImages[0].automaticRedactionApplied,false);
  assert.equal(imagePacket.facts.deliveries[0].snapshots.find(s=>s.id===f.second.id).pixelsIncluded,true);
  assert.equal(imagePacket.facts.deliveries[0].snapshots.find(s=>s.id===f.first.id).pixelsIncluded,false);
  f.db.prepare("UPDATE request_source_freshness SET state='unavailable',reason='source_missing' WHERE source_id=?").run(f.source.id);
  f.db.prepare('DROP TRIGGER immutable_delivery_snapshot').run();f.db.prepare("UPDATE delivery_snapshots SET png=X'' WHERE id=?").run(f.second.id);
  const readBack=f.packets.evidencePacketFile(f.ctx,imagePacket.id,pngName);
  assert.equal(sha256(readBack.body),selectedSnapshot.imageHash);
  assert.equal(f.packets.getEvidencePacket(f.ctx,imagePacket.id).schemaVersion,2);
  assert.deepEqual(f.counts(),before);
 }finally{await f.close();}
});

test('C4 unaccepted submitted delivery review is never labeled accepted and identical PNG bytes across two milestones deduplicate file storage while retaining both snapshot bindings',async()=>{
 const f=await packetFixture();try{
  const thirdMilestoneId='m-3-second-delivery';
  const schedule={milestones:[
   {id:'m-1',title:'Deposit',amountMinor:10000,dueTrigger:'proposal_approval',acceptanceCriteria:['Approve scope']},
   {id:'m-2',title:'Primary delivery',amountMinor:7500,dueTrigger:'delivery_acceptance',acceptanceCriteria:['Deliver primary screen']},
   {id:thirdMilestoneId,title:'Secondary delivery',amountMinor:7500,dueTrigger:'delivery_acceptance',acceptanceCriteria:['Deliver secondary screen']},
  ],workStartPaymentMilestoneIds:['m-1']};
  const make=await (await import('./helpers.mjs')).canonicalDraftFactory(f.app);
  let order2=f.service.draftChangeOrder(f.ctx,make(f.ctx,{requestedDeliverable:'Two-milestone delivery export fixture'}));
  order2=f.milestones.setMilestoneSchedule(f.ctx,order2.id,order2.revision,schedule);
  const submitted2=await f.submit(order2.id),clientTok=await f.redeem(submitted2.approvalUrl),clientCtx=f.m.context.contextFromSessionToken(clientTok);
  order2=await f.service.approveScopedOrder(clientCtx,order2.id);
  f.markPaid(order2.installments[0].paypalInvoiceId);
  const runA=await f.delivery.startApprovedWork(f.ctx,order2.installments[1].id);
  const runB=await f.delivery.startApprovedWork(f.ctx,order2.installments[2].id);
  const sharedPng=deliveryPng(42);
  const snapA=f.delivery.recordDeliveryOutput(f.ctx,runA.id,outputFor(runA,{imageDataUrl:sharedPng}));
  const snapB=f.delivery.recordDeliveryOutput(f.ctx,runB.id,outputFor(runB,{imageDataUrl:sharedPng}));
  const revA=f.delivery.submitDelivery(f.ctx,runA.milestoneId,snapA.id);
  const revB=f.delivery.submitDelivery(f.ctx,runB.milestoneId,snapB.id);
  const linkA=f.delivery.issueDeliveryAccess(f.ctx,revA.id),tokA=await f.redeem(linkA.deliveryUrl);
  await f.delivery.acceptDelivery(f.m.context.contextFromSessionToken(tokA),revA.id,revA.revision);
  const choices=f.packets.listEvidenceImageChoices(f.ctx,order2.id);
  assert.equal(choices.choices.length,2);
  const choiceA=choices.choices.find(c=>c.reviewId===revA.id),choiceB=choices.choices.find(c=>c.reviewId===revB.id);
  assert.equal(choiceA.accepted,true);assert.equal(choiceB.accepted,false);assert.equal(choiceB.state,'in_review');
  const pkt=f.packets.buildEvidencePacket(f.ctx,order2.id,{expectedRevision:order2.revision,images:[
   {reviewId:revA.id,reviewRevision:revA.revision,snapshotId:snapA.id,snapshotHash:snapA.hash},
   {reviewId:revB.id,reviewRevision:revB.revision,snapshotId:snapB.id,snapshotHash:snapB.hash},
  ],imagesReviewed:true});
  assert.equal(pkt.schemaVersion,2);
  assert.equal(pkt.attachedImages.length,2);
  assert.equal(pkt.attachedImages.find(x=>x.reviewId===revA.id).accepted,true);
  assert.equal(pkt.attachedImages.find(x=>x.reviewId===revB.id).accepted,false);
  const pngEntries=pkt.manifest.files.filter(e=>e.mediaType==='image/png');
  assert.equal(pngEntries.length,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packet_files WHERE packet_id=?').get(pkt.id).n,1);
  const html=f.packets.evidencePacketFile(f.ctx,pkt.id,'packet.html').text;
  assert.match(html,/Unaccepted draft/);assert.doesNotMatch(html,/Secondary delivery[^<]*Accepted delivery/);
 }finally{await f.close();}
});

test('C4 image packet build rejects invalid selections, stale/replaced reviews, wrong run/order, revoked actor, missing/changed bytes, five selections, PNG above 1.5 MB and aggregate above 16 MiB without storing partial rows',async()=>{
 const f=await packetFixture();try{
  const validSel={reviewId:f.review.id,reviewRevision:f.review.revision,snapshotId:f.second.id,snapshotHash:f.second.hash};
  const countPackets=()=>f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n;
  const countFiles=()=>f.db.prepare('SELECT count(*) n FROM evidence_packet_files').get().n;
  const packetRowsBefore=countPackets(),fileRowsBefore=countFiles();
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel],imagesReviewed:false}),e=>e.status===400);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel]}),e=>e.status===400);
  assert.throws(()=>f.build({expectedRevision:f.order.revision+1,images:[validSel],imagesReviewed:true}),e=>e.status===409);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[],imagesReviewed:true}),e=>e.status===400);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel,validSel],imagesReviewed:true}),e=>[400,409].includes(e.status));
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[{reviewId:f.firstReview.id,reviewRevision:f.firstReview.revision,snapshotId:f.first.id,snapshotHash:f.first.hash}],imagesReviewed:true}),e=>e.status===409);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[{...validSel,reviewRevision:99}],imagesReviewed:true}),e=>e.status===409);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[{...validSel,snapshotHash:'f'.repeat(64)}],imagesReviewed:true}),e=>e.status===409);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel,{...validSel,reviewId:'r2',snapshotId:'s2'},{...validSel,reviewId:'r3',snapshotId:'s3'},{...validSel,reviewId:'r4',snapshotId:'s4'},{...validSel,reviewId:'r5',snapshotId:'s5'}],imagesReviewed:true}),e=>[400,409].includes(e.status));
  const otherSession=f.m.sessions.createSession({projectId:'demo',role:'designer',runId:'other-c4-run'}),otherCtx=f.m.context.contextFromSessionToken(otherSession.token);
  assert.throws(()=>f.packets.buildEvidencePacket(otherCtx,f.order.id,{expectedRevision:f.order.revision,images:[validSel],imagesReviewed:true}),e=>[403,404].includes(e.status));
  const tempDesigner=f.m.sessions.createSession({projectId:'demo',role:'designer',runId:f.ctx.runId}),tempCtx=f.m.context.contextFromSessionToken(tempDesigner.token);
  f.m.sessions.revokeSession(tempDesigner.token);
  assert.throws(()=>f.packets.buildEvidencePacket(tempCtx,f.order.id,{expectedRevision:f.order.revision,images:[validSel],imagesReviewed:true}),e=>e.status===401);
  f.db.prepare('DROP TRIGGER immutable_delivery_snapshot').run();
  const originalPng=f.db.prepare('SELECT png FROM delivery_snapshots WHERE id=?').get(f.second.id).png;
  const originalJson=f.db.prepare('SELECT snapshot_json,hash FROM delivery_snapshots WHERE id=?').get(f.second.id);
  f.db.prepare("UPDATE delivery_snapshots SET snapshot_json=json_set(snapshot_json,'$.id','wrong-restored-snapshot') WHERE id=?").run(f.second.id);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel],imagesReviewed:true}),/snapshot|integrity/i);
  assert.throws(()=>f.packets.listEvidenceImageChoices(f.ctx,f.order.id),/snapshot|integrity/i);
  f.db.prepare('UPDATE delivery_snapshots SET snapshot_json=? WHERE id=?').run(originalJson.snapshot_json,f.second.id);
  f.db.prepare("UPDATE delivery_snapshots SET png=X'' WHERE id=?").run(f.second.id);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel],imagesReviewed:true}),e=>e.status===409);
  const corruptPng=Buffer.from(originalPng);corruptPng[corruptPng.length-1]^=1;
  f.db.prepare('UPDATE delivery_snapshots SET png=? WHERE id=?').run(corruptPng,f.second.id);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[validSel],imagesReviewed:true}),e=>e.status===409);
  const overSingle=paddedDeliveryPng(1_500_001,7).bytes;
  const overSingleHash=sha256(overSingle);
  const sParsed=JSON.parse(originalJson.snapshot_json);
  const {contentHash}=await f.app.load('scopePersistence');
  const overSnapHash=contentHash({operationId:f.run.operationId,fileKey:sParsed.fileKey,pageId:sParsed.pageId,areaId:sParsed.areaId,nodes:sParsed.nodes,imageHash:overSingleHash});
  f.db.prepare('DROP TRIGGER immutable_delivery_review').run();
  f.db.prepare('DROP TRIGGER immutable_delivery_acceptance').run();
  f.db.prepare('UPDATE delivery_snapshots SET png=?,hash=?,snapshot_json=? WHERE id=?').run(overSingle,overSnapHash,JSON.stringify({...sParsed,hash:overSnapHash,imageHash:overSingleHash}),f.second.id);
  f.db.prepare('UPDATE delivery_reviews SET snapshot_hash=? WHERE id=?').run(overSnapHash,f.review.id);
  f.db.prepare('UPDATE delivery_acceptances SET snapshot_hash=? WHERE id=?').run(overSnapHash,f.acceptance.id);
  assert.throws(()=>f.build({expectedRevision:f.order.revision,images:[{...validSel,snapshotHash:overSnapHash}],imagesReviewed:true}),/1,500,000|1\.5 MB|limit|size/i);
  f.db.prepare('UPDATE delivery_snapshots SET png=?,hash=?,snapshot_json=? WHERE id=?').run(originalPng,originalJson.hash,originalJson.snapshot_json,f.second.id);
  f.db.prepare('UPDATE delivery_reviews SET snapshot_hash=? WHERE id=?').run(originalJson.hash,f.review.id);
  f.db.prepare('UPDATE delivery_acceptances SET snapshot_hash=? WHERE id=?').run(originalJson.hash,f.acceptance.id);
  const packetRowsAfterRefusedBuild=countPackets();
  assert.equal(packetRowsAfterRefusedBuild,packetRowsBefore);
  assert.equal(countFiles(),fileRowsBefore);
 }finally{await f.close();}
});

test('C4 aggregate image packet representation above 16,777,216 bytes refuses without partial rows while metadata-only under 4 MB still succeeds',async()=>{
 const f=await packetFixture();try{
  const make=await (await import('./helpers.mjs')).canonicalDraftFactory(f.app);
  let order4=f.service.draftChangeOrder(f.ctx,make(f.ctx,{requestedDeliverable:'Four-image aggregate cap fixture'}));
  const schedule={milestones:[
   {id:'m-dep',title:'Deposit',amountMinor:5000,dueTrigger:'proposal_approval',acceptanceCriteria:['Approve']},
   {id:'m-d1',title:'Deliverable 1',amountMinor:5000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['D1']},
   {id:'m-d2',title:'Deliverable 2',amountMinor:5000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['D2']},
   {id:'m-d3',title:'Deliverable 3',amountMinor:5000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['D3']},
   {id:'m-d4',title:'Deliverable 4',amountMinor:5000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['D4']},
  ],workStartPaymentMilestoneIds:['m-dep']};
  order4=f.milestones.setMilestoneSchedule(f.ctx,order4.id,order4.revision,schedule);
  const submitted4=await f.submit(order4.id),tok=await f.redeem(submitted4.approvalUrl);
  order4=await f.service.approveScopedOrder(f.m.context.contextFromSessionToken(tok),order4.id);
  const src=f.db.prepare('SELECT s.* FROM proposal_item_reservations r JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id JOIN request_sources s ON s.id=i.source_id WHERE r.order_id=?').get(order4.id);
  const req4=f.store.createRequest(f.ctx.runId,'portal',src.root_id,'Aggregate bound test');
  const links=await f.app.load('requestLinks');links.recordPublishedOrder(req4,order4.id,order4.revision);
  for(let i=0;i<4;i++)f.store.appendMessage(req4,'client','word '.repeat(84_000));
  f.markPaid(order4.installments[0].paypalInvoiceId);
  const selections=[];
  for(let i=1;i<=4;i++){
   const run=await f.delivery.startApprovedWork(f.ctx,order4.installments[i].id);
   const bigPng=paddedDeliveryPng(1_450_000,i+10);
   const snap=f.delivery.recordDeliveryOutput(f.ctx,run.id,outputFor(run,{imageDataUrl:bigPng.dataUrl}));
   const rev=f.delivery.submitDelivery(f.ctx,run.milestoneId,snap.id);
   selections.push({reviewId:rev.id,reviewRevision:rev.revision,snapshotId:snap.id,snapshotHash:snap.hash});
  }
  const beforePackets=f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n;
  const beforeFiles=f.db.prepare('SELECT count(*) n FROM evidence_packet_files').get().n;
  assert.throws(()=>f.packets.buildEvidencePacket(f.ctx,order4.id,{expectedRevision:order4.revision,images:selections,imagesReviewed:true}),/16,777,216|16 MiB|exceeds|bounded export size/i);
  assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n,beforePackets);
  assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packet_files').get().n,beforeFiles);
  const metadataOnly=f.packets.buildEvidencePacket(f.ctx,order4.id);
  assert.equal(metadataOnly.schemaVersion,1);
 }finally{await f.close();}
});

test('C4 tampering with any stored PNG attachment or manifest digest refuses download and old v1 packets remain readable',async()=>{
 const f=await packetFixture();try{
  const v1=f.build();
  const v2=f.build({expectedRevision:f.order.revision,images:[{reviewId:f.review.id,reviewRevision:f.review.revision,snapshotId:f.second.id,snapshotHash:f.second.hash}],imagesReviewed:true});
  const pngName='image-'+f.second.imageHash+'.png';
  assert.equal((await f.http('/api/evidence-packets/'+v1.id+'/files/'+pngName)).status,404);
  assert.equal((await f.http('/api/evidence-packets/'+v2.id+'/files/image-not-a-sha256.png')).status,404);
  const okPng=await f.http('/api/evidence-packets/'+v2.id+'/files/'+pngName);
  assert.equal(okPng.status,200);
  f.db.prepare('DROP TRIGGER immutable_evidence_packet_file').run();
  const row=f.db.prepare('SELECT bytes FROM evidence_packet_files WHERE packet_id=? AND name=?').get(v2.id,pngName);
  const tampered=Buffer.from(row.bytes);tampered[tampered.length-1]^=1;
  f.db.prepare('UPDATE evidence_packet_files SET bytes=? WHERE packet_id=? AND name=?').run(tampered,v2.id,pngName);
  assert.throws(()=>f.packets.evidencePacketFile(f.ctx,v2.id,pngName),/integrity|incomplete|changed/i);
  assert.throws(()=>f.packets.evidencePacketFile(f.ctx,v2.id,'packet.json'),/integrity|incomplete|changed/i);
  assert.throws(()=>f.packets.getEvidencePacket(f.ctx,v2.id),/integrity|incomplete|changed/i);
  assert.equal(f.packets.getEvidencePacket(f.ctx,v1.id).schemaVersion,1);
 }finally{await f.close();}
});

test('C4 complete export cap counts the exact formatted manifest download bytes',async()=>{
 const f=await packetFixture();try{
  f.store.appendMessage(f.request,'client','word ');
  const message=f.db.prepare('SELECT id FROM agent_messages WHERE request_id=? ORDER BY rowid DESC LIMIT 1').get(f.request.id);
  const options={expectedRevision:f.order.revision,images:[{reviewId:f.review.id,reviewRevision:f.review.revision,snapshotId:f.second.id,snapshotHash:f.second.hash}],imagesReviewed:true};
  const sample=f.build(options);
  const files=[...sample.manifest.files.map(entry=>entry.name),'manifest.json'];
  const total=files.reduce((sum,name)=>sum+Buffer.byteLength(f.packets.evidencePacketFile(f.ctx,sample.id,name).body),0);
  // Each five-byte statement is present once in JSON and once in escaped HTML.
  // Place the actual downloadable representation just beyond the fixed ceiling.
  const copies=1+Math.floor((16_777_216-total)/10)+1;
  f.db.prepare('UPDATE agent_messages SET body=? WHERE id=?').run('word '.repeat(copies),message.id);
  const before=f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n;
  assert.throws(()=>f.build(options),/16,777,216|16 MiB|bounded export size/i);
  assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_packets').get().n,before);
 }finally{await f.close();}
});

test('C4 changed manifest digests refuse every packet read',async()=>{
 const f=await packetFixture();try{
  const packet=f.build({expectedRevision:f.order.revision,images:[{reviewId:f.review.id,reviewRevision:f.review.revision,snapshotId:f.second.id,snapshotHash:f.second.hash}],imagesReviewed:true});
  const manifest=structuredClone(packet.manifest);manifest.files[0].sha256='0'.repeat(64);
  f.db.exec('DROP TRIGGER immutable_evidence_packet');
  f.db.prepare('UPDATE evidence_packets SET manifest_json=? WHERE id=?').run(JSON.stringify(manifest),packet.id);
  for(const name of ['packet.json','packet.html','manifest.json',...packet.manifest.files.filter(e=>e.mediaType==='image/png').map(e=>e.name)])assert.throws(()=>f.packets.evidencePacketFile(f.ctx,packet.id,name),/integrity|changed/i);
 }finally{await f.close();}
});
