import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, PROJECT_ROOT, DATA_DIR } from '../../app/dist/backend/env.js';

const hostname = process.argv[2];
if (!hostname || !/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes('.')) throw new Error('Provide the hosted DNS name');
// Read-only: do not import db.js or copy development sessions/invoices to hosting.
const ledger = new DatabaseSync(resolve(DATA_DIR, 'scope-and-settle.db'), { readOnly: true });
const consumed = Number(ledger.prepare('SELECT coalesce(sum(coalesce(actual_micro_usd,reserved_micro_usd)),0) AS consumed FROM ai_calls').get().consumed);
ledger.close();
const remaining = Math.floor((25_000_000 - consumed) / 10_000) / 100;
if (remaining <= 0) throw new Error('No remaining development AI allowance');
const values = {
  NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '8787', NODE_OPTIONS: '--max-old-space-size=256',
  SCOPE_SETTLE_DATA_DIR: '/var/data', PUBLIC_BASE_URL: `https://${hostname}`,
  PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: config.paypalClientId, PAYPAL_CLIENT_SECRET: config.paypalClientSecret,
  PAYPAL_SANDBOX_MERCHANT_EMAIL: config.paypalMerchantEmail, PAYPAL_SANDBOX_BUYER_EMAIL: config.paypalBuyerEmail,
  FIGMA_PERSONAL_ACCESS_TOKEN: config.figmaToken, FIGMA_FILE_KEY: config.figmaFileKey,
  OPENAI_API_KEY: config.aiApiKey, AI_MODEL: config.aiModel, AI_BUDGET_USD: String(remaining),
};
for (const [key, value] of Object.entries(values)) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Missing or unsafe configuration: ${key}`);
}
const directory = resolve(PROJECT_ROOT, 'output/gcp/private');
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(resolve(directory, 'runtime.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ configuration: 'written to ignored private runtime.env', consumedMicroUsd: consumed, hostedAiBudgetUsd: remaining }));
