import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
const db = new DatabaseSync(resolve(process.env.SCOPE_SETTLE_DATA_DIR || '/var/data', 'scope-and-settle.db'), { readOnly: true });
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  orders: db.prepare('SELECT id, revision, status, paypal_invoice_id FROM change_orders').all(),
  webhookReceipts: db.prepare('SELECT id, invoice_id, state, processed_at FROM webhook_receipts ORDER BY processed_at DESC LIMIT 20').all(),
  budget: db.prepare('SELECT count(*) AS calls, coalesce(sum(coalesce(actual_micro_usd,reserved_micro_usd)),0) AS consumed_micro_usd FROM ai_calls').get(),
}, null, 2));
db.close();
