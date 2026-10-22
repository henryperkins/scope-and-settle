import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp } from './helpers.mjs';
const app = await isolatedApp();
const { db, getProject } = await app.load('db');
const { aiBudget } = await app.load('aiBudget');
after(() => db.close());

test('the AI cap survives a fresh module instance and refuses invalid reservations', async () => {
  assert.throws(() => aiBudget.reserve(-1), /invalid/i);
  const reservation = aiBudget.reserve(24_000_000);
  assert.ok(reservation);
  reservation.release(24_000_000);
  const fresh = await import(new URL('../dist/backend/aiBudget.js', new URL('file:///' + app.app.replaceAll('\\', '/') + '/tests/')).href + '?fresh');
  assert.equal(fresh.aiBudget.reserve(2_000_000), null);
});

test('model output rejects fabricated clause quotes and amounts', async () => {
  const ai = await app.load('assessment');
  const project = getProject();
  const result = { classification: 'new_work', explanation: 'Mobile is excluded.', evidence: [{ clauseId: 'desktop-1', quote: 'Invented quotation' }],
    deliverables: ['Mobile checkout'], rates: [{ rateCardId: 'mobile_checkout', quantity: 1 }], questions: [], designObservations: [] };
  assert.throws(() => ai.validateAssessment(result, project), /evidence|quote/i);
  result.evidence[0].quote = project.scopeClauses[0].text;
  const good = ai.validateAssessment(result, project);
  assert.equal(good.proposedTotalMinor, 25000);
  result.rates[0].unitAmountMinor = 1;
  assert.throws(() => ai.validateAssessment(result, project), /amount|unexpected/i);
});
