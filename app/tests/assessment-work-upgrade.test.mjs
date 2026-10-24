import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './source-freshness-fixture.mjs';
import {isolatedApp} from './helpers.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

function work(f, message='Add mobile checkout') {
 const source={source:'portal',fileKey:'',rootId:'upgrade',messages:[{id:'upgrade',message}]};
 const input={project:f.project(),comment:source.messages[0],replies:[],itemized:true};
 const guard=()=>f.m.context.requireDesignerContext(f.ctx);
 return {source,input,guard,ref:f.work.prepareAssessmentWork(f.ctx.runId,source,input,guard)};
}
const oldFingerprint='e'.repeat(64);

test('C1 a real implementation upgrade preserves the logical key and original unresolved attempt',async()=>{
 const f=await fixture({listen:false});let closed=false,nextDb,dispatches=0;
 try {
  const w=work(f),runId=f.ctx.runId,dataDir=f.m.env.DATA_DIR;
  const infer=async(_i,_r,_a,h)=>{h.dispatched();dispatches++;throw new TypeError('lost response');};
  await assert.rejects(f.work.executeAssessmentWork(runId,w.ref,w.source,w.input,w.guard,infer));
  const before=f.db.prepare('SELECT * FROM assessment_attempts').all();
  await f.close();closed=true;
  const app=await isolatedApp();process.env.SCOPE_SETTLE_DATA_DIR=dataDir;
  const file=join(app.app,'dist/backend/assessment.js'),bytes=await readFile(file,'utf8');
  await writeFile(file,bytes.replace('export async function assess(input, runId = currentRunId(), assertAuthorized, hooks) {','export async function assess(input, runId = currentRunId(), assertAuthorized, hooks) {\nvoid "synthetic implementation upgrade";'));
  const next=await app.load('assessmentWork');({db:nextDb}=await app.load('db'));
  const ref=next.prepareAssessmentWork(runId,w.source,w.input,()=>{});
  assert.notEqual(ref.fingerprint,w.ref.fingerprint);assert.equal(ref.logicalKey,w.ref.logicalKey);
  await assert.rejects(next.executeAssessmentWork(runId,ref,w.source,w.input,()=>{},infer),e=>e.status===409);
  assert.equal(dispatches,1);assert.deepEqual(nextDb.prepare('SELECT * FROM assessment_attempts').all(),before);
 } finally {if(!closed)await f.close();nextDb?.close();}
});

test('C1 logical work blocks unresolved attempts from a different implementation without another dispatch',async()=>{
 for(const outcome of ['prepared','dispatched','uncertain','rejected']) {
  const f=await fixture({listen:false});let dispatches=0;
  try {
   const w=work(f),infer=async(_i,_r,_a,h)=>{h.dispatched();dispatches++;throw new TypeError('lost response');};
   await assert.rejects(f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard,infer));
   f.db.prepare('UPDATE assessment_attempts SET fingerprint=?,outcome=?').run(oldFingerprint,outcome);
   const before=f.db.prepare('SELECT * FROM ai_calls').all();
   await assert.rejects(f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard,infer),e=>e.status===409);
   assert.equal(dispatches,1,outcome);assert.deepEqual(f.db.prepare('SELECT * FROM ai_calls').all(),before);
   assert.match(w.ref.logicalKey,/^[a-f0-9]{64}$/);
   const changed=work(f,'Add an invoice receipt');assert.notEqual(changed.ref.logicalKey,w.ref.logicalKey);
  } finally {await f.close();}
 }
});

test('C1 legacy uncertainty keeps null logical metadata and original accounting while requiring review',async()=>{
 const f=await fixture({listen:false});try {
  const w=work(f),at=new Date().toISOString();
  f.db.prepare("INSERT INTO ai_calls(id,reserved_micro_usd,created_at) VALUES('legacy-call',1200,?)").run(at);
  f.db.prepare("INSERT INTO assessment_attempts(id,project_id,run_id,fingerprint,source_id,source_version,outcome,call_id,created_at,updated_at) VALUES('legacy','demo',?,?,?,?, 'uncertain','legacy-call',?,?)")
   .run(f.ctx.runId,oldFingerprint,w.ref.source.id,w.ref.source.version,at,at);
  const before=f.db.prepare('SELECT * FROM ai_calls').all();
  await assert.rejects(f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard),e=>e.status===409);
  assert.equal(f.calls,0);assert.deepEqual(f.db.prepare('SELECT * FROM ai_calls').all(),before);
  assert.equal(f.db.prepare("SELECT logical_key FROM assessment_attempts WHERE id='legacy'").get().logical_key,null);
 } finally {await f.close();}
});

