import { randomUUID } from "node:crypto";
import { db, getProjectForRun, assertRunActive, currentRunId, bumpRunId, transaction } from "./db.js";
import * as paypal from "./paypal.js";
import { config } from "./env.js";
import type { ChangeOrderView, LineItem } from "../shared/types.js";

function rowToView(r: any): ChangeOrderView {
  const obs = db.prepare(
    "SELECT * FROM payment_observations WHERE change_order_id = ? ORDER BY id DESC LIMIT 1"
  ).get(r.id) as any;
  return {
    id: r.id,
    projectId: r.project_id,
    runId: r.run_id,
    scopeSnapshot: r.scope_snapshot_json ? JSON.parse(r.scope_snapshot_json) : null,
    assessmentId: r.assessment_id ?? null,
    stale: !!r.scope_revision_id && r.scope_revision_id !== getProjectForRun(r.run_id).scopeRevisionId && ["draft", "awaiting_client_approval", "needs_re_review"].includes(r.status),
    title: r.title,
    commentId: r.comment_id,
    deliverables: JSON.parse(r.deliverables_json),
    lineItems: (JSON.parse(r.line_items_json) as LineItem[]).map((li) => ({
      ...li, priceSource: li.priceSource ?? (li.rateCardId ? "rate_card" : "designer"),
    })),
    revision: r.revision ?? 1,
    scopeRevisionId: r.scope_revision_id ?? null,
    totalMinor: r.total_minor,
    currency: r.currency,
    status: r.status,
    paypalInvoiceId: r.paypal_invoice_id,
    invoiceUrl: r.invoice_url,
    paymentStatus: obs?.display_status ?? null,
    amountDueMinor: obs?.amount_due_minor ?? null,
    lastCheckedAt: obs?.checked_at ?? null,
    createdAt: r.created_at,
  };
}

function withProvenance(items: LineItem[], runId: string): LineItem[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error("Provide 1–20 priced line items");
  const rates = getProjectForRun(runId).rateCard;
  return items.map((li) => {
    if (!Number.isSafeInteger(li.quantity) || li.quantity < 1 || li.quantity > 100) throw new Error("Invalid line-item quantity");
    const source = li.priceSource ?? (li.rateCardId ? "rate_card" : "designer");
    if (source === "rate_card") {
      const rate = rates.find(r => r.id === li.rateCardId);
      if (!rate) throw new Error("Unknown rate-card entry");
      return { ...li, description: rate.description, unitAmountMinor: rate.unitAmountMinor, priceSource: source };
    }
    if (source !== "designer" || !Number.isSafeInteger(li.unitAmountMinor) || li.unitAmountMinor < 1 || li.unitAmountMinor > 10_000_000) {
      throw new Error("Invalid designer-set price");
    }
    if (typeof li.description !== "string" || !li.description.trim()) throw new Error("Line-item description required");
    return { ...li, rateCardId: null, priceSource: source };
  });
}

function requireEditable(order: ChangeOrderView): void {
  if (order.paypalInvoiceId || !["draft", "awaiting_client_approval", "needs_re_review"].includes(order.status)) {
    throw new Error("Approved or invoiced revisions are immutable; create a separate change order");
  }
}

function validateTerms(title: string, deliverables: string[]): void {
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw new Error("Title required (maximum 200 characters)");
  if (!Array.isArray(deliverables) || deliverables.length < 1 || deliverables.length > 20 || deliverables.some(x => typeof x !== "string" || !x.trim() || x.length > 2000)) throw new Error("Deliverables required");
}

