import {createHash, randomUUID} from 'node:crypto';
import {readFile, mkdir, stat, realpath} from 'node:fs/promises';
import {writeFileSync, renameSync, existsSync} from 'node:fs';
import {resolve, relative, isAbsolute, dirname, basename} from 'node:path';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max = 4000) => typeof value === 'string' && value.trim() && value.length <= max;
const array = (value, max) => Array.isArray(value) && value.length <= max;
const assert = (ok, message) => {if (!ok) throw new Error(message);};
const labelPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = contract => hash({sourceIdentity: contract.sourceIdentity, inference: contract.inference});
const save = (file, value) => {const temp = file + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(value, null, 2), {flag: 'wx'}); renameSync(temp, file);};

export function parseEvaluationArgs(argv) {
  const out = {fixtures: '../fixtures/scope-baseline-cases.json', outputLabel: 'baseline', live: false, resume: false};
  const seen = new Set(), flags = {'--fixtures':'fixtures','--output-label':'outputLabel','--contract':'contract','--ledger':'ledger','--allocation':'allocation','--limit':'limit','--live':'live','--resume':'resume'};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], key = Object.hasOwn(flags,flag) ? flags[flag] : undefined;
    assert(key && !seen.has(flag), 'Unknown or duplicate evaluator flag: ' + flag); seen.add(flag);
    if (key === 'live' || key === 'resume') out[key] = true;
    else {assert(text(argv[i+1]) && !argv[i+1].startsWith('--'), 'Missing value for ' + flag); out[key] = argv[++i];}
  }
  assert(labelPattern.test(out.outputLabel), 'Invalid output label');
  if (out.limit !== undefined) {assert(/^[1-9][0-9]*$/.test(out.limit) && Number(out.limit) <= 200, 'Invalid case limit'); out.limit = Number(out.limit);}
  assert(!out.live || (out.ledger && out.allocation && out.contract), 'Live evaluation requires an existing ledger, reviewed allocation and frozen contract');
  assert(!out.resume || out.live, 'Resume is only meaningful with explicit live execution');
  assert(out.live || (!out.ledger && !out.allocation), 'Ledger/allocation flags require --live');
  return out;
}

function validateEvaluationInput(i) {
    assert(only(i, ['clauses','rates','comment','replies','commitments','channel','sourceState','mode']) && text(i.comment) && array(i.replies, 30) && i.replies.every(x => text(x)) && ['figma','portal'].includes(i.channel) && ['available','unavailable'].includes(i.sourceState) && ['manual','automatic'].includes(i.mode), 'Invalid case input');
    assert(i.sourceState !== 'unavailable' || i.channel === 'figma', 'Unavailable observation requires a Figma source');
    assert(array(i.clauses, 50) && i.clauses.length && i.clauses.every(x => only(x,['id','text']) && text(x.id, 100) && text(x.text)), 'Invalid clauses');
    assert(array(i.rates, 50) && i.rates.every(x => only(x,['id','description','unitAmountMinor']) && text(x.id,100) && text(x.description) && Number.isSafeInteger(x.unitAmountMinor) && x.unitAmountMinor > 0 && x.unitAmountMinor <= 100000000), 'Invalid rates');
    for (const rows of [i.clauses, i.rates]) assert(new Set(rows.map(x => x.id)).size === rows.length, 'Duplicate clause/rate identity');
    assert(array(i.commitments, 20) && i.commitments.every(x => only(x,['title','deliverables']) && text(x.title,200) && array(x.deliverables,20) && x.deliverables.length && x.deliverables.every(d => text(d))), 'Invalid commitments');
}
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
/** CLI-owned semantic safety identity; success caching still uses the full inference/run identity. */
export function evaluationCaseKey(input,inference) {
 validateEvaluationInput(input);assert(plain(inference)&&hex(inference.promptImplementation),'Invalid evaluation inference identity');
 const {promptImplementation,...logicalInference}=inference;
 return hash(canonical({input,inference:logicalInference}));
}

