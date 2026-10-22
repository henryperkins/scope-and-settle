import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalDefaults } from '../web/proposal.js';
const project = { rateCard: [{ id:'mobile_checkout', unitAmountMinor:25000 }] };

test('new work without a matching AI rate requires a designer-entered price', () => {
  const draft = proposalDefaults(null, { result:{ deliverables:['A new integration design'], lineItems:[] } }, project);
  assert.equal(draft.priceMode, 'custom');
  assert.equal(draft.amount, '');
  assert.equal(draft.title, 'A new integration design');
});

test('reviewing an existing custom proposal preserves its price and additional items', () => {
  const extra = {rateCardId:'mobile_checkout',unitAmountMinor:25000,quantity:1};
  const draft = proposalDefaults({title:'Custom work',deliverables:['Custom deliverable'],lineItems:[
    {rateCardId:null,unitAmountMinor:37000,quantity:2},extra,
  ]}, null, project);
  assert.equal(draft.priceMode, 'custom');
  assert.equal(draft.amount, '370.00');
  assert.equal(draft.quantity, 2);
  assert.deepEqual(draft.preservedItems,[extra]);
});
