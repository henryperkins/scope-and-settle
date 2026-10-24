import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './source-freshness-fixture.mjs';

async function setup() {
  const f = await fixture(); f.root('card-root', 'Gallery alpha screen');
  const {assessment} = await f.assessThread('card-root');
  const drafted = await f.draft([assessment.result.items[0].id], 'card-draft', assessment.id);
  assert.equal(drafted.status, 201, JSON.stringify(drafted.body)); f.order = drafted.body;
  f.path = '/api/change-orders/' + f.order.id + '/status-card?revision=' + f.order.revision;
  return f;
}
const leak = /ssc1\.|demo:(session|grant)|merchant@example|buyer@example|invoiceUrl|approvalUrl|\/review#|resume=|recipient|lineItems|totalMinor|amountDueMinor|currency/;

test('T12b hidden monetary policy also redacts monetary text in titles and deliverables', async () => {
  const f = await setup();
  try {
    f.db.prepare('UPDATE change_orders SET title=?,deliverables_json=? WHERE id=?').run('Gallery for USD 250.00', JSON.stringify(['A gallery screen for $250', 'Two USD 50 components']), f.order.id);
    const response = await f.http(f.path);
    assert.equal(response.status, 200); assert.equal(response.body.money, null);
    assert.doesNotMatch(JSON.stringify([response.body.title,response.body.deliverables]), /USD|\$250|50|250\.00/);
    assert.match(response.body.title, /hidden/);
    await f.http('/api/project/card-display', 'POST', {showAmounts: true, expectedVersion: 0, consent: true}, f.session.token, {Origin: f.base});
    assert.equal((await f.http(f.path)).body.title, 'Gallery for USD 250.00');
  } finally { await f.close(); }
});

test('T12b status projection authenticates exact order/run/revision, defaults money off and performs no work', async () => {
  const f = await setup();
  try {
    const before = f.counts(), view = await f.http(f.path);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.schemaVersion, 1); assert.equal(view.body.orderId, f.order.id); assert.equal(view.body.runId, f.ctx.runId);
    assert.equal(view.body.scope.approved, false); assert.equal(view.body.approvalState, 'draft');
    assert.equal(view.body.deliveryState, 'not_recorded'); assert.equal(view.body.money, null);
    assert.deepEqual(view.body.displayPolicy, {version: 0, showAmounts: false}); assert.equal(view.body.paymentObservedAt, null);
    assert.ok(Date.parse(view.body.appReadAt)); assert.doesNotMatch(JSON.stringify(view.body), leak);
    const url = new URL(view.body.appUrl); assert.equal(url.origin, f.base); assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams.keys()], ['order', 'run']);
    assert.deepEqual(f.counts(), before);
    assert.equal((await f.http(f.path, 'GET', undefined, null)).status, 401);
    assert.equal((await f.http(f.path.replace(/revision=\d+/, 'revision=2'))).status, 409);
    assert.equal((await f.http(f.path + '&refresh=true')).status, 400);
    const other = f.m.judging ?? await f.app.load('judging'); const access = other.createJudgeAccess(), run = other.startJudgeRun(access.credential);
    assert.equal((await f.http(f.path, 'GET', undefined, run.token)).status, 403);
  } finally { await f.close(); }
});

test('T12b monetary settings require application consent and optimistic version, are run-isolated and redact again after disabling', async () => {
  const f = await setup();
  try {
    const path = '/api/project/card-display', originalCounts = f.provider.counts();
    assert.equal((await f.http(path, 'POST', {showAmounts: true, expectedVersion: 0, consent: true})).status, 403);
    assert.equal((await f.http(path, 'POST', {showAmounts: true, expectedVersion: 0, consent: true}, f.session.token, {Origin: 'https://www.figma.com'})).status, 403);
    const saved = await f.http(path, 'POST', {showAmounts: true, expectedVersion: 0, consent: true}, f.session.token, {Origin: f.base});
    assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.version, 1);
    const enabled = (await f.http(f.path)).body; assert.equal(enabled.money.currency, 'USD'); assert.equal(enabled.money.totalMinor, 25000);
    assert.equal((await f.http(path, 'POST', {showAmounts: false, expectedVersion: 0, consent: true}, f.session.token, {Origin: f.base})).status, 409);
    const other = await f.app.load('judging'), access = other.createJudgeAccess(), run = other.startJudgeRun(access.credential);
    assert.equal((await f.http(path, 'GET', undefined, run.token)).body.showAmounts, false);
    const off = await f.http(path, 'POST', {showAmounts: false, expectedVersion: 1, consent: true}, f.session.token, {Origin: f.base});
    assert.equal(off.status, 200); assert.equal(off.body.version, 2);
    assert.doesNotMatch(JSON.stringify((await f.http(f.path)).body), leak); assert.deepEqual(f.provider.counts(), originalCounts);
    assert.equal(f.db.prepare('SELECT id FROM schema_migrations WHERE id=11').get().id, 11);
  } finally { await f.close(); }
});

test('T12b cached card reads retain provider observation time and never equate paid with delivered', async () => {
  const f = await setup();
  try {
    f.service.submitScopedOrder(f.ctx, f.order.id);
    f.orders.approveChangeOrder(f.order.id, {changeOrderId: f.order.id, changeOrderRevision: f.order.revision});
    await f.orders.ensureInvoice(f.order.id);
    const id = f.orders.getChangeOrder(f.order.id).paypalInvoiceId, invoice = f.provider.invoices.get(id);
    invoice.status = 'PAID'; invoice.due_amount.value = '0.00';
    invoice.payments = {paid_amount: {currency_code: 'USD', value: '250.00'}, transactions: [{payment_id: 'fixture-payment-one', type: 'PAYPAL', status: 'SUCCESS', amount: {currency_code: 'USD', value: '250.00'}}]};
    const order = await f.orders.refreshPaymentStatus(f.order.id), before = f.counts();
    const first = await f.http(f.path), second = await f.http(f.path);
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.paymentState, 'paid');
    assert.equal(first.body.deliveryState, 'not_recorded'); assert.equal(first.body.scope.approved, true);
    assert.equal(first.body.paymentObservedAt, order.financialState.observedAt);
    assert.equal(second.body.paymentObservedAt, first.body.paymentObservedAt);
    assert.ok(second.body.projectionVersion > first.body.projectionVersion); assert.deepEqual(f.counts(), before);
  } finally { await f.close(); }
});
