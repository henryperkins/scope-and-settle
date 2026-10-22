import { db } from "./db.js";
import { isTombstonedInvoice, refreshPaymentStatus } from "./orders.js";
import { verifyWebhook } from "./paypal.js";

db.exec(`CREATE TABLE IF NOT EXISTS webhook_receipts (
  id TEXT PRIMARY KEY, invoice_id TEXT, state TEXT NOT NULL, processed_at TEXT
)`);
const running = new Map<string, Promise<{ state: string }>>();

export async function receiveWebhook(headers: Record<string, string | string[] | undefined>, event: any): Promise<{ state: string } | null> {
  if (!(await verifyWebhook(headers, event))) return null;
  if (typeof event?.id !== "string" || typeof event.event_type !== "string") throw new Error("Invalid webhook event");
  // Real Invoicing notifications wrap the invoice under resource.invoice.
  // Keep the direct form for previously supported events and fixtures.
  const invoiceId = event.resource?.invoice?.id ?? event.resource?.id;
  const previous = db.prepare("SELECT state, invoice_id FROM webhook_receipts WHERE id = ?").get(event.id) as any;
  const previouslyUnrecognized = previous?.state === "ignored" && previous.invoice_id == null &&
    event.event_type.startsWith("INVOICING.INVOICE.") && typeof invoiceId === "string";
  if (previous?.state && previous.state !== "failed" && !previouslyUnrecognized) return { state: "duplicate" };
  const existing = running.get(event.id);
  if (existing) return existing;
  const task = reconcile(event, invoiceId).finally(() => running.delete(event.id));
  running.set(event.id, task);
  return task;
}

async function reconcile(event: any, invoiceId: unknown): Promise<{ state: string }> {
  let state = "ignored";
  try {
    if (event.event_type.startsWith("INVOICING.INVOICE.") && typeof invoiceId === "string") {
      if (isTombstonedInvoice(invoiceId)) state = "tombstoned";
      else {
        const order = db.prepare("SELECT id FROM change_orders WHERE paypal_invoice_id = ?").get(invoiceId) as any;
        if (order) { await refreshPaymentStatus(order.id); state = "reconciled"; }
        else state = "unmatched";
      }
    }
    db.prepare("INSERT INTO webhook_receipts (id,invoice_id,state,processed_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET invoice_id=excluded.invoice_id, state=excluded.state, processed_at=excluded.processed_at")
      .run(event.id, typeof invoiceId === "string" ? invoiceId : null, state, new Date().toISOString());
    return { state };
  } catch (error) {
    db.prepare("INSERT INTO webhook_receipts (id,invoice_id,state) VALUES (?,?,'failed') ON CONFLICT(id) DO UPDATE SET state='failed'")
      .run(event.id, typeof invoiceId === "string" ? invoiceId : null);
    throw error;
  }
}