export function validateEvaluationFixtures(value) {
  assert(only(value, ['schemaVersion','split','description','cases']) && value.schemaVersion === 1 && ['baseline','held_out'].includes(value.split) && text(value.description) && array(value.cases, 200) && value.cases.length, 'Invalid fixture dataset');
  const ids = new Set();
  for (const entry of value.cases) {
    assert(only(entry, ['id','input','expected','tags']) && labelPattern.test(entry.id), 'Invalid case identity');
    assert(!ids.has(entry.id), 'Duplicate fixture case ID'); ids.add(entry.id);
    assert(entry.tags === undefined || array(entry.tags, 20) && entry.tags.every(x => text(x, 80)), 'Invalid case tags');
    const i = entry.input, e = entry.expected;
    validateEvaluationInput(i);
    assert(only(e,['outcome','items']) && ['assessed','blocked'].includes(e.outcome) && array(e.items,20), 'Invalid expected outcome');
    assert(e.outcome === 'blocked' ? i.sourceState === 'unavailable' && e.items.length === 0 : e.items.length > 0 && i.sourceState === 'available', 'Expected outcome contradicts source availability');
    for (const item of e.items) {
      assert(only(item,['requestQuote','classification','billable','clearlyNew','rateIds','totalMinor']) && text(item.requestQuote) && [i.comment,...i.replies].some(m => m.includes(item.requestQuote)) && ['included','new_work','needs_clarification'].includes(item.classification) && typeof item.billable === 'boolean', 'Invalid expected item or quote');
      assert(item.clearlyNew === undefined || typeof item.clearlyNew === 'boolean', 'Invalid recognition label');
      assert(!item.clearlyNew || item.classification === 'new_work', 'Clearly-new label requires new work');
      assert(!item.billable || item.classification === 'new_work', 'Included/ambiguous labels cannot be billable');
      assert(item.rateIds === undefined || array(item.rateIds,20) && item.rateIds.every(id => i.rates.some(r => r.id === id)), 'Unknown expected rate');
      assert(item.totalMinor === undefined || Number.isSafeInteger(item.totalMinor) && item.totalMinor >= 0, 'Invalid expected amount');
    }
    assert(new Set(e.items.map(x => x.requestQuote)).size === e.items.length, 'Duplicate expected quote');
  }
  return value;
}

