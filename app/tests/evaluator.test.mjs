import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedApp} from './helpers.mjs';

const api = await import('../scripts/eval-assessments.mjs').catch(error => {if(error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;});
const required = name => {assert.equal(typeof api[name], 'function', `T13 requires ${name}`); return api[name];};
const input = (message = 'Add a mobile checkout') => ({
  clauses: [{id: 'desktop', text: 'Desktop checkout is included. Mobile layouts are excluded.'}],
  rates: [{id: 'mobile_checkout', description: 'Add mobile layouts for the existing checkout flow', unitAmountMinor: 25000}],
  comment: message, replies: [], commitments: [], channel: 'figma', sourceState: 'available', mode: 'manual',
});
const dataset = (count = 3) => ({schemaVersion: 1, split: 'baseline', description: 'Independent synthetic unit cases', cases: Array.from({length: count}, (_, n) => ({
  id: 'case-' + n, input: input('Add a mobile checkout ' + n), expected: {outcome: 'assessed', items: [{requestQuote: 'Add a mobile checkout ' + n, classification: 'new_work', billable: true, clearlyNew: true, rateIds: ['mobile_checkout'], totalMinor: 25000}]},
}))});
const contract = {schemaVersion: 1, sourceIdentity: 'a'.repeat(64), inference: {manual: {provider: 'baseten', model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast', reasoning: 'max', promptVersion: 'scope-assessment-items-v4', itemized: true, mode: 'manual', schema: 'b'.repeat(64), promptImplementation: 'c'.repeat(64)}}};
const result = message => ({outcome: 'succeeded', dispatched: true, items: [{requestQuote: message, rawClassification: 'new_work', billable: true, rateIds: ['mobile_checkout'], totalMinor: 25000, eligibilityChecked: true}], usage: {inputTokens: 100, outputTokens: 100}});

test('C1 evaluator case key omits only implementation identity and validates the complete input',()=>{
 const key=required('evaluationCaseKey'),i=input(),inference=contract.inference.manual;
 assert.equal(key(i,inference),key({...i}, {...inference,promptImplementation:'d'.repeat(64)}));
 assert.equal(key(i,inference),key(Object.fromEntries(Object.entries(i).reverse()),inference));
 for(const field of ['model','promptVersion','schema','mode'])assert.notEqual(key(i,inference),key(i,{...inference,[field]:inference[field]+'-changed'}));
 assert.notEqual(key(i,inference),key(input('Different request'),inference));
 assert.throws(()=>key({...i,unexpected:true},inference),/input/i);
});

test('C1 evaluator blocks bound uncertainty across real implementation upgrades but never reuses another runtime success',async()=>{
 for(const uncertain of [true,false]) {
  const original=globalThis.fetch,firstApp=await isolatedApp();let calls=0,runtime,next;
  globalThis.fetch=async(_url,options)=>{
   calls++;if(uncertain)throw new TypeError('lost response');
   const c=JSON.parse(JSON.parse(options.body).messages[1].content[0].text),clause=c.project.scopeClauses[0];
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{requestedDeliverable:'Mobile checkout',requestQuote:c.comment.message,classification:'new_work',evidence:[{kind:'scope_clause',snapshotId:c.scopeContext.scopeSnapshotId,clauseId:clause.id,quote:clause.text}],rates:[{rateCardId:'mobile_checkout',quantity:1}],questions:[],existingCommitment:null}],explanation:'Fixture',designObservations:[]})}}],usage:{prompt_tokens:100,completion_tokens:100}});
  };
  try {
   runtime=await required('createProductionEvaluator')({load:firstApp.load,evidenceMode:'synthetic_provider_fixture'});
   const a=await runtime.execute(input(),{}),before=runtime.db.prepare('SELECT * FROM ai_calls').all(),{DATA_DIR}=await firstApp.load('env');
   assert.equal(a.outcome,uncertain?'uncertain':'succeeded');await runtime.close();
   const upgraded=await isolatedApp();process.env.SCOPE_SETTLE_DATA_DIR=DATA_DIR;
   const file=join(upgraded.app,'dist/backend/assessment.js'),bytes=await readFile(file,'utf8');
   assert.match(bytes,/export async function assess\(input, runId = currentRunId\(\), assertAuthorized, hooks\) \{/);
   await writeFile(file,bytes.replace('export async function assess(input, runId = currentRunId(), assertAuthorized, hooks) {','export async function assess(input, runId = currentRunId(), assertAuthorized, hooks) {\nvoid "synthetic implementation upgrade";'));
   next=await required('createProductionEvaluator')({load:upgraded.load,evidenceMode:'synthetic_provider_fixture'});
   const b=await next.execute(input(),{});
   assert.equal(b.outcome,uncertain?'uncertain':'succeeded');assert.equal(calls,uncertain?1:2);
   assert.notEqual(b.runId,a.runId);assert.equal(b.dispatched,!uncertain);
   if(uncertain){
    assert.deepEqual(next.db.prepare('SELECT * FROM ai_calls').all(),before);
    next.db.prepare('DELETE FROM evaluation_work_bindings').run();await next.close();
    const live=await required('createProductionEvaluator')({load:upgraded.load,evidenceMode:'live_provider'});
    try {await assert.rejects(live.execute(input('A separate case'),{}),/legacy|unbound|review/i);assert.equal(calls,1);assert.deepEqual(live.db.prepare('SELECT * FROM ai_calls').all(),before);}finally{await live.close();}
   } else assert.equal(b.reused,false);
  } finally {globalThis.fetch=original;await next?.close();await runtime?.close();next?.db.close();runtime?.db.close();}
 }
});