export function createChangeOrder(input: {
  title: string;
  commentId: string | null;
  deliverables: string[];
  lineItems: LineItem[];
  currency: string;
}, runId = currentRunId()): ChangeOrderView {
  if (input.currency !== "USD") throw new Error("This demo supports USD only");
  validateTerms(input.title, input.deliverables);
  const id = randomUUID();
  const items = withProvenance(input.lineItems, runId);
  const total = items.reduce((s, li) => s + li.quantity * li.unitAmountMinor, 0);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO change_orders (id, project_id, title, comment_id, deliverables_json, line_items_json, total_minor, currency, status, revision, run_id, created_at)
     VALUES (?,?,?,?,?,?,?,?, 'draft', 1, ?, ?)`
  ).run(id, "demo", input.title, input.commentId, JSON.stringify(input.deliverables),
    JSON.stringify(items), total, input.currency, runId, now);
  return getChangeOrder(id)!;
}

/** Designer edit: bumps the revision, which invalidates any sent approval link (Q08). */
export function editChangeOrder(id: string, input: {
  title?: string;
  deliverables?: string[];
  lineItems?: LineItem[];
}): ChangeOrderView {
  const order = getChangeOrder(id);
  if (!order) throw new Error("Change order not found");
  requireEditable(order);
  validateTerms(input.title ?? order.title, input.deliverables ?? order.deliverables);
  const items = withProvenance(input.lineItems ?? order.lineItems, order.runId);
  const total = items.reduce((s, li) => s + li.quantity * li.unitAmountMinor, 0);
  db.prepare(
    `UPDATE change_orders SET title = ?, deliverables_json = ?, line_items_json = ?, total_minor = ?,
       revision = revision + 1, scope_revision_id = NULL, status = 'draft' WHERE id = ?`
  ).run(input.title ?? order.title, JSON.stringify(input.deliverables ?? order.deliverables),
    JSON.stringify(items), total, id);
  return getChangeOrder(id)!;
}

/** Designer submits the current revision for client approval, stamped with the active scope revision. */
export function submitForApproval(id: string): ChangeOrderView {
  const order = getChangeOrder(id);
  if (!order) throw new Error("Change order not found");
  requireEditable(order);
  const scopeRevisionId = getProjectForRun(order.runId).scopeRevisionId;
  // A baseline change changes the proposal's approval context even when its price
  // did not change. An invitation issued before re-review must never become valid again.
  const revision = order.revision + (order.scopeRevisionId && order.scopeRevisionId !== scopeRevisionId ? 1 : 0);
  transaction(() => {
    db.prepare("UPDATE change_orders SET status = 'awaiting_client_approval', scope_revision_id = ?, revision = ?, scope_snapshot_json = ? WHERE id = ?")
      .run(scopeRevisionId, revision, JSON.stringify(getProjectForRun(order.runId)), id);
    db.prepare("INSERT OR IGNORE INTO proposal_revisions (change_order_id, revision, snapshot_json, created_at) VALUES (?,?,?,?)")
      .run(id, revision, JSON.stringify(getChangeOrder(id)), new Date().toISOString());
  });
  return getChangeOrder(id)!;
}

/**
 * Client approval, bound to the exact revision (Q09) and rejected when the
 * scope baseline moved after submission (Q08). Server-side, not a UI warning.
 */
export function approveChangeOrder(id: string, session: { changeOrderId: string | null; changeOrderRevision: number | null }): ChangeOrderView {
  const order = getChangeOrder(id);
  if (!order) throw new Error("Change order not found");
  if (session.changeOrderId !== id || session.changeOrderRevision !== order.revision) {
    throw new Error("Approval link does not match the current change-order revision");
  }
  if (["approved", "creating_invoice", "payment_due", "paid"].includes(order.status) &&
      db.prepare("SELECT id FROM approvals WHERE change_order_id = ? AND change_order_revision = ?").get(id, order.revision)) return order;
  if (order.status !== "awaiting_client_approval") {
    throw new Error(`Cannot approve from status ${order.status}`);
  }
  const activeScope = getProjectForRun(order.runId).scopeRevisionId;
  if (order.scopeRevisionId !== activeScope) {
    db.prepare("UPDATE change_orders SET status = 'needs_re_review' WHERE id = ?").run(id);
    throw new Error("Scope baseline changed after this proposal was sent. Designer re-review is required before approval.");
  }
  db.prepare(
    "INSERT INTO approvals (change_order_id, change_order_revision, scope_revision_id, actor_role, created_at) VALUES (?,?,?,?,?)"
  ).run(id, order.revision, activeScope, "client", new Date().toISOString());
  db.prepare("UPDATE change_orders SET status = 'approved' WHERE id = ?").run(id);
  return getChangeOrder(id)!;
}

export function getChangeOrder(id: string): ChangeOrderView | null {
  const r = db.prepare("SELECT * FROM change_orders WHERE id = ?").get(id) as any;
  return r ? rowToView(r) : null;
}

export function listChangeOrders(runId = currentRunId()): ChangeOrderView[] {
  return (db.prepare("SELECT * FROM change_orders WHERE run_id = ? ORDER BY created_at DESC")
    .all(runId) as any[]).map(rowToView);
}

/** Q11: reset starts a fresh demo run. PayPal invoices stay intact; their IDs are tombstoned. */
export function resetDemoRun(runId = currentRunId()): { runId: string; tombstonedInvoices: number } {
  if ([...inFlightInvoices.keys()].some(id => getChangeOrder(id)?.runId === runId)) throw new Error("Wait for invoice operations to finish before resetting");
  return transaction(() => {
  const rows = db.prepare(
    `SELECT id, paypal_invoice_id FROM change_orders WHERE run_id = ? AND paypal_invoice_id IS NOT NULL
     UNION SELECT o.id, i.paypal_invoice_id FROM invoice_operations i JOIN change_orders o ON o.id = i.change_order_id WHERE o.run_id = ? AND i.paypal_invoice_id IS NOT NULL`
  ).all(runId, runId) as any[];
  const now = new Date().toISOString();
  for (const r of rows) {
    db.prepare(
      "INSERT OR IGNORE INTO invoice_tombstones (paypal_invoice_id, change_order_id, run_id, created_at) VALUES (?,?,?,?)"
    ).run(r.paypal_invoice_id, r.id, runId, now);
  }
  db.prepare("DELETE FROM payment_observations WHERE change_order_id IN (SELECT id FROM change_orders WHERE run_id = ?)").run(runId);
  db.prepare("DELETE FROM invoice_operations WHERE change_order_id IN (SELECT id FROM change_orders WHERE run_id = ?)").run(runId);
  db.prepare("DELETE FROM approvals WHERE change_order_id IN (SELECT id FROM change_orders WHERE run_id = ?)").run(runId);
  db.prepare("DELETE FROM proposal_revisions WHERE change_order_id IN (SELECT id FROM change_orders WHERE run_id = ?)").run(runId);
  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assessments'").get()) {
    db.prepare("DELETE FROM assessments WHERE run_id = ?").run(runId);
  }
  // A reset invalidates pending background work and portal authority atomically.
  for (const table of ["agent_outbox","agent_messages","agent_requests","agent_policies","agent_policy_history"]) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId);
  }
  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_portals'").get()) db.prepare("UPDATE agent_portals SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("UPDATE sessions SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("UPDATE invitations SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("DELETE FROM change_orders WHERE run_id = ?").run(runId);
  db.prepare("UPDATE renewal_grants SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("UPDATE judge_runs SET closed_at = ? WHERE run_id = ?").run(now, runId);
  return { runId: runId === currentRunId() ? bumpRunId() : `run-${randomUUID()}`, tombstonedInvoices: rows.length };
  });
}

export function isTombstonedInvoice(invoiceId: string): boolean {
  return !!db.prepare("SELECT paypal_invoice_id FROM invoice_tombstones WHERE paypal_invoice_id = ?").get(invoiceId);
}

// One server process owns this SQLite database. Coalesce concurrent UI actions;
// the persistent operation and unique invoice number cover process restarts.
const inFlightInvoices = new Map<string, Promise<ChangeOrderView>>();
export function ensureInvoice(orderId: string): Promise<ChangeOrderView> {
  const running = inFlightInvoices.get(orderId);
  if (running) return running;
  const task = resumeInvoice(orderId).finally(() => inFlightInvoices.delete(orderId));
  inFlightInvoices.set(orderId, task);
  return task;
}

async function resumeInvoice(orderId: string): Promise<ChangeOrderView> {
  const order = getChangeOrder(orderId);
  if (!order) throw new Error("Change order not found");
  if (!order.paypalInvoiceId && order.status !== "approved" && order.status !== "creating_invoice") {
    throw new Error(`Invoice requires client approval first (status is ${order.status})`);
  }
  const opKey = `invoice:${orderId}`;
  const existing = db.prepare("SELECT * FROM invoice_operations WHERE operation_key = ?").get(opKey) as any;
  const approval = db.prepare("SELECT id FROM approvals WHERE change_order_id = ? AND change_order_revision = ? AND actor_role = 'client'")
    .get(order.id, order.revision);
  if (!approval) throw new Error("Invoice requires approval of this exact revision");
  const now = new Date().toISOString();
  if (!existing) {
    db.prepare(
      "INSERT INTO invoice_operations (operation_key, change_order_id, state, created_at, updated_at) VALUES (?,?, 'creating', ?, ?)"
    ).run(opKey, orderId, now, now);
  }
  db.prepare("UPDATE change_orders SET status = 'creating_invoice' WHERE id = ?").run(orderId);

  const reference = `SS-${orderId.slice(0, 8)}`;
  let created: { id: string; href: string | null };
  const knownId = existing?.paypal_invoice_id ?? order.paypalInvoiceId;
  if (knownId) {
    created = { id: knownId, href: null };
  } else {
  // A previous create may have reached PayPal even if we never received its response.
  const reconciled = existing ? await paypal.findInvoiceByNumber(reference) : null;
  try {
    if (reconciled) created = { id: reconciled, href: null };
    else
    created = await paypal.createDraftInvoice({
      merchantEmail: config.paypalMerchantEmail,
      buyerEmail: config.paypalBuyerEmail,
      description: order.deliverables.join("; ") || order.title,
      amountMinor: order.totalMinor,
      currency: order.currency,
      reference,
    });
  } catch (err) {
    // Lost/duplicate create: reconcile against PayPal before any second creation (spec §7).
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("DUPLICATE_INVOICE_NUMBER")) throw err;
    const found = await paypal.findInvoiceByNumber(reference);
    if (!found) throw err;
    created = { id: found, href: null };
  }
  }
  db.prepare(
    "UPDATE invoice_operations SET state = 'created', paypal_invoice_id = ?, updated_at = ? WHERE operation_key = ?"
  ).run(created.id, new Date().toISOString(), opKey);

  // Persist the association before publication, so a failed send can resume.
  db.prepare("UPDATE change_orders SET paypal_invoice_id = ? WHERE id = ?").run(created.id, orderId);
  const detail = await paypal.getInvoice(created.id);
  validateInvoice({ ...order, paypalInvoiceId: created.id }, detail);
  const payerUrl = detail.status === "DRAFT" ? await paypal.sendInvoice(created.id) : detail.payerViewUrl;
  db.prepare(
    "UPDATE change_orders SET paypal_invoice_id = ?, invoice_url = ?, status = 'payment_due' WHERE id = ?"
  ).run(created.id, payerUrl, orderId);
  db.prepare(
    "UPDATE invoice_operations SET state = 'sent', updated_at = ? WHERE operation_key = ?"
  ).run(new Date().toISOString(), opKey);
  return refreshPaymentStatus(orderId);
}

function validateInvoice(order: ChangeOrderView, detail: Awaited<ReturnType<typeof paypal.getInvoice>>): void {
  if (detail.id !== order.paypalInvoiceId || detail.currency !== order.currency || detail.totalMinor !== order.totalMinor ||
      detail.raw.invoicer?.email_address?.toLowerCase() !== config.paypalMerchantEmail.toLowerCase()) {
    throw new Error("PayPal invoice identity, merchant, currency or amount does not match the approved change order");
  }
}

export async function refreshPaymentStatus(orderId: string): Promise<ChangeOrderView> {
  const order = getChangeOrder(orderId);
  if (!order) throw new Error("Change order not found");
  if (!order.paypalInvoiceId) return order;
  const detail = await paypal.getInvoice(order.paypalInvoiceId);
  if (!getChangeOrder(orderId)) throw new Error("This demo was reset while payment status was being checked");
  validateInvoice(order, detail);
  const display =
    detail.status === "PAID" && detail.amountDueMinor === 0 ? "paid" :
    detail.status === "PAID" ? "payment_review_required" :
    detail.status === "PARTIALLY_PAID" ? "partially_paid" :
    detail.status === "SENT" || detail.status === "UNPAID" ? "payment_due" :
    detail.status.toLowerCase();
  db.prepare(
    "INSERT INTO payment_observations (change_order_id, paypal_invoice_id, raw_status, display_status, amount_due_minor, checked_at) VALUES (?,?,?,?,?,?)"
  ).run(orderId, detail.id, detail.status, display, detail.amountDueMinor, new Date().toISOString());
  db.prepare("UPDATE change_orders SET status = ? WHERE id = ?").run(display === "paid" ? "paid" : "payment_due", orderId);
  if (detail.payerViewUrl) {
    db.prepare("UPDATE change_orders SET invoice_url = ? WHERE id = ?").run(detail.payerViewUrl, orderId);
  }
  return getChangeOrder(orderId)!;
}
