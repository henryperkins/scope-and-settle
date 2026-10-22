import { test, after } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';
const app = await isolatedApp();
const { db } = await app.load('db');
const orders = await app.load('orders');
const provider = providerFixture(), originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => new URL(url).hostname === '127.0.0.1' ? originalFetch(url, init) : provider.fetch(url, init);
const { server } = await app.load('server');
if (!server.listening) await once(server, 'listening');
after(async()=> { await new Promise(r=>server.close(r)); globalThis.fetch=originalFetch; db.close(); });
const url = 'http://127.0.0.1:' + server.address().port + '/webhooks/paypal';
let order = orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
orders.approveChangeOrder(order.id, { changeOrderId:order.id, changeOrderRevision:order.revision });
order = await orders.ensureInvoice(order.id);
async function send(id, signature = 'valid', resource = { id:order.paypalInvoiceId }) {
  return fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'paypal-transmission-id':'test',
    'paypal-transmission-time':new Date().toISOString(), 'paypal-transmission-sig':signature,
    'paypal-auth-algo':'SHA256withRSA', 'paypal-cert-url':'https://api.paypal.com/test-cert' },
    body:JSON.stringify({ id, event_type:'INVOICING.INVOICE.PAID', resource }) });
}
test('webhooks require verification and event names alone cannot mark an invoice paid', async()=> {
  assert.equal((await send('invalid','bad')).status,401);
  assert.equal((await send('pending')).status,200);
  assert.notEqual(orders.getChangeOrder(order.id).status,'paid');
});

test('actual nested invoice payloads reconcile only after signature verification', async()=> {
  const resource={ invoice:{ id:order.paypalInvoiceId, status:'PAID' } };
  const before=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n;
  assert.equal((await send('nested-invalid','bad',resource)).status,401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,before);
  const response=await send('nested-valid','valid',resource);
  assert.equal((await response.json()).state,'reconciled');
  assert.notEqual(orders.getChangeOrder(order.id).status,'paid','Only the authoritative invoice GET can establish payment');
  assert.equal(db.prepare('SELECT invoice_id FROM webhook_receipts WHERE id=?').get('nested-valid').invoice_id,order.paypalInvoiceId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,before+1);
});
test('verified payment reconciles provider details and duplicate events do not add observations', async()=> {
  const invoice=provider.invoices.get(order.paypalInvoiceId); invoice.status='PAID'; invoice.due_amount.value='0.00';
  assert.equal((await send('paid')).status,200);
  assert.equal(orders.getChangeOrder(order.id).status,'paid');
  const count=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n;
  assert.equal((await send('paid')).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,count);
});

test('a previously ignored nested invoice event can be replayed once after the parser upgrade', async()=> {
  db.prepare("INSERT INTO webhook_receipts (id,state) VALUES (?,'ignored')").run('previously-ignored');
  const resource={ invoice:{ id:order.paypalInvoiceId } };
  assert.equal((await (await send('previously-ignored','valid',resource)).json()).state,'reconciled');
  const count=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n;
  assert.equal((await (await send('previously-ignored','valid',resource)).json()).state,'duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,count);
});
test('a late verified event after reset is acknowledged through the invoice tombstone', async()=> {
  orders.resetDemoRun();
  const response=await send('late');
  assert.equal(response.status,200);
  assert.equal((await response.json()).state,'tombstoned');
  assert.equal((await (await send('late-nested','valid',{ invoice:{ id:order.paypalInvoiceId } })).json()).state,'tombstoned');
  assert.equal(orders.getChangeOrder(order.id),null);
});
