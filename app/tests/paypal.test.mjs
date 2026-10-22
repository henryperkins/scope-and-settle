import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture } from './helpers.mjs';
const app = await isolatedApp();
const paypal = await app.load('paypal');
const originalFetch = globalThis.fetch;
const provider = providerFixture({ topLevelCreateLink: true });
globalThis.fetch = provider.fetch;
after(() => { globalThis.fetch = originalFetch; });

test('invoice creation accepts the top-level self link observed in PayPal sandbox', async () => {
  const created = await paypal.createDraftInvoice({ merchantEmail:'merchant@example.com', buyerEmail:'buyer@example.com',
    description:'Synthetic', amountMinor:100, currency:'USD', reference:'fixture-1' });
  assert.equal(created.id, 'INV2-TEST-1');
  assert.equal((await paypal.getInvoice(created.id)).status, 'DRAFT');
  assert.equal(provider.counts().creates, 1);
});