export function summarizeEvaluation({fixtures, results, evidenceMode = 'unqualified'}) {
  validateEvaluationFixtures(fixtures);
  assert(new Set(results.map(x => x.caseId)).size === results.length && results.every(x => fixtures.cases.some(c => c.id === x.caseId)), 'Duplicate or unknown result case');
  const cases = {total: fixtures.cases.length, attempted: 0, succeeded: 0, blocked: 0, rejected: 0, uncertain: 0, skipped: 0, notAttempted: 0, passed: 0};
  const items = {expected:0, observed:0, missing:0, unexpected:0, rawCorrect:0, falseBillable:0, billingTermsFailures:0, eligibilityUnchecked:0, clearlyNewDenominator:0, clearlyNewRecognized:0, duplicateInvariantFailures:0};
  const evaluated = [], latencies = [], countedCalls = new Set(); let knownMicroUsd = 0, chargedMicroUsd = 0, newChargedMicroUsd = 0, unknownUsageCalls = 0;
  for (const fixture of fixtures.cases) {
    const row = results.find(x => x.caseId === fixture.id), outcome = row?.outcome ?? 'notAttempted';
    assert(Object.hasOwn(cases, outcome) && !['total','attempted','passed'].includes(outcome), 'Invalid result outcome');
    cases[outcome]++; if (row && !['skipped','notAttempted'].includes(outcome)) cases.attempted++;
    const observed = outcome === 'succeeded' && Array.isArray(row.items) ? row.items : [], used = new Set(), checks = [];
    items.expected += fixture.expected.items.length; items.observed += observed.length;
    for (const truth of fixture.expected.items) {
      // Exact quotes provide deterministic one-to-one alignment. No optimistic fuzzy matching.
      const index = observed.findIndex((x,n) => !used.has(n) && x.requestQuote === truth.requestQuote);
      const actual = index < 0 ? null : observed[index]; if (actual) used.add(index); else items.missing++;
      const rawCorrect = !!actual && actual.rawClassification === truth.classification;
      if (rawCorrect) items.rawCorrect++;
      const billable = !!actual && actual.billable === true;
      if (billable && !truth.billable) items.falseBillable++;
      if (billable && !truth.billable && fixture.input.commitments.length) items.duplicateInvariantFailures++;
      if (truth.clearlyNew) {items.clearlyNewDenominator++; if (rawCorrect && (!truth.billable || billable && actual.eligibilityChecked === true)) items.clearlyNewRecognized++;}
      checks.push({requestQuote:truth.requestQuote, rawCorrect, billabilityCorrect:!!actual && billable === truth.billable && actual.eligibilityChecked === true,
        ratesCorrect:truth.rateIds === undefined || !!actual && JSON.stringify([...actual.rateIds].sort()) === JSON.stringify([...truth.rateIds].sort()), amountCorrect:truth.totalMinor === undefined || actual?.totalMinor === truth.totalMinor});
    }
    const extras = observed.filter((_x,n) => !used.has(n)); items.unexpected += extras.length;
    items.eligibilityUnchecked += observed.filter(x => x.eligibilityChecked !== true).length;
    items.billingTermsFailures += checks.filter((x,n) => used.size && observed.some(a => a.requestQuote === fixture.expected.items[n].requestQuote && a.billable) && (!x.ratesCorrect || !x.amountCorrect)).length;
    items.falseBillable += extras.filter(x => x.billable).length;
    items.duplicateInvariantFailures += extras.filter(x => x.billable && fixture.input.commitments.length).length;
    const passed = fixture.expected.outcome === 'blocked' ? outcome === 'blocked' && row.guardVerified === true : outcome === 'succeeded' && !extras.length && checks.every(x => x.rawCorrect && x.billabilityCorrect && x.ratesCorrect && x.amountCorrect);
    if (passed) cases.passed++;
    evaluated.push({caseId:fixture.id, outcome, passed, checks, result:row ?? null});
    if (Number.isFinite(row?.latencyMs)) latencies.push(row.latencyMs);
    const callKey=row?.attempt?.callId ?? fixture.id;
    if (row?.cost && !countedCalls.has(callKey)) {countedCalls.add(callKey);chargedMicroUsd += row.cost.chargedMicroUsd ?? 0;newChargedMicroUsd += row.cost.newChargedMicroUsd ?? 0;if (row.cost.usageKnown) knownMicroUsd += row.cost.chargedMicroUsd ?? 0; else unknownUsageCalls++;}
  }
  const clearlyNewRecognition = items.clearlyNewDenominator ? items.clearlyNewRecognized / items.clearlyNewDenominator : null;
  const complete = cases.notAttempted === 0 && cases.skipped === 0 && cases.rejected === 0 && cases.uncertain === 0;
  const metricsPass = complete && items.expected > 0 && items.missing === 0 && items.unexpected === 0 && items.eligibilityUnchecked === 0 && items.billingTermsFailures === 0 && items.falseBillable === 0 && items.duplicateInvariantFailures === 0 && clearlyNewRecognition !== null && clearlyNewRecognition >= .9;
  return {schemaVersion:1, evidenceMode, cases, items, clearlyNewRecognition, metricsPass, releaseBPassed:false,
    qualification:'Synthetic fixtures and automatic quote/ID checks cannot establish live model accuracy, semantic support, native integration or designer-observation gates.',
    latency:{count:latencies.length,totalMs:latencies.reduce((a,b)=>a+b,0),maxMs:latencies.length?Math.max(...latencies):null},
    cost:{knownMicroUsd,chargedMicroUsd,newChargedMicroUsd,unknownUsageCalls}, results:evaluated};
}

