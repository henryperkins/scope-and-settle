import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAccessToken } from '../../app/dist/backend/paypal.js';
import { config, paypalBase, PROJECT_ROOT } from '../../app/dist/backend/env.js';
import { ensureWebhookLookup } from './webhook-lookup.mjs';

const origin = new URL(process.argv[2] || '');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('Provide an HTTPS origin');
const callback = new URL('/webhooks/paypal', origin).href;
const health = await fetch(new URL('/health', origin));
if (!health.ok || !(await health.json()).ok) throw new Error('Hosted application is not ready');
const token = await getAccessToken();
async function api(path, init = {}) {
  const r = await fetch(paypalBase + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`PayPal webhook operation failed: HTTP ${r.status}`);
  return r.json();
}
const available = await api('/v1/notifications/webhooks-event-types');
const names = available.event_types.map(x => x.name).filter(x => x.startsWith('INVOICING.INVOICE.')).sort();
if (!names.includes('INVOICING.INVOICE.PAID')) throw new Error('Required invoice event unavailable');
const existing = await api('/v1/notifications/webhooks');
const matches = (existing.webhooks || []).filter(x => {
  const url = new URL(x.url); return url.origin === origin.origin && url.pathname === '/webhooks/paypal';
});
if (matches.length > 1) throw new Error('Duplicate callback subscriptions require review');
const hook = matches[0] || await api('/v1/notifications/webhooks', { method: 'POST', body: JSON.stringify({ url: callback, event_types: names.map(name => ({ name })) }) });
if (!hook.id || names.some(name => !hook.event_types.some(x => x.name === name))) throw new Error('Subscription does not cover the expected invoice events');
const lookup = await ensureWebhookLookup(api, config.paypalClientId);
const path = resolve(PROJECT_ROOT, 'output/gcp/private/runtime.env');
const environment = readFileSync(path, 'utf8').replace(/^PAYPAL_WEBHOOK_ID=.*\r?\n?/gm, '');
writeFileSync(path, environment.trimEnd() + `\nPAYPAL_WEBHOOK_ID=${hook.id}\n`, { mode: 0o600 });
const record = { id: hook.id, url: hook.url, eventTypes: hook.event_types.map(x => x.name), lookup, created: !matches.length, checkedAt: new Date().toISOString() };
writeFileSync(resolve(PROJECT_ROOT, 'output/gcp/paypal-webhook.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
