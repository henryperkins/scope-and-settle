import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';

test('publication and payment refresh preserve the provider recipient URL and opaque fragment', async t => {
  const app = await isolatedApp();
  const orders = await app.load('orders');
  const { db } = await app.load('db');
  t.after(() => db.close());
  const provider = providerFixture();
  const recipientUrl = 'https://www.sandbox.paypal.com/invoice/p/#OPAQUE-RECIPIENT-TOKEN';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const response = await provider.fetch(url, init);
    if (new URL(url).pathname.endsWith('/send') && response.ok) {
      for (const invoice of provider.invoices.values()) {
        invoice.detail.metadata = { recipient_view_url: recipientUrl };
        invoice.links = [{ rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/' + invoice.id }];
      }
    }
    return response;
  });
  let order = orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
  orders.approveChangeOrder(order.id, { changeOrderId: order.id, changeOrderRevision: order.revision });
  order = await orders.ensureInvoice(order.id);
  assert.equal(order.invoiceUrl, recipientUrl);
  assert.equal((await orders.refreshPaymentStatus(order.id)).invoiceUrl, recipientUrl);
  assert.equal(provider.counts().creates, 1);
});
