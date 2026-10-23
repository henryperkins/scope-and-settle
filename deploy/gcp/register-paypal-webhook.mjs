import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAccessToken } from '../../app/dist/backend/paypal.js';
import { config, paypalBase, PROJECT_ROOT } from '../../app/dist/backend/env.js';
import { ensureWebhookLookup } from './webhook-lookup.mjs';
import { webhookTargets, ensureInvoiceWebhook } from './webhook-subscription.mjs';

const path = resolve(PROJECT_ROOT, 'output/gcp/private/runtime.env');
const environment = readFileSync(path, 'utf8');
const {origin, callback} = webhookTargets(process.argv[2] || '', process.argv[3], environment);
const webhookId = process.argv[4] || environment.match(/^PAYPAL_WEBHOOK_ID=(.+)$/m)?.[1].trim() || config.paypalWebhookId;
const health = await fetch(new URL('/health', origin), {signal:AbortSignal.timeout(20000)});
if (!health.ok || !(await health.json()).ok) throw new Error('Hosted application is not ready');
const token = await getAccessToken();
async function api(path, init = {}) {
  const r = await fetch(paypalBase + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal:AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`PayPal webhook operation failed: HTTP ${r.status}`);
  return r.json();
}
const available = await api('/v1/notifications/webhooks-event-types');
const names = available.event_types.map(x => x.name).filter(x => x.startsWith('INVOICING.INVOICE.')).sort();
if (!names.includes('INVOICING.INVOICE.PAID')) throw new Error('Required invoice event unavailable');
const lookup = await ensureWebhookLookup(api, config.paypalClientId);
const {hook, created, updated} = await ensureInvoiceWebhook(api, {callback, names, webhookId});
const cleaned = environment.replace(/^PAYPAL_WEBHOOK_(?:ID|URL)=.*\r?\n?/gm, '');
writeFileSync(path, cleaned.trimEnd() + `\nPAYPAL_WEBHOOK_ID=${hook.id}\nPAYPAL_WEBHOOK_URL=${callback}\n`, { mode: 0o600 });
const record = { id: hook.id, url: hook.url, eventTypes: hook.event_types.map(x => x.name), lookup, created, updated, checkedAt: new Date().toISOString() };
writeFileSync(resolve(PROJECT_ROOT, 'output/gcp/paypal-webhook.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