export async function runEvaluation({fixtures, contract, outputLabel, directory, execute, limit = Infinity, resume = false, evidenceMode = 'unqualified', fixtureIdentity, reportMetadata = () => ({})}) {
  validateEvaluationFixtures(fixtures); assert(labelPattern.test(outputLabel), 'Invalid output label');
  assert(contract?.schemaVersion === 1 && hex(contract.sourceIdentity) && plain(contract.inference), 'Invalid frozen contract');
  await mkdir(directory, {recursive:true});
  const file = resolve(directory, outputLabel + '-checkpoint.json'), binding = {fixtureHash:fixtureIdentity ?? hash(fixtures),contractIdentity:identity(contract),evidenceMode};
  let state = {schemaVersion:1, binding, results:[]};
  if (existsSync(file)) {
    assert(resume, 'An evaluation checkpoint exists; use explicit resume'); state = JSON.parse(await readFile(file,'utf8'));
    assert(JSON.stringify(state.binding) === JSON.stringify(binding), 'Fixture or contract identity changed; refusing resume');
    for (const row of state.results) if (row.outcome === 'prepared' || row.outcome === 'dispatched') Object.assign(row,{outcome:'uncertain',items:[],interrupted:true});
  } else assert(!resume, 'No matching checkpoint to resume');
  save(file,state); let attempted = 0;
  for (const fixture of fixtures.cases) {
    if (state.results.some(x=>x.caseId === fixture.id) || attempted >= limit) continue;
    attempted++; const started = Date.now(), row = {caseId:fixture.id,outcome:'prepared',dispatched:false,items:[]};
    state.results.push(row); save(file,state);
    try {
      const value = await execute(structuredClone(fixture.input), {dispatched(){row.outcome='dispatched';row.dispatched=true;save(file,state);}});
      assert(value && ['succeeded','blocked','rejected','uncertain','skipped'].includes(value.outcome), 'Executor returned an invalid outcome');
      Object.assign(row,structuredClone(value),{caseId:fixture.id,latencyMs:Date.now()-started});
    } catch {Object.assign(row,{outcome:row.dispatched?'uncertain':'rejected',latencyMs:Date.now()-started,error:'Evaluation did not complete; consult durable attempt and private operational evidence'});}
    save(file,state);
  }
  const report = {...summarizeEvaluation({fixtures,results:state.results,evidenceMode}),...reportMetadata(),at:new Date().toISOString(),outputLabel,fixtureIdentity:binding.fixtureHash,contract,checkpoint:basename(file)};
  const reportFile = resolve(directory,'report-'+outputLabel+'-'+randomUUID()+'.json');
  writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'}); return {...report,reportFile};
}

export async function freezeEvaluationContract({root, files, inference}) {
  assert(array(files,2000) && files.length && new Set(files).size === files.length, 'Invalid freeze file list');
  const source = [];
  for (const name of [...files].sort()) {assert(text(name) && !isAbsolute(name) && !relative(resolve(root),resolve(root,name)).startsWith('..'), 'Frozen source must stay inside root'); source.push({path:name.replaceAll('\\','/'),sha256:hash(await readFile(resolve(root,name)))});}
  return {schemaVersion:1,frozenAt:new Date().toISOString(),sourceKind:'uncommitted_source_manifest',sourceIdentity:hash(source),source,inference:structuredClone(inference)};
}
export async function verifyEvaluationContract(contract, root) {
  assert(contract?.schemaVersion === 1 && hex(contract.sourceIdentity) && array(contract.source,2000) && contract.source.length, 'Invalid frozen contract');
  assert(hash(contract.source) === contract.sourceIdentity, 'Frozen manifest identity mismatch');
  for (const entry of contract.source) {
    assert(text(entry.path) && !isAbsolute(entry.path) && !relative(resolve(root),resolve(root,entry.path)).startsWith('..') && hex(entry.sha256), 'Invalid frozen source path');
    assert(hash(await readFile(resolve(root,entry.path))) === entry.sha256, 'Frozen production source drift: '+entry.path);
  }
}

/** Reviewed allocation binds the existing charged history, rather than creating a fresh allowance. */
export function verifyEvaluationAllocation({allocation,ledgerPath,history,capMicroUsd,reservationMicroUsd}) {
  assert(only(allocation,['schemaVersion','reviewed','ledgerPath','historyHash','capMicroUsd','otherAllocatedMicroUsd','globalCapMicroUsd']) && allocation.schemaVersion === 1 && allocation.reviewed === true, 'A reviewed allocation manifest is required');
  assert(resolve(allocation.ledgerPath).toLowerCase() === resolve(ledgerPath).toLowerCase() && allocation.historyHash === hash(history), 'Ledger history/allocation identity mismatch');
  assert(history.length > 0, 'Live evaluation cannot start with an empty allowance ledger');
  assert(history.every(row=>Number.isSafeInteger(row.reserved_micro_usd)&&row.reserved_micro_usd>0&&(row.actual_micro_usd===null||row.actual_micro_usd===undefined||Number.isSafeInteger(row.actual_micro_usd)&&row.actual_micro_usd>=0)), 'Invalid ledger amounts');
  assert(Number.isSafeInteger(capMicroUsd) && capMicroUsd > 0 && capMicroUsd === allocation.capMicroUsd && Number.isSafeInteger(allocation.otherAllocatedMicroUsd) && allocation.otherAllocatedMicroUsd >= 0 && allocation.globalCapMicroUsd === 25000000 && capMicroUsd + allocation.otherAllocatedMicroUsd <= 25000000, 'Global development allocation exceeds the existing $25 ceiling');
  const charged = history.reduce((sum,row)=>sum+(row.actual_micro_usd ?? row.reserved_micro_usd),0);
  assert(capMicroUsd - charged >= reservationMicroUsd, 'Existing allocation has insufficient remaining budget');
  return {ledgerPath,historyHash:hash(history),capMicroUsd,chargedMicroUsd:charged,remainingMicroUsd:capMicroUsd-charged,otherAllocatedMicroUsd:allocation.otherAllocatedMicroUsd};
}