test('C1 exact runtime success cache is isolated and known-zero participant attempts remain nonblocking',async()=>{
 const f=await fixture({listen:false});try {
  const w=work(f),audit=[];let count=0;
  const participant={reserve(id){count++;audit.push(['reserve',id]);},linkCall(){},settle(id,n){audit.push(['settle',id,n]);}};
  await assert.rejects(f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard,async()=>{throw new Error('before dispatch');},null,participant));
  const zero=f.db.prepare('SELECT * FROM assessment_attempts').get();assert.equal(zero.outcome,'not_dispatched');
  f.db.prepare('UPDATE assessment_attempts SET fingerprint=? WHERE id=?').run(oldFingerprint,zero.id);
  const a=await f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard,undefined,null,participant);
  const b=await f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard);
  assert.equal(a.id,b.id);assert.equal(f.calls,1);assert.equal(count,2);
  assert.equal(f.db.prepare('SELECT outcome FROM assessment_attempts WHERE id=?').get(zero.id).outcome,'not_dispatched');
  assert.ok(audit.some(row=>row[0]==='settle'&&row[1]===zero.id&&row[2]===0));
  f.db.prepare('UPDATE assessment_attempts SET fingerprint=? WHERE id=?').run('f'.repeat(64),a.attempt.id);
  await f.work.executeAssessmentWork(f.ctx.runId,w.ref,w.source,w.input,w.guard);
  assert.equal(f.calls,2,'A different full runtime success is not a cache hit');
 } finally {await f.close();}
});

test('C1 automatic v2 jobs validate and dispatch once; exact legacy requeue preserves immutable payload',async()=>{
 for(const legacy of [false,true]) {
  const f=await fixture({listen:false});try {
   f.enable(true);f.root('upgrade-root','Add mobile checkout');await f.fileRefresh('upgrade-root');
   const job=f.db.prepare("SELECT * FROM jobs WHERE kind='scope_assess'").get(),p=JSON.parse(job.payload_json);
   assert.equal(p.version,2);assert.match(p.work.logicalKey,/^[a-f0-9]{64}$/);
   if(legacy){delete p.work.logicalKey;p.version=1;f.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(p),job.id);}
   const before=f.db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(job.id).payload_json;
   await f.fileRefresh('upgrade-root');assert.equal(f.db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(job.id).payload_json,before);
   assert.equal((await f.jobs.runInboxJobs(new Date(),'scope_assess')).completed,1);assert.equal(f.calls,1);
   await f.jobs.runInboxJobs(new Date(),'scope_assess');assert.equal(f.calls,1);
  } finally {await f.close();}
 }
});

test('C1 assessment queue rejects missing, forged and cross-version logical metadata',async()=>{
 const f=await fixture({listen:false});try {
  f.enable(true);f.root('upgrade-root','Add mobile checkout');await f.fileRefresh('upgrade-root');
  const job=f.db.prepare("SELECT * FROM jobs WHERE kind='scope_assess'").get(),p=JSON.parse(job.payload_json);
  for(const mutate of [p=>{delete p.work.logicalKey;},p=>{p.work.logicalKey='bad';},p=>{p.version=1;},p=>{p.work.extra=true;}]){
   const bad=structuredClone(p);mutate(bad);
   assert.throws(()=>f.jobs.enqueueJob({key:crypto.randomUUID(),kind:'scope_assess',projectId:'demo',runId:f.ctx.runId,payload:bad,dueAt:new Date().toISOString()}),/Invalid assessment job payload/);
  }
  p.work.logicalKey='0'.repeat(64);f.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(p),job.id);
  assert.equal((await f.jobs.runInboxJobs(new Date(),'scope_assess')).failed,1);assert.equal(f.calls,0);
 } finally {await f.close();}
});

test('C1 changed legacy full identity cannot acquire current logical authority from a queued reference',async()=>{
 const f=await fixture({listen:false});try {
  f.enable(true);f.root('upgrade-root','Add mobile checkout');await f.fileRefresh('upgrade-root');
  const job=f.db.prepare("SELECT * FROM jobs WHERE kind='scope_assess'").get(),p=JSON.parse(job.payload_json);
  p.version=1;delete p.work.logicalKey;p.work.inference.promptImplementation='d'.repeat(64);p.work.fingerprint=oldFingerprint;
  f.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(p),job.id);
  assert.equal((await f.jobs.runInboxJobs(new Date(),'scope_assess')).failed,1);assert.equal(f.calls,0);
  assert.equal(f.db.prepare('SELECT error_category FROM jobs WHERE id=?').get(job.id).error_category,'assessment_superseded');
 } finally {await f.close();}
});
