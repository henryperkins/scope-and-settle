import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';

const app = await isolatedApp();
const orders = await app.load('orders');
const { db, getProject, updateScopeBaseline } = await app.load('db');
const provider = providerFixture();
const originalFetch = globalThis.fetch;
globalThis.fetch = provider.fetch;
after(() => { globalThis.fetch = originalFetch; db.close(); });

function approved() {
  let order = orders.createChangeOrder(draftInput());
  order = orders.submitForApproval(order.id);
  return orders.approveChangeOrder(order.id, { changeOrderId: order.id, changeOrderRevision: order.revision });
}

test('a stale invitation stays invalid after designer resubmits against a new baseline', () => {
  let order = orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
  const old = { changeOrderId: order.id, changeOrderRevision: order.revision };
  updateScopeBaseline([...getProject().scopeClauses, { id: 'extra', text: 'A new agreed clause.' }]);
  assert.throws(() => orders.approveChangeOrder(order.id, old), /baseline/i);
  order = orders.submitForApproval(order.id);
  assert.throws(() => orders.approveChangeOrder(order.id, old), /revision/i);
  assert.equal(orders.approveChangeOrder(order.id, { ...old, changeOrderRevision: order.revision }).status, 'approved');
});

test('approved terms cannot be edited or submitted again', () => {
  const order = approved();
  assert.throws(() => orders.editChangeOrder(order.id, { title: 'Changed terms' }), /immutable/i);
  assert.throws(() => orders.submitForApproval(order.id), /immutable/i);
  assert.equal(orders.getChangeOrder(order.id).title, 'Mobile checkout');
});

test('retry after failed publication resumes the same created invoice', async () => {
  const order = approved();
  const before = provider.counts().creates;
  provider.failNextSend();
  await assert.rejects(orders.ensureInvoice(order.id), /send/i);
  const resumed = await orders.ensureInvoice(order.id);
  assert.equal(resumed.status, 'payment_due');
  assert.ok(resumed.paypalInvoiceId);
  assert.match(resumed.invoiceUrl, /invoice\/payerView\/details\//);
  assert.equal(provider.counts().creates - before, 1);
});

test('simultaneous invoice actions create one provider invoice', async () => {
  const order = approved();
  const before = provider.counts().creates;
  const result = await Promise.all([orders.ensureInvoice(order.id), orders.ensureInvoice(order.id)]);
  assert.equal(result[0].paypalInvoiceId, result[1].paypalInvoiceId);
  assert.equal(provider.counts().creates - before, 1);
});

test('rate-card pricing is resolved by the backend instead of trusting submitted amounts', () => {
  const input = draftInput();
  input.lineItems[0].unitAmountMinor = 1;
  const order = orders.createChangeOrder(input);
  assert.equal(order.totalMinor, 25000);
  assert.equal(order.lineItems[0].priceSource, 'rate_card');
});

test('a provider PAID result with a mismatched approved amount cannot mark the order paid', async () => {
  const order = await orders.ensureInvoice(approved().id);
  const invoice = provider.invoices.get(order.paypalInvoiceId);
  invoice.status = 'PAID'; invoice.due_amount.value = '0.00'; invoice.amount.value = '1.00';
  assert.equal((await orders.refreshPaymentStatus(order.id)).financialState.paymentState, 'review_required');
  assert.notEqual(orders.getChangeOrder(order.id).status, 'paid');
});

test('invalid edits cannot erase agreed deliverables or produce an empty proposal', () => {
  const order = orders.createChangeOrder(draftInput());
  assert.throws(() => orders.editChangeOrder(order.id, { title: ' ' }), /title/i);
  assert.throws(() => orders.editChangeOrder(order.id, { deliverables: [] }), /deliverables/i);
  assert.equal(orders.getChangeOrder(order.id).revision, 1);
});

test('a resumed draft with a mismatched total is never published', async () => {
  const order = approved();
  provider.failNextSend();
  await assert.rejects(orders.ensureInvoice(order.id), /send/i);
  const invoice = provider.invoices.get(orders.getChangeOrder(order.id).paypalInvoiceId);
  invoice.amount.value = '1.00';
  const sends = provider.counts().sends;
  await assert.rejects(orders.ensureInvoice(order.id), /match|amount/i);
  assert.equal(provider.counts().sends, sends);
});