test('T13 arguments reject unknown/duplicate flags and unsafe labels before runtime loading; default mode is validation only', () => {
  const parse = required('parseEvaluationArgs');
  const args = parse(['--fixtures', 'fixtures.json', '--output-label', 'release-b']);
  assert.equal(args.live, false); assert.equal(args.fixtures, 'fixtures.json');
  for (const bad of [['--mystery'], ['constructor','x'], ['--fixtures'], ['--fixtures','a','--fixtures','b'], ['--output-label','../escape'], ['--output-label','A B'], ['--live'], ['--resume']]) assert.throws(() => parse(bad));
});

test('T13 fixture validation bounds itemized input and keeps truth labels out of provider input', () => {
  const validate = required('validateEvaluationFixtures');
  const f = dataset(); assert.equal(validate(f).cases.length, 3);
  assert.throws(() => validate({...f, cases: [f.cases[0], f.cases[0]]}), /duplicate/i);
  assert.throws(() => validate({...f, cases: [{...f.cases[0], input: {...input(), expectedClassification: 'new_work'}}]}));
  assert.throws(() => validate({...f, cases: [{...f.cases[0], expected: {outcome: 'assessed', items: [{requestQuote: 'not in the request', classification: 'included', billable: false}]}}]}));
});

test('T13 report totals retain rejected, uncertain, skipped and missing items in the release denominators', () => {
  const summarize = required('summarizeEvaluation'), fixtures = dataset(5);
  fixtures.cases[0].expected.items[0] = {...fixtures.cases[0].expected.items[0], classification: 'included', billable: false, clearlyNew: false};
  const report = summarize({fixtures, results: [
    {caseId: 'case-0', ...result(fixtures.cases[0].input.comment)},
    {caseId: 'case-1', outcome: 'rejected', dispatched: true, items: []},
    {caseId: 'case-2', outcome: 'uncertain', dispatched: true, items: []},
    {caseId: 'case-3', outcome: 'skipped', dispatched: false, items: []},
  ], evidenceMode: 'synthetic_provider_fixture'});
  assert.equal(report.cases.total, 5); assert.equal(report.cases.rejected, 1); assert.equal(report.cases.uncertain, 1); assert.equal(report.cases.skipped, 1); assert.equal(report.cases.notAttempted, 1);
  assert.equal(report.items.expected, 5); assert.equal(report.items.falseBillable, 1); assert.equal(report.items.clearlyNewDenominator, 4); assert.equal(report.items.clearlyNewRecognized, 0);
  assert.equal(report.metricsPass, false); assert.equal(report.releaseBPassed, false);
});

test('T13 the proposed 90 percent new-work bar is distinct from all-cases exact-match diagnostics', () => {
  const fixtures=dataset(10), results=fixtures.cases.map(c=>({caseId:c.id,...result(c.input.comment)}));
  Object.assign(results[9].items[0],{rawClassification:'needs_clarification',billable:false,rateIds:[],totalMinor:0});
  const report=required('summarizeEvaluation')({fixtures,results,evidenceMode:'synthetic_provider_fixture'});
  assert.equal(report.cases.passed,9);assert.equal(report.clearlyNewRecognition,.9);assert.equal(report.metricsPass,true);assert.equal(report.releaseBPassed,false);
});

