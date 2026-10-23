import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture } from './helpers.mjs';

test('after UTC midnight an immediate invoice remains payable in the merchant timezone', async t => {
  const app = await isolatedApp();
  const paypal = await app.load('paypal');
  const provider = providerFixture({ merchantToday: '2026-10-22' });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T00:36:00Z') });
  t.mock.method(globalThis, 'fetch', provider.fetch);
  const invoice = await paypal.createDraftInvoice({ merchantEmail:'merchant@example.com',buyerEmail:'buyer@example.com',
    description:'Mobile checkout',amountMinor:25000,currency:'USD',reference:'midnight-regression' });
  await paypal.sendInvoice(invoice.id);
  const published = await paypal.getInvoice(invoice.id);
  assert.equal(published.status,'UNPAID');
  assert.equal(published.totalMinor,25000);
  assert.equal(provider.counts().creates,1);
});
