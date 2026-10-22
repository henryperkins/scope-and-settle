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
async function send(id, signature = 'valid') {
  return fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'paypal-transmission-id':'test',
    'paypal-transmission-time':new Date().toISOString(), 'paypal-transmission-sig':signature,
    'paypal-auth-algo':'SHA256withRSA', 'paypal-cert-url':'https://api.paypal.com/test-cert' },
    body:JSON.stringify({ id, event_type:'INVOICING.INVOICE.PAID', resource:{ id:order.paypalInvoiceId } }) });
}
test('webhooks require verification and event names alone cannot mark an invoice paid', async()=> {
  assert.equal((await send('invalid','bad')).status,401);
  assert.equal((await send('pending')).status,200);
  assert.notEqual(orders.getChangeOrder(order.id).status,'paid');
});
test('verified payment reconciles provider details and duplicate events do not add observations', async()=> {
  const invoice=provider.invoices.get(order.paypalInvoiceId); invoice.status='PAID'; invoice.due_amount.value='0.00';
  assert.equal((await send('paid')).status,200);
  assert.equal(orders.getChangeOrder(order.id).status,'paid');
  const count=db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n;
  assert.equal((await send('paid')).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?').get(order.id).n,count);
});
test('a late verified event after reset is acknowledged through the invoice tombstone', async()=> {
  orders.resetDemoRun();
  const response=await send('late');
  assert.equal(response.status,200);
  assert.equal((await response.json()).state,'tombstoned');
  assert.equal(orders.getChangeOrder(order.id),null);
});
