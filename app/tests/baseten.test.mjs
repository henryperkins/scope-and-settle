import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp } from './helpers.mjs';

const app = await isolatedApp();
const { db, getProject } = await app.load('db');
const { assess } = await app.load('assessment');
const { aiBudget } = await app.load('aiBudget');
const { basetenModel } = await app.load('baseten');
after(() => db.close());

const project = getProject();
const input = { project, comment: { id: 'synthetic-comment', message: 'Can you add the mobile checkout?' }, replies: [],
  imageDataUrl: 'data:image/png;base64,aW1hZ2U=' };
const result = { classification: 'new_work', explanation: 'The brief explicitly excludes mobile layouts.',
  evidence: [{ clauseId: project.scopeClauses[0].id, quote: project.scopeClauses[0].text }],
  deliverables: ['Mobile checkout'], rates: [{ rateCardId: 'mobile_checkout', quantity: 1 }], questions: [], designObservations: [] };
const responseBody = () => ({ model: basetenModel.id, choices: [{ finish_reason: 'stop', message: {
  content: JSON.stringify(result), reasoning_content: 'PRIVATE REASONING SENTINEL',
} }], usage: { prompt_tokens: 1000, completion_tokens: 500,
  completion_tokens_details: { reasoning_tokens: 400 }, prompt_tokens_details: { cached_tokens: 200 } } });

test('Baseten uses max reasoning, strict JSON and vision; accounts for reasoning once without persisting it', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(url, 'https://inference.baseten.co/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer baseten-test-only');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, basetenModel.id);
    assert.equal(body.reasoning_effort, 'max');
    assert.equal(body.max_tokens, 16384);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.type, 'json_schema');
    const branches = body.response_format.json_schema.schema.anyOf;
    assert.equal(branches.find(x => x.properties.classification.enum[0] === 'new_work').properties.evidence.minItems, 1);
    assert.equal(branches.find(x => x.properties.classification.enum[0] === 'included').properties.rates.maxItems, 0);
    const clarification = branches.find(x => x.properties.classification.enum[0] === 'needs_clarification');
    assert.equal(clarification.properties.questions.minItems, 1);
    assert.equal(clarification.properties.rates.maxItems, 0);
    assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'low' } });
    assert.equal('reasoning' in body, false);
    return Response.json(responseBody());
  });
  const before = aiBudget.status().spentMicroUsd;
  const record = await assess(input, 'provider-test');
  assert.equal(record.result.proposedTotalMinor, 25000);
  assert.equal(record.provider, 'baseten');
  assert.equal(record.reasoningEffort, 'max');
  assert.equal(record.usage.reasoningTokens, 400);
  assert.equal(aiBudget.status().spentMicroUsd - before, 1800);
  const saved = db.prepare('SELECT result_json FROM assessments WHERE id = ?').get(record.id).result_json;
  assert.equal(saved.includes('PRIVATE REASONING SENTINEL'), false);
  assert.equal(calls, 1);
});

test('truncated JSON is rejected, still charged for usage, and never retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const body = responseBody(); body.choices[0].finish_reason = 'length';
    return Response.json(body);
  });
  const before = aiBudget.status().spentMicroUsd;
  const rowsBefore = db.prepare('SELECT count(*) AS n FROM assessments').get().n;
  await assert.rejects(assess(input, 'provider-test'), /did not complete/);
  assert.equal(aiBudget.status().spentMicroUsd - before, 1800);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assessments').get().n, rowsBefore);
  assert.equal(calls, 1);
});

test('unknown usage conservatively retains the reservation on a provider error', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: { message: 'SECRET ECHO SENTINEL' } }, { status: 402 });
  });
  const before = aiBudget.status().spentMicroUsd;
  await assert.rejects(assess(input, 'provider-test'), { message: 'Baseten returned HTTP 402; request was not retried' });
  const bound = aiBudget.estimate(basetenModel.contextTokens, basetenModel.maxOutputTokens, basetenModel.inputRatePerMTok, basetenModel.outputRatePerMTok);
  assert.equal(aiBudget.status().spentMicroUsd - before, bound);
  assert.equal(aiBudget.status().reservedMicroUsd, 0);
  assert.equal(calls, 1);
});

test('invalid agreement evidence cannot become a proposal even in a successful provider response', async t => {
  t.mock.method(globalThis, 'fetch', async () => {
    const body = responseBody();
    body.choices[0].message.content = JSON.stringify({ ...result, evidence: [{ clauseId: 'desktop-1', quote: 'Invented agreement' }] });
    return Response.json(body);
  });
  const rowsBefore = db.prepare('SELECT count(*) AS n FROM assessments').get().n;
  await assert.rejects(assess(input, 'provider-test'), error => {
    assert.match(error.message, /evidence quote/);
    assert.match(error.finalOutput, /Invented agreement/);
    assert.equal(error.finalOutput.includes('PRIVATE REASONING SENTINEL'), false);
    return true;
  });
  assert.equal(db.prepare('SELECT count(*) AS n FROM assessments').get().n, rowsBefore);
});

test('automatic output constrains agreement IDs and requires a priced deliverable or clarification', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    const branches = body.response_format.json_schema.schema.anyOf;
    for (const branch of branches) {
      assert.deepEqual(branch.properties.evidence.items.properties.clauseId.enum, project.scopeClauses.map(c => c.id));
    }
    const priced = branches.find(x => x.properties.classification.enum[0] === 'new_work');
    assert.equal(priced.properties.deliverables.minItems, 1);
    assert.deepEqual(priced.properties.deliverables.items.enum, project.rateCard.map(r => r.description));
    assert.equal(priced.properties.rates.minItems, 1);
    assert.deepEqual(priced.properties.rates.items.properties.rateCardId.enum, project.rateCard.map(r => r.id));
    assert.equal(priced.properties.questions.maxItems, 0);
    const output = {...result, deliverables:[project.rateCard[0].description], automation:{allRequestsCovered:true,unpricedComponents:[],coverage:[{requestQuote:input.comment.message,deliverableIndex:0,rateCardId:'mobile_checkout',quantity:1}]}};
    const response = responseBody();response.choices[0].message.content=JSON.stringify(output);return Response.json(response);
  });
  const record=await assess({...input,imageDataUrl:undefined,automation:true},'provider-test');
  assert.equal(record.result.deliverables.length,1);
  assert.equal(record.result.proposedTotalMinor,25000);
});