/** CLI-only trusted adapter. No public route accepts fixture authority or expected labels. */
export async function createProductionEvaluator({load, evidenceMode}) {
  assert(['synthetic_provider_fixture','live_provider'].includes(evidenceMode), 'Explicit evidence mode required');
  const env = await load('env'), ownership = await load('runtimeOwner');
  await mkdir(env.DATA_DIR,{recursive:true});
  const owner = await ownership.acquireRuntimeOwner(resolve(env.DATA_DIR,'scope-and-settle.db'));
  try {
    const modules = {};
    for (const name of ['db','assessment','assessmentWork','requestItems','requestSources','scopeLedger','aiBudget']) modules[name] = await load(name);
    const {db,transaction} = modules.db, a = modules.assessment;
    let closed = false, closing; const active = new Set();
    const guard = () => assert(!closed,'Evaluator runtime has closed');
    const inference = Object.fromEntries(['manual','automatic'].map(mode=>[mode,a.assessmentInferenceIdentity({itemized:true,automation:mode==='automatic'})]));
    async function executeOne(input, hooks = {}) {
      guard();
      const caseKey=evaluationCaseKey(input,inference[input.mode]);
      if(evidenceMode==='live_provider') {
        const unbound=db.prepare(`SELECT a.id FROM assessment_attempts a JOIN judge_runs r ON r.run_id=a.run_id
          WHERE r.judge_access_id='synthetic-evaluation-no-access' AND a.outcome IN ('prepared','dispatched','uncertain','rejected')
          AND NOT EXISTS(SELECT 1 FROM evaluation_work_bindings b WHERE b.run_id=a.run_id AND b.fingerprint=a.fingerprint) LIMIT 1`).get();
        assert(!unbound,'Unbound legacy evaluator attempts require operator review before live inference');
      }
      // Labels/report names cannot create fresh paid work for identical input.
      const runId='evaluation-'+hash({input,inference:inference[input.mode]}), at='2026-01-01T00:00:00.000Z';
      const project={id:'demo',name:'Synthetic evaluation fixture',figmaFileKey:'evaluation-fixture',currency:'USD',scopeRevisionId:'evaluation-'+hash(input.clauses),scopeClauses:input.clauses,rateCard:input.rates};
      transaction(()=>{
        db.prepare('INSERT OR IGNORE INTO judge_runs(run_id,judge_access_id,project_json,created_at) VALUES(?,?,?,?)').run(runId,'synthetic-evaluation-no-access',JSON.stringify(project),at);
        assert(db.prepare('SELECT project_json FROM judge_runs WHERE run_id=?').get(runId).project_json === JSON.stringify(project),'Evaluation run identity collision');
        input.commitments.forEach((commitment,n)=>{
          const id=runId+'-commitment-'+n;
          db.prepare("INSERT OR IGNORE INTO change_orders(id,project_id,run_id,title,deliverables_json,line_items_json,total_minor,currency,status,created_at) VALUES(?,?,?,?,?,'[]',0,'USD','approved',?)").run(id,'demo',runId,commitment.title,JSON.stringify(commitment.deliverables),at);
          db.prepare('INSERT OR IGNORE INTO proposal_revisions VALUES(?,?,?,?)').run(id,1,JSON.stringify({...commitment,lineItems:[],totalMinor:0,currency:'USD'}),at);
          if(!db.prepare('SELECT id FROM approvals WHERE change_order_id=?').get(id))db.prepare("INSERT INTO approvals(change_order_id,change_order_revision,scope_revision_id,actor_role,created_at) VALUES(?,1,?,'client',?)").run(id,project.scopeRevisionId,at);
        });
      });
      const source={source:input.channel,fileKey:input.channel==='figma'?project.figmaFileKey:'',rootId:'root',messages:[{id:'root',message:input.comment},...input.replies.map((message,n)=>({id:'reply-'+n,message}))]};
      if(input.sourceState==='unavailable') {
        // Repeated unavailable cases query the existing fence without attempting recovery.
        const known=db.prepare('SELECT id FROM request_sources WHERE run_id=?').get(runId);
        if(!known)modules.requestSources.captureRequestSource(runId,source);
        modules.requestSources.recordSourceUnavailable(runId,'root','source_missing',modules.requestSources.observationMark());
        let blocked=false;try{modules.requestSources.captureRequestSource(runId,source);}catch(error){if(error instanceof modules.requestSources.SourceUnavailableError)blocked=true;else throw error;}
        assert(blocked,'Known source unavailability did not fence evaluation');return {outcome:'blocked',dispatched:false,guardVerified:true,runId,items:[]};
      }
      const request={project,comment:source.messages[0],replies:source.messages.slice(1),itemized:true,automation:input.mode==='automatic'};
      const reference=modules.assessmentWork.prepareAssessmentWork(runId,source,request,guard);
      const prior=db.prepare(`SELECT a.* FROM evaluation_work_bindings b JOIN assessment_attempts a ON a.run_id=b.run_id AND a.fingerprint=b.fingerprint
        JOIN judge_runs r ON r.run_id=a.run_id WHERE b.case_key=? AND a.run_id<>? AND r.judge_access_id='synthetic-evaluation-no-access'
        AND a.outcome IN ('prepared','dispatched','uncertain','rejected') ORDER BY a.created_at,a.id LIMIT 1`).get(caseKey,runId);
      if(prior)return {outcome:prior.outcome==='rejected'?'rejected':'uncertain',items:[],runId,dispatched:false,reused:false,error:'An unresolved equivalent evaluation case from another implementation requires operator review'};
      transaction(()=>{
        assert(db.prepare('SELECT judge_access_id FROM judge_runs WHERE run_id=?').get(runId)?.judge_access_id==='synthetic-evaluation-no-access','Evaluation binding requires an inaccessible synthetic run');
        db.prepare('INSERT OR IGNORE INTO evaluation_work_bindings(case_key,run_id,fingerprint,created_at) VALUES(?,?,?,?)').run(caseKey,runId,reference.fingerprint,new Date().toISOString());
      });
      let record, dispatched=false;
      const previousCall=db.prepare("SELECT call_id FROM assessment_attempts WHERE run_id=? AND fingerprint=? AND outcome<>'not_dispatched'").get(runId,reference.fingerprint)?.call_id;
      const costFor=call=>call?{chargedMicroUsd:call.actual_micro_usd??call.reserved_micro_usd,newChargedMicroUsd:previousCall===call.id?0:call.actual_micro_usd??call.reserved_micro_usd,usageKnown:call.input_tokens!==null}:null;
      try {record=await modules.assessmentWork.executeAssessmentWork(runId,reference,source,request,guard,(value,run,admit,paid)=>a.assess(value,run,admit,{...paid,dispatched(){hooks.dispatched?.();paid.dispatched();dispatched=true;}}));}
      catch {
        const durable=modules.assessmentWork.assessmentWorkOutcome(runId,reference,guard), call=durable.attempt?.callId?db.prepare('SELECT * FROM ai_calls WHERE id=?').get(durable.attempt.callId):null;
        return {outcome:durable.state==='uncertain'?'uncertain':'rejected',items:[],runId,attempt:durable.attempt,dispatched,reused:!!previousCall,cost:costFor(call),error:'Production assessment did not complete; inspect its durable outcome before any new paid attempt'};
      }
      const items=record.items.map(item=>{
        let billable=false,reason=null;
        try {modules.requestItems.inspectProposalItemEligibility(runId,item.id,guard);billable=!item.reservationState;if(!billable)reason='Item is already reserved or committed';}
        catch(error) {
          // Infrastructure errors must escape, never become a safe negative decision.
          const known=/^(Item assessment source or scope context changed; reassess|Exact source duplicate or overlapping peer remains blocked; review the authoritative source|Exact source duplicate remains blocked regardless of model-selected quote spans|Exact committed duplicate remains blocked regardless of semantic decision|Changed lineage or suspected duplicate requires recorded designer review|Item is not eligible billable work|Suspected duplicate requires recorded designer review)$/;
          if(!known.test(error.message))throw error;reason=error.message;
        }
        return {requestQuote:item.requestQuote,rawClassification:item.classification,billable,eligibilityChecked:true,eligibilityReason:reason,rateIds:item.lineItems.map(x=>x.rateCardId),totalMinor:item.proposedTotalMinor,evidence:item.evidence,existingCommitment:item.existingCommitment};
      });
      const call=db.prepare('SELECT * FROM ai_calls WHERE id=?').get(record.callId);
      return {outcome:'succeeded',runId,attempt:record.attempt,dispatched,reused:!!previousCall,items,usage:record.usage,providerLatencyMs:record.latencyMs,cost:costFor(call)};
    }
    function execute(input,hooks) {
      if(closed || closing)return Promise.reject(new Error('Evaluator runtime is closing'));
      const work=executeOne(input,hooks);active.add(work);
      void work.then(()=>active.delete(work),()=>active.delete(work));return work;
    }
    return {execute,inference,db,budget:modules.aiBudget.aiBudget,reservationMicroUsd:a.assessmentReservationMicroUsd(),close:()=>closing??=(async()=>{await Promise.allSettled([...active]);closed=true;await owner.release();})()};
  } catch(error) {await owner.release();throw error;}
}

