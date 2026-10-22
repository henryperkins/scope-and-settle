import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = 'https://scope-and-settle.hperkins.com';
const directory = resolve('output/gcp');
const statePath = resolve(directory, 'private/verification-session.json');
const mode = process.argv[2];
const request = async (path, { token, body, method = 'GET', expected = 200 } = {}) => {
  const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(30_000), headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response.json();
};

assert.equal((await request('/health')).ok, true);
for (const path of ['/api/project', '/api/comments', '/api/change-orders']) await request(path, { expected: 401 });
await request('/webhooks/paypal', { method: 'POST', body: {}, expected: 401 });

if (mode === 'prepare') {
  assert.equal(existsSync(statePath), false, 'Refusing to create a duplicate verification run');
  const link = readFileSync(resolve(directory, 'private/designer-link.txt'), 'utf8').split(/\r?\n/)[0];
  const session = await request('/api/session/redeem', { method: 'POST', body: { invitation: new URL(link).hash.slice(1) } });
  const project = await request('/api/project', { token: session.token });
  const comments = await request('/api/comments', { token: session.token });
  const budget = await request('/api/ai-budget', { token: session.token });
  const rate = project.rateCard.find(x => x.id === 'mobile_checkout');
  assert.ok(rate);
  const order = await request('/api/change-orders', { method: 'POST', token: session.token, expected: 201,
    body: { title: 'Manual hosting check: mobile checkout', deliverables: ['Design one mobile checkout screen; synthetic deployment verification.'], currency: 'USD',
      lineItems: [{ rateCardId: rate.id, description: rate.description, quantity: 1, unitAmountMinor: 1, priceSource: 'rate_card' }] } });
  assert.equal(order.totalMinor, rate.unitAmountMinor, 'Server must resolve the actual rate-card price');
  const submitted = await request(`/api/change-orders/${order.id}/submit`, { method: 'POST', token: session.token });
  await request(`/api/change-orders/${order.id}/approve`, { method: 'POST', token: session.token, expected: 403 });
  writeFileSync(statePath, JSON.stringify({ session, orderId: order.id, revision: submitted.order.revision, budget, approvalUrl: submitted.approvalUrl }, null, 2), { mode: 0o600 });
  const record = { checkedAt: new Date().toISOString(), health: true, anonymousDenied: 3, unsignedWebhookDenied: true,
    designerCannotApprove: true, figmaCommentCount: comments.comments.length, rateCardPriceMinor: order.totalMinor,
    orderId: order.id, revision: submitted.order.revision, aiBudget: budget, aiCalled: false, invoiceCreated: false };
  writeFileSync(resolve(directory, 'hosted-before-restart.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
} else if (mode === 'verify') {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const order = await request(`/api/change-orders/${state.orderId}`, { token: state.session.token });
  const budget = await request('/api/ai-budget', { token: state.session.token });
  assert.equal(order.revision, state.revision);
  assert.equal(order.totalMinor, 25_000);
  assert.deepEqual(budget, state.budget);
  const record = { checkedAt: new Date().toISOString(), sessionRetained: true, orderRetained: true, budgetUnchanged: true,
    orderId: order.id, revision: order.revision, status: order.status, paypalInvoiceId: order.paypalInvoiceId, paymentStatus: order.paymentStatus };
  writeFileSync(resolve(directory, 'hosted-after-restart.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
} else {
  throw new Error('Use prepare once, then verify after restarting the hosted app');
}
