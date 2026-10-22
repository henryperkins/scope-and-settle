import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assess } from '../dist/backend/assessment.js';
import { aiBudget } from '../dist/backend/aiBudget.js';
import { db } from '../dist/backend/db.js';
import { config } from '../dist/backend/env.js';
const fixtures = JSON.parse(await readFile(resolve('../fixtures/scope-judgment-cases.json'), 'utf8'));
const stamp = new Date().toISOString();
const results = [];
for (const c of fixtures.cases) {
  const baseline = fixtures.baselines.find(x => x.id === c.baseline_id);
  const project = { id: 'demo', name: 'Synthetic scope evaluation', figmaFileKey: '', currency: 'USD',
    scopeRevisionId: baseline.id, scopeClauses: baseline.clauses,
    rateCard: fixtures.rate_card.map(r => ({ id: r.id, description: r.description, unitAmountMinor: r.unit_amount_minor })) };
  const started = Date.now();
  try {
    const record = await assess({ project, comment: { id: c.id, message: c.comment }, replies: [], designContext: fixtures.design_evidence.description }, 'evaluation-' + stamp);
    const r = record.result;
    const checks = { classification: r.classification === c.expected_classification,
      evidence: !c.required_evidence_id || r.evidence.some(e => e.clauseId === c.required_evidence_id),
      rates: JSON.stringify(r.rates.map(x => x.rateCardId).sort()) === JSON.stringify([...c.expected_rate_card_ids].sort()),
      amount: r.proposedTotalMinor === (c.expected_proposed_amount_minor ?? 0),
      clarification: c.expected_classification !== 'needs_clarification' || r.questions.length > 0 };
    results.push({ caseId: c.id, expected: c.expected_classification, checks, passed: Object.values(checks).every(Boolean), ...record });
    console.log(c.id + ': ' + r.classification + ' (' + record.latencyMs + ' ms), ' + (Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'));
  } catch (error) {
    results.push({ caseId: c.id, passed: false, error: error.message, latencyMs: Date.now() - started });
    console.log(c.id + ': ' + error.message);
    if (/HTTP (401|403|429)|not configured/.test(error.message)) break;
  }
}
const report = { at: stamp, model: config.aiModel, data: 'synthetic text fixtures; no real frame image',
  semanticEvidenceReview: 'Required separately: a valid quotation and clause ID do not prove correct reasoning.',
  total: fixtures.cases.length, attempted: results.length, passed: results.filter(x => x.passed).length,
  budget: aiBudget.status(), results };
const dir = resolve('../output/evaluations');
await mkdir(dir, { recursive: true });
const path = resolve(dir, 'ai-' + stamp.replaceAll(':', '-') + '.json');
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path, passed: report.passed, attempted: report.attempted, total: report.total, budget: report.budget }));
db.close();
if (report.passed !== report.total) process.exitCode = 1;
