import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {packetFixture} from './evidence-packet-fixture.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');

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
