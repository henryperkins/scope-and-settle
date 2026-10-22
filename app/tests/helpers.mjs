import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Each suite imports a fresh compiled application and uses a fresh SQLite file.
// Never copy or mutate the developer's database or read their provider credentials.
export async function isolatedApp() {
  const root = await mkdtemp(join(tmpdir(), 'scope-settle-test-'));
  const app = join(root, 'app');
  await mkdir(app);
  await cp(fileURLToPath(new URL('../dist', import.meta.url)), join(app, 'dist'), { recursive: true });
  await cp(fileURLToPath(new URL('../web', import.meta.url)), join(app, 'web'), { recursive: true });
  await writeFile(join(app, 'package.json'), '{"type":"module"}');
  for (const [key, value] of Object.entries({
    PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'test-id', PAYPAL_CLIENT_SECRET: 'test-secret',
    PAYPAL_SANDBOX_MERCHANT_EMAIL: 'merchant@example.com', PAYPAL_SANDBOX_BUYER_EMAIL: 'buyer@example.com',
    FIGMA_PERSONAL_ACCESS_TOKEN: 'test-token', FIGMA_FILE_KEY: 'test-file',
    AI_API_KEY: 'test-only', OPENAI_API_KEY: 'test-only', PAYPAL_WEBHOOK_ID: 'test-webhook',
    SCOPE_SETTLE_DATA_DIR: join(app, 'data'), PORT: '0',
  })) process.env[key] = value;
  return { root, app, load: name => import(pathToFileURL(join(app, 'dist/backend', name + '.js')).href) };
}

export function providerFixture({ topLevelCreateLink = false } = {}) {
  const invoices = new Map();
  let creates = 0, sends = 0, failSends = 0;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  return {
    invoices,
    counts: () => ({ creates, sends }),
    failNextSend: () => { failSends++; },
    async fetch(url, init = {}) {
      const u = new URL(url);
      if (u.hostname !== 'api-m.sandbox.paypal.com') throw new Error('Unexpected external request: ' + u.origin);
      if (u.pathname === '/v1/oauth2/token') return reply({ access_token: 'test-token', expires_in: 3600 });
      if (u.pathname === '/v1/notifications/verify-webhook-signature') {
        return reply({ verification_status: JSON.parse(init.body).transmission_sig === 'bad' ? 'FAILURE' : 'SUCCESS' });
      }
      if (u.pathname === '/v2/invoicing/search-invoices') {
        const q = JSON.parse(init.body);
        return reply({ items: [...invoices.values()].filter(x => x.detail.invoice_number === q.invoice_number) });
      }
      if (u.pathname === '/v2/invoicing/invoices' && init.method === 'POST') {
        const data = JSON.parse(init.body);
        const id = 'INV2-TEST-' + (++creates);
        invoices.set(id, {
          id, status: 'DRAFT', detail: data.detail, invoicer: { email_address: 'merchant@example.com' },
          primary_recipients: data.primary_recipients,
          amount: { currency_code: 'USD', value: data.items[0].unit_amount.value },
          due_amount: { currency_code: 'USD', value: data.items[0].unit_amount.value }, links: [],
        });
        const self = { rel: 'self', href: u.origin + '/v2/invoicing/invoices/' + id, method: 'GET' };
        return reply(topLevelCreateLink ? self : { links: [self] }, 201);
      }
      const match = u.pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)(\/send)?$/);
      if (match) {
        const invoice = invoices.get(match[1]);
        if (!invoice) return reply({ error: 'missing fixture invoice' }, 404);
        if (match[2]) {
          sends++;
          if (failSends) { failSends--; return reply({ error: 'temporary send failure' }, 503); }
          invoice.status = 'UNPAID';
          return reply({}, 202);
        }
        return reply(invoice);
      }
      throw new Error('Unexpected PayPal request: ' + u.pathname);
    },
  };
}

export function draftInput() {
  return {
    title: 'Mobile checkout', commentId: 'comment-1', deliverables: ['Mobile layouts for the checkout'], currency: 'USD',
    lineItems: [{ rateCardId: 'mobile_checkout', priceSource: 'rate_card', description: 'Mobile checkout', quantity: 1, unitAmountMinor: 25000 }],
  };
}
