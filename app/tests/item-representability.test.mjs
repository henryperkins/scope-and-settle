import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';

const app = await isolatedApp(), orders = await app.load('orders'), { db } = await app.load('db');
const provider = providerFixture(), originalFetch = globalThis.fetch;
globalThis.fetch = provider.fetch;
after(() => { globalThis.fetch = originalFetch; db.close(); });
const description = 'D'.repeat(1000), oversized = description + 'X';
const input = (text = description) => ({ ...draftInput(), lineItems: [{ description: text, quantity: 2, unitAmountMinor: 12500, priceSource: 'designer', rateCardId: null }] });
const session = order => ({ changeOrderId: order.id, changeOrderRevision: order.revision });
function state(id) {
  return {
    order: db.prepare('SELECT * FROM change_orders WHERE id=?').get(id),
    snapshots: db.prepare('SELECT * FROM proposal_revisions WHERE change_order_id=?').all(id),
    approvals: db.prepare('SELECT * FROM approvals WHERE change_order_id=?').all(id),
    operations: db.prepare('SELECT * FROM invoice_operations WHERE change_order_id=?').all(id),
    provider: provider.counts(),
  };
}
function legacyTerms(order, { row = true, snapshot = true } = {}) {
  const items = input(oversized).lineItems;
  if (row) db.prepare('UPDATE change_orders SET line_items_json=? WHERE id=?').run(JSON.stringify(items), order.id);
  if (snapshot) {
    const saved = db.prepare('SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?').get(order.id, order.revision);
    if (saved) db.prepare('UPDATE proposal_revisions SET snapshot_json=? WHERE change_order_id=? AND revision=?').run(JSON.stringify({ ...JSON.parse(saved.snapshot_json), lineItems: items }), order.id, order.revision);
  }
}

test('1000-character approved description survives provider creation without truncation', async () => {
  const order = orders.submitForApproval(orders.createChangeOrder(input()).id);
  orders.approveChangeOrder(order.id, session(order));
  const invoiced = await orders.ensureInvoice(order.id), item = provider.invoices.get(invoiced.paypalInvoiceId).items[0];
  assert.deepEqual(item, { name: 'D'.repeat(200), description, quantity: '2', unit_amount: { currency_code: 'USD', value: '125.00' } });
  assert.equal(invoiced.totalMinor, 25000);
});

test('oversized designer draft is rejected before creating any row', () => {
  const before = db.prepare('SELECT count(*) n FROM change_orders').get().n, calls = provider.counts();
  assert.throws(() => orders.createChangeOrder(input(oversized)), /description|represent/i);
  assert.equal(db.prepare('SELECT count(*) n FROM change_orders').get().n, before);
  assert.deepEqual(provider.counts(), calls);
});

test('oversized edit leaves proposal terms and revision untouched', () => {
  const order = orders.submitForApproval(orders.createChangeOrder(input()).id), before = state(order.id);
  assert.throws(() => orders.editChangeOrder(order.id, { lineItems: input(oversized).lineItems }), /description|represent/i);
  assert.deepEqual(state(order.id), before);
});

test('legacy oversized draft cannot submit or gain a snapshot', () => {
  const order = orders.createChangeOrder(input()); legacyTerms(order);
  const before = state(order.id);
  assert.throws(() => orders.submitForApproval(order.id), /description|represent/i);
  assert.deepEqual(state(order.id), before);
});

for (const [name, options] of [['row and snapshot', {}], ['snapshot only', { row: false }], ['row only', { snapshot: false }]]) {
  test(`legacy oversized pending ${name} cannot acquire approval or financial state`, () => {
    const order = orders.submitForApproval(orders.createChangeOrder(input()).id); legacyTerms(order, options);
    const before = state(order.id);
    assert.throws(() => orders.approveChangeOrder(order.id, session(order)), /description|represent/i);
    assert.deepEqual(state(order.id), before);
  });
}

test('legacy invalid approved itemized terms preserve history and status when invoice preparation rejects', async () => {
  const order = orders.submitForApproval(orders.createChangeOrder(input()).id);
  orders.approveChangeOrder(order.id, session(order)); legacyTerms(order);
  const before = state(order.id);
  assert.equal(orders.approveChangeOrder(order.id, session(order)).approvalStatus, 'approved');
  await assert.rejects(orders.ensureInvoice(order.id), /description|represent/i);
  assert.deepEqual(state(order.id), before);
});

test('legacy aggregate invoice with oversized source items keeps its identity and retry access', async () => {
  const order = orders.submitForApproval(orders.createChangeOrder(input()).id);
  orders.approveChangeOrder(order.id, session(order));
  const invoiced = await orders.ensureInvoice(order.id), body = provider.invoices.get(invoiced.paypalInvoiceId);
  legacyTerms(order);
  db.prepare("UPDATE invoice_operations SET representation='aggregate-v0',approved_terms_json=NULL WHERE change_order_id=?").run(order.id);
  const legacyDescription = order.deliverables.join('; ');
  body.items = [{ name: legacyDescription.slice(0,120), description: legacyDescription.slice(0,1000), quantity: '1', unit_amount: { currency_code: 'USD', value: '250.00' } }];
  delete body.detail.reference;
  const before = state(order.id);
  assert.equal(orders.approveChangeOrder(order.id, session(order)).approvalStatus, 'approved');
  const retried = await orders.ensureInvoice(order.id);
  assert.equal(retried.paypalInvoiceId, invoiced.paypalInvoiceId);
  assert.equal(retried.financialState.representation, 'aggregate-v0');
  assert.deepEqual(state(order.id).snapshots, before.snapshots);
  assert.deepEqual(state(order.id).approvals, before.approvals);
  assert.deepEqual(provider.counts(), before.provider);
});