test('T13 CLI validation loads no credentials, creates no database and makes no provider call', async () => {
  const directory=await mkdtemp(join(tmpdir(),'scope-eval-validate-')), fixtures=join(directory,'fixtures.json'), data=join(directory,'absent-data');
  await writeFile(fixtures,JSON.stringify(dataset()));
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/evaluate-ai.mjs',import.meta.url)),'--fixtures',fixtures],{encoding:'utf8',env:{...process.env,AI_PROVIDER:'invalid-if-runtime-imported',SCOPE_SETTLE_DATA_DIR:data}});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).providerCalls,0);await assert.rejects(access(data));
});

test('T13 resumable checkpoints bind fixture/contract identity, preserve partial totals and never send expected labels to execution', async () => {
  const run = required('runEvaluation'), fixtures = dataset(), directory = await mkdtemp(join(tmpdir(), 'scope-eval-run-'));
  let calls = 0;
  const execute = async value => {calls++; assert.equal(Object.hasOwn(value, 'expected'), false); assert.equal(Object.hasOwn(value, 'classification'), false); return result(value.comment);};
  const first = await run({fixtures, contract, outputLabel: 'baseline', directory, execute, limit: 1, evidenceMode: 'synthetic_provider_fixture'});
  assert.equal(first.cases.notAttempted, 2); assert.equal(first.metricsPass, false); assert.equal(calls, 1);
  const resumed = await run({fixtures, contract, outputLabel: 'baseline', directory, execute, resume: true, evidenceMode: 'synthetic_provider_fixture'});
  assert.equal(calls, 3); assert.equal(resumed.cases.passed, 3); assert.equal(resumed.releaseBPassed, false);
  await assert.rejects(run({fixtures, contract: {...contract, sourceIdentity: 'd'.repeat(64)}, outputLabel: 'baseline', directory, execute, resume: true}), /identity|contract/i);
  assert.equal(calls, 3);
  const files = await import('node:fs/promises').then(fs => fs.readdir(directory));
  assert.ok(files.filter(name => name.startsWith('report-')).length >= 2, 'Earlier reports must be retained');
});

test('T13 an interrupted dispatched checkpoint becomes uncertain and cannot blindly call the provider on resume', async () => {
  const run = required('runEvaluation'), fixtures = dataset(1), directory = await mkdtemp(join(tmpdir(), 'scope-eval-unknown-'));
  let calls = 0;
  const execute = async (_value, hooks) => {calls++; hooks.dispatched(); throw new TypeError('synthetic lost response');};
  const first = await run({fixtures, contract, outputLabel: 'unknown', directory, execute, evidenceMode: 'synthetic_provider_fixture'});
  assert.equal(first.cases.uncertain, 1);
  const second = await run({fixtures, contract, outputLabel: 'unknown', directory, execute, resume: true, evidenceMode: 'synthetic_provider_fixture'});
  assert.equal(second.cases.uncertain, 1); assert.equal(calls, 1);
});

test('T13 production adapter uses the actual itemized prompt/schema, durable attempts, budget ledger and reservation eligibility', async () => {
  const create = required('createProductionEvaluator'), app = await isolatedApp(), m = {};
  for (const name of ['db','env','assessment','aiBudget']) m[name] = await app.load(name);
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++; const wire = JSON.parse(options.body), context = JSON.parse(wire.messages[1].content[0].text);
    assert.ok(wire.response_format.json_schema.schema.properties.items); assert.equal(context.expected, undefined);
    assert.equal(context.project.name, 'Synthetic evaluation fixture');
    const clause = context.project.scopeClauses[0];
    return Response.json({choices: [{finish_reason: 'stop', message: {reasoning_content: 'PRIVATE REASONING SENTINEL', content: JSON.stringify({items: [{requestedDeliverable: 'Mobile checkout', requestQuote: context.comment.message, classification: 'new_work', evidence: [{kind: 'scope_clause', snapshotId: context.scopeContext.scopeSnapshotId, clauseId: clause.id, quote: clause.text}], rates: [{rateCardId: 'mobile_checkout', quantity: 1}], questions: [], existingCommitment: null}], explanation: 'Synthetic test output', designObservations: []})}}], usage: {prompt_tokens: 100, completion_tokens: 100}});
  };
  let runtime;
  try {
    runtime = await create({load: app.load, evidenceMode: 'synthetic_provider_fixture'});
    const a = await runtime.execute(input(), {}), b = await runtime.execute(input(), {});
    assert.equal(a.outcome, 'succeeded'); assert.equal(a.items[0].billable, true); assert.equal(a.items[0].eligibilityChecked, true);
    assert.equal(calls, 1); assert.equal(b.outcome, 'succeeded');
    assert.equal(b.dispatched,false);assert.equal(b.reused,true);assert.equal(b.cost.newChargedMicroUsd,0);
    assert.equal(m.db.db.prepare('SELECT count(*) n FROM assessment_attempts').get().n, 1);
    assert.equal(m.db.db.prepare('SELECT count(*) n FROM ai_calls').get().n, 1);
    assert.equal(m.db.db.prepare('SELECT count(*) n FROM change_orders').get().n, 0);
    assert.ok(m.aiBudget.aiBudget.status().spentMicroUsd > 0);
    assert.doesNotMatch(JSON.stringify(a), /PRIVATE REASONING|baseten-test-only/);
  } finally {globalThis.fetch = original; await runtime?.close(); m.db.db.close();}
});