export async function evaluationCli(argv, {appRoot, root}) {
  const args=parseEvaluationArgs(argv), bytes=await readFile(resolve(appRoot,args.fixtures)), fixtures=validateEvaluationFixtures(JSON.parse(bytes));
  if(!args.live) {
    if(args.contract)await verifyEvaluationContract(JSON.parse(await readFile(resolve(appRoot,args.contract),'utf8')),root);
    return {mode:'validation_only',split:fixtures.split,total:fixtures.cases.length,fixtureHash:hash(bytes),providerCalls:0,qualification:'No assessment results or release qualification produced'};
  }
  const contract=JSON.parse(await readFile(resolve(appRoot,args.contract),'utf8')); await verifyEvaluationContract(contract,root);
  const ledger=await realpath(resolve(appRoot,args.ledger));assert((await stat(ledger)).isFile() && basename(ledger)==='scope-and-settle.db','Explicit existing production-format ledger required');
  const allocation=JSON.parse(await readFile(resolve(appRoot,args.allocation),'utf8'));
  process.env.SCOPE_SETTLE_DATA_DIR=dirname(ledger);
  const {pathToFileURL}=await import('node:url'), load=name=>import(pathToFileURL(resolve(appRoot,'dist/backend',name+'.js')).href);
  let runtime;
  try {
    runtime=await createProductionEvaluator({load,evidenceMode:'live_provider'});
    assert(JSON.stringify(contract.inference)===JSON.stringify(runtime.inference),'Frozen prompt/model/schema differs from production runtime');
    const history=runtime.db.prepare('SELECT * FROM ai_calls ORDER BY created_at,id').all();
    const budgetReference=verifyEvaluationAllocation({allocation,ledgerPath:ledger,history,capMicroUsd:runtime.budget.status().capMicroUsd,reservationMicroUsd:runtime.reservationMicroUsd});
    const directory=resolve(dirname(ledger),'evaluations',args.outputLabel);
    const report=await runEvaluation({fixtures,contract,outputLabel:args.outputLabel,directory,execute:runtime.execute,limit:args.limit,resume:args.resume,evidenceMode:'live_provider',fixtureIdentity:hash(bytes),reportMetadata:()=>({budgetReference,budgetAfter:runtime.budget.status()})});
    return {mode:'live_provider',report:report.reportFile,cases:report.cases,items:report.items,metricsPass:report.metricsPass,releaseBPassed:false,budgetAfter:report.budgetAfter};
  } finally {await runtime?.close();runtime?.db.close();}
}
