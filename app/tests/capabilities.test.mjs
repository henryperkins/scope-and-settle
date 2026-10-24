import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as registry from '../dist/backend/capabilities.js';

test('unknown capability is disabled', () => {
  const configured = registry?.createCapabilityRegistry({ sandbox: ['paypal.payouts.create', '__proto__'], live: ['unknown'] });
  for (const id of ['unknown', 'paypal.payouts.create', '__proto__', 'constructor', '']) {
    assert.equal(configured?.getCapability(id, 'sandbox')?.enabled, false);
    assert.equal(configured?.getCapability(id, 'live')?.verifiedAccess, false);
  }
});

test('documented is not verified access', () => {
  const configured = registry?.createCapabilityRegistry({ sandbox: ['paypal.subscriptions.create'] });
  const capability = configured?.getCapability('paypal.subscriptions.create', 'sandbox');
  assert.equal(capability?.evidenceStatus, 'documented');
  assert.equal(capability?.verifiedAccess, false);
  assert.equal(capability?.deploymentEnabled, true);
  assert.equal(capability?.enabled, false);
});

test('sandbox evidence does not enable live', () => {
  const configured = registry?.createCapabilityRegistry({ sandbox: ['paypal.invoices.create'], live: ['paypal.invoices.create'] });
  assert.equal(configured?.getCapability('paypal.invoices.create', 'sandbox')?.enabled, true);
  const live = configured?.getCapability('paypal.invoices.create', 'live');
  assert.equal(live?.evidenceStatus, 'documented');
  assert.equal(live?.verifiedAccess, false);
  assert.equal(live?.enabled, false);
});

test('verified evidence requires explicit environment-specific deployment enablement', () => {
  assert.equal(registry?.getCapability('paypal.invoices.get', 'sandbox')?.verifiedAccess, true);
  assert.equal(registry?.getCapability('paypal.invoices.get', 'sandbox')?.deploymentEnabled, false);
  assert.equal(registry?.getCapability('paypal.invoices.get', 'sandbox')?.enabled, false);
  const configured = registry?.createCapabilityRegistry({ live: ['paypal.invoices.get'] });
  assert.equal(configured?.getCapability('paypal.invoices.get', 'sandbox')?.deploymentEnabled, false);
});

test('synthetic Figma comment evidence does not establish webhook or customer-file access', () => {
  const configured = registry?.createCapabilityRegistry({ sandbox: ['figma.comments.write', 'figma.webhooks.create'], live: ['figma.comments.write'] });
  const comment = configured?.getCapability('figma.comments.write', 'sandbox');
  assert.equal(comment?.enabled, true);
  assert.equal(comment?.evidenceScope, 'configured_synthetic_project');
  assert.equal(configured?.getCapability('figma.webhooks.create', 'sandbox')?.enabled, false);
  assert.equal(configured?.getCapability('figma.comments.write', 'live')?.enabled, false);
});

test('fixture coverage and implementation do not imply verified provider access', () => {
  const search = registry?.getCapability('paypal.invoices.search', 'sandbox');
  assert.equal(search?.implemented, true);
  assert.ok(search?.fixtureEvidenceRefs.includes('app/tests/orders.test.mjs'));
  assert.equal(search?.verifiedAccess, false);
  const nodes = registry?.getCapability('figma.context.nodes', 'sandbox');
  assert.equal(nodes?.implemented, true);
  assert.ok(nodes?.fixtureEvidenceRefs.includes('app/tests/design-evidence.test.mjs'));
  assert.equal(nodes?.verifiedAccess, false);
});

test('T13 reviewed cancellation/reminder implementation metadata preserves default-off provider boundaries', () => {
  for (const id of ['paypal.invoices.cancel','paypal.invoices.remind']) {
    const value = registry.getCapability(id, 'sandbox');
    assert.equal(value.implemented, true);
    assert.ok(value.fixtureEvidenceRefs.includes('app/tests/reviewed-actions.test.mjs'));
    assert.equal(value.verifiedAccess, false); assert.equal(value.enabled, false);
  }
  assert.equal(registry.getCapability('figma.webhooks.create','sandbox').implemented, false);
});

test('selected operations retain exact provider contracts and inventory provenance', () => {
  for (const [id, method, path, operationId] of [
    ['paypal.invoices.search', 'POST', '/v2/invoicing/search-invoices', 'invoices.search-invoices'],
    ['paypal.invoices.cancel', 'POST', '/v2/invoicing/invoices/{invoice_id}/cancel', 'invoices.cancel'],
    ['paypal.webhooks.verify', 'POST', '/v1/notifications/verify-webhook-signature', 'verify-webhook-signature.post'],
    ['paypal.refunds.create', 'POST', '/v2/payments/captures/{capture_id}/refund', 'captures.refund'],
    ['paypal.invoice-refunds.record', 'POST', '/v2/invoicing/invoices/{invoice_id}/refunds', 'invoices.refunds'],
  ]) {
    const capability = registry?.getCapability(id, 'sandbox');
    assert.equal(capability?.method, method);
    assert.equal(capability?.path, path);
    assert.equal(capability?.operationId, operationId);
    assert.equal(capability?.inventoryRef, 'PAYPAL-REST-ENDPOINTS.csv');
    assert.match(capability?.sourceUrl ?? '', /^https:\/\/developer\.paypal\.com\//);
    for (const field of ['checkedAt', 'evidenceRef', 'requiredRole', 'approvalRule', 'retryRule']) assert.ok(capability?.[field]);
  }
});

test('enablement configuration and returned metadata cannot mutate registry policy', () => {
  const settings = { sandbox: ['paypal.invoices.get'] };
  const configured = registry?.createCapabilityRegistry(settings);
  settings.sandbox.push('paypal.invoices.create');
  assert.equal(configured?.getCapability('paypal.invoices.create', 'sandbox')?.deploymentEnabled, false);
  const capability = configured?.getCapability('paypal.invoices.get', 'sandbox');
  assert.ok(Object.isFrozen(capability));
  assert.ok(Object.isFrozen(capability?.fixtureEvidenceRefs));
  assert.equal(registry?.getCapability('paypal.invoices.get', 'sandbox')?.enabled, false);
});

test('invalid runtime environment cannot fall back to sandbox', () => {
  const configured = registry?.createCapabilityRegistry({ sandbox: ['paypal.invoices.get'] });
  assert.equal(configured?.getCapability('paypal.invoices.get', 'production')?.enabled, false);
});