test('T13 frozen contracts detect source drift instead of silently updating identity after labels are opened', async () => {
  const freeze = required('freezeEvaluationContract'), verify = required('verifyEvaluationContract');
  const directory = await mkdtemp(join(tmpdir(), 'scope-eval-freeze-')), fs = await import('node:fs/promises');
  await fs.writeFile(join(directory, 'source.ts'), 'frozen production source');
  const value = await freeze({root: directory, files: ['source.ts'], inference: contract.inference});
  await verify(value, directory); await fs.writeFile(join(directory, 'source.ts'), 'changed');
  await assert.rejects(verify(value, directory), /source|frozen|drift/i);
});

test('T13 allocation admission refuses fresh ledgers, stale history, overallocated global budgets and insufficient balances', () => {
  const verify = required('verifyEvaluationAllocation'), {createHash} = process.getBuiltinModule('node:crypto');
  const history=[{id:'old',reserved_micro_usd:100,actual_micro_usd:70}], ledgerPath=join(tmpdir(),'designated','scope-and-settle.db');
  const allocation={schemaVersion:1,reviewed:true,ledgerPath,historyHash:createHash('sha256').update(JSON.stringify(history)).digest('hex'),capMicroUsd:1000,otherAllocatedMicroUsd:24999000,globalCapMicroUsd:25000000};
  const args={allocation,ledgerPath,history,capMicroUsd:1000,reservationMicroUsd:500};
  assert.equal(verify(args).remainingMicroUsd,930);
  for(const changed of [{history:[]},{history:[...history,{id:'new',reserved_micro_usd:600}]},{allocation:{...allocation,otherAllocatedMicroUsd:25000000}},{reservationMicroUsd:950}])assert.throws(()=>verify({...args,...changed}));
});

test('T13 production duplicate fences, unavailable source and uncertain paid calls retain their real outcomes without repeat', async () => {
  const app=await isolatedApp(), create=required('createProductionEvaluator'), original=globalThis.fetch;let calls=0;
  const runtime=await create({load:app.load,evidenceMode:'synthetic_provider_fixture'});
  globalThis.fetch=async(_url,options)=>{
    calls++;const c=JSON.parse(JSON.parse(options.body).messages[1].content[0].text);
    if(c.comment.message==='Lose this response')throw new TypeError('SYNTHETIC TRANSPORT LOSS');
    const clause=c.project.scopeClauses[0];
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{requestedDeliverable:'Mobile checkout',requestQuote:c.comment.message,classification:'new_work',evidence:[{kind:'scope_clause',snapshotId:c.scopeContext.scopeSnapshotId,clauseId:clause.id,quote:clause.text}],rates:[{rateCardId:'mobile_checkout',quantity:1}],questions:[],existingCommitment:null}],explanation:'Fixture',designObservations:[]})}}],usage:{prompt_tokens:100,completion_tokens:100}});
  };
  try {
    const unavailable=await runtime.execute({...input(),sourceState:'unavailable'},{});
    assert.equal(unavailable.outcome,'blocked');assert.equal(calls,0);
    const prior={...input(),commitments:[{title:'Mobile checkout',deliverables:['Mobile checkout']}]};
    const duplicated=await runtime.execute(prior,{});
    assert.equal(duplicated.outcome,'succeeded');assert.equal(duplicated.items[0].rawClassification,'new_work');assert.equal(duplicated.items[0].billable,false);assert.match(duplicated.items[0].eligibilityReason,/duplicate/i);
    const missing=input('Lose this response'), a=await runtime.execute(missing,{}), b=await runtime.execute(missing,{});
    assert.equal(a.outcome,'uncertain');assert.equal(b.outcome,'uncertain');assert.equal(calls,2);assert.equal(a.cost.usageKnown,false);
    assert.ok(a.cost.chargedMicroUsd>0);
    assert.equal(runtime.db.prepare('SELECT count(*) n FROM ai_calls').get().n,2);
  }finally{globalThis.fetch=original;await runtime.close();runtime.db.close();}
});

test('T13 closing an evaluator drains admitted work before releasing exclusive database ownership', async () => {
  const app=await isolatedApp(), create=required('createProductionEvaluator'), original=globalThis.fetch;
  const runtime=await create({load:app.load,evidenceMode:'synthetic_provider_fixture'});
  let release,dispatched;const held=new Promise(done=>release=done), seen=new Promise(done=>dispatched=done);
  globalThis.fetch=async()=>{dispatched();await held;throw new TypeError('synthetic');};
  try {
    const running=runtime.execute(input(),{});await seen;
    let closed=false;const closing=runtime.close().then(()=>closed=true);await new Promise(done=>setTimeout(done,20));
    assert.equal(closed,false,'In-flight work must retain its runtime owner');
    await assert.rejects(create({load:app.load,evidenceMode:'synthetic_provider_fixture'}),/runtime|owner|already/i);
    release();await running;await closing;
  }finally{release();globalThis.fetch=original;await runtime.close();runtime.db.close();}
});

test('T13 malformed provider output stays rejected, charged and ineligible on every later lookup', async () => {
  const app=await isolatedApp(), runtime=await required('createProductionEvaluator')({load:app.load,evidenceMode:'synthetic_provider_fixture'}),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"invented":"schema"}',reasoning_content:'PRIVATE REJECTED REASONING'}}],usage:{prompt_tokens:30,completion_tokens:40}});};
  try {
    const a=await runtime.execute(input(),{}),b=await runtime.execute(input(),{});
    assert.equal(a.outcome,'rejected');assert.equal(b.outcome,'rejected');assert.equal(calls,1);assert.ok(a.cost.chargedMicroUsd>0);assert.equal(a.cost.usageKnown,true);
    assert.deepEqual(a.items,[]);assert.doesNotMatch(JSON.stringify(a),/PRIVATE REJECTED|invented/);
  }finally{globalThis.fetch=original;await runtime.close();runtime.db.close();}
});

test('T13 public held-out adaptation remains separate from baseline and matches the pre-exposure production freeze', async () => {
  const fs=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  const fixtures=required('validateEvaluationFixtures')(JSON.parse(await fs.readFile(new URL('../../fixtures/scope-held-out-cases.json',import.meta.url),'utf8')));
  const baseline=required('validateEvaluationFixtures')(JSON.parse(await fs.readFile(new URL('../../fixtures/scope-baseline-cases.json',import.meta.url),'utf8')));
  const contract=JSON.parse(await fs.readFile(new URL('../../docs/verification/scope-evaluation-contract.json',import.meta.url),'utf8'));
  const notes=JSON.parse(await fs.readFile(new URL('../../docs/verification/scope-evaluation-case-notes.json',import.meta.url),'utf8'));
  assert.ok(fixtures.cases.length>=30);assert.equal(fixtures.split,'held_out');assert.ok(Date.parse(notes.adaptedAt)>Date.parse(contract.frozenAt));
  assert.equal(notes.preExposureSourceIdentity,contract.sourceIdentity);assert.equal(notes.originalDraftSha256,'94c0f7a3035dac79d7943721ecb3c00685dbb9f093966ee4aa4800cc674a3981');
  const oldInputs=new Set(baseline.cases.map(c=>createHash('sha256').update(JSON.stringify(c.input)).digest('hex')));
  for(const c of fixtures.cases)assert.equal(oldInputs.has(createHash('sha256').update(JSON.stringify(c.input)).digest('hex')),false);
  for(const category of ['mixed_requests','included_work','genuine_additions','prior_commitments','ambiguous_pricing','contradictory_clauses','stale_evidence','instruction_injection'])assert.ok(fixtures.cases.some(c=>c.tags.includes(category)));
  // This is a historical pre-label freeze. Subsequent roadmap changes legitimately change other sources.
  // The generation prompt/schema implementation itself must still equal the pre-exposure bytes.
  for(const file of ['app/src/backend/assessment.ts','app/dist/backend/assessment.js']) {
    const source=contract.source.find(x=>x.path===file);assert.ok(source);
    assert.equal(createHash('sha256').update(await fs.readFile(new URL('../../'+file,import.meta.url))).digest('hex'),source.sha256);
  }
});
