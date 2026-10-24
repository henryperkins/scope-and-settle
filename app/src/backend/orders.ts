import { randomUUID } from "node:crypto";
import {captureScopeContext,linkedScopeContext,linkScopeContext,contextTermsCurrent,contextRatesCurrent,contextCurrent} from './scopeLedger.js';
import { db, getProjectForRun, assertRunActive, currentRunId, bumpRunId, transaction } from "./db.js";
import * as paypal from "./paypal.js";
import { config } from "./env.js";
import { ScopedAccessError } from "./context.js";
import type { ChangeOrderView, LineItem } from "../shared/types.js";
import { approvedProviderItems, compatibilityStatus, deriveFinancialState, invoiceTermProblems, validateItemizedInvoiceTerms, type ApprovedInvoiceTerms } from "./paymentState.js";
import {ensureDefaultSchedule,copySchedule,installmentData,hasExplicitSchedule} from './milestoneStore.js';
import {deliverySummary} from './deliverySummary.js';
import {ensureDueInstallments,refreshInvoiceRecord,installmentInFlight} from './milestones.js';

function rowToView(r: any): ChangeOrderView {
  const installments=installmentData(r),explicit=hasExplicitSchedule(r.id,r.revision);
  const associationIssue=db.prepare('SELECT adoption_issue FROM invoice_records WHERE order_id=? AND revision=? AND adoption_issue IS NOT NULL').get(r.id,r.revision);
  const scopeContext=linkedScopeContext('proposal',r.id,r.revision??1);
  const obs = db.prepare(
    "SELECT * FROM payment_observations WHERE change_order_id = ? ORDER BY id DESC LIMIT 1"
  ).get(r.id) as any;
  return {
    id: r.id,
    projectId: r.project_id,
    runId: r.run_id,
    scopeSnapshot: r.scope_snapshot_json ? JSON.parse(r.scope_snapshot_json) : null,
    assessmentId: r.assessment_id ?? null,
    scopeContext,
    stale: (r.status==='needs_re_review'||!!r.scope_revision_id && r.scope_revision_id !== getProjectForRun(r.run_id).scopeRevisionId || !!scopeContext?.scopeSnapshotId&&!contextTermsCurrent(scopeContext,r.run_id)) && ["draft", "awaiting_client_approval", "needs_re_review"].includes(r.status),
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
    status: associationIssue?'payment_review_required':r.status,
    approvalStatus: db.prepare("SELECT id FROM approvals WHERE change_order_id = ? AND change_order_revision = ? AND actor_role = 'client'").get(r.id,r.revision)
      ? "approved" : ["draft","awaiting_client_approval","needs_re_review"].includes(r.status) ? r.status : "draft",
    financialState: explicit?null:obs?.financial_json ? JSON.parse(obs.financial_json) : null,
    paypalInvoiceId: explicit?null:r.paypal_invoice_id,
    invoiceUrl: explicit||associationIssue?null:r.invoice_url,
    paymentStatus: explicit?null:obs?.display_status ?? null,
    amountDueMinor: explicit?installments?.installmentSummary.payableDueMinor??null:obs?.amount_due_minor ?? null,
    lastCheckedAt: obs?.checked_at ?? null,
    createdAt: r.created_at,
    ...(installments??{}),
    delivery:deliverySummary(r.id,r.revision),
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
  validateItemizedInvoiceTerms({ lineItems: items, totalMinor: total, currency: input.currency });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO change_orders (id, project_id, title, comment_id, deliverables_json, line_items_json, total_minor, currency, status, revision, run_id, created_at)
     VALUES (?,?,?,?,?,?,?,?, 'draft', 1, ?, ?)`
  ).run(id, "demo", input.title, input.commentId, JSON.stringify(input.deliverables),
    JSON.stringify(items), total, input.currency, runId, now);
  linkScopeContext('proposal',id,1,captureScopeContext(runId).id);
  ensureDefaultSchedule(db.prepare('SELECT * FROM change_orders WHERE id=?').get(id));
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
  if(db.prepare("SELECT id FROM proposal_item_reservations WHERE order_id=? AND state='reserved'").get(id)&& (input.deliverables!==undefined||input.lineItems!==undefined)){
    if(JSON.stringify(input.deliverables??order.deliverables)!==JSON.stringify(order.deliverables)||JSON.stringify(withProvenance(input.lineItems??order.lineItems,order.runId))!==JSON.stringify(order.lineItems))throw new Error('Reserved item terms cannot be silently changed; abandon and reassess the items');
  }
  validateTerms(input.title ?? order.title, input.deliverables ?? order.deliverables);
  const items = withProvenance(input.lineItems ?? order.lineItems, order.runId);
  const total = items.reduce((s, li) => s + li.quantity * li.unitAmountMinor, 0);
  validateItemizedInvoiceTerms({ lineItems: items, totalMinor: total, currency: order.currency });
  db.prepare(
    `UPDATE change_orders SET title = ?, deliverables_json = ?, line_items_json = ?, total_minor = ?,
       revision = revision + 1, scope_revision_id = NULL, assessment_id=NULL, status = 'draft' WHERE id = ?`
  ).run(input.title ?? order.title, JSON.stringify(input.deliverables ?? order.deliverables),
    JSON.stringify(items), total, id);
  linkScopeContext('proposal',id,order.revision+1,captureScopeContext(order.runId).id);
  copySchedule(db.prepare('SELECT * FROM change_orders WHERE id=?').get(id),order.revision);
  return getChangeOrder(id)!;
}

/**
 * Reserved (pending) items against their canonical sources. LEFT JOINs keep a missing result or
 * source visible as unavailable instead of silently dropping it. Committed history is not inspected.
 */
export function itemSourceState(orderId:string):'current'|'changed'|'unavailable'|null{
 const rows=db.prepare(`SELECT i.item_id result_item,i.source_version,s.id source_row,s.version,f.state fence FROM proposal_item_reservations r
  LEFT JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id
  LEFT JOIN request_sources s ON s.id=i.source_id
  LEFT JOIN request_source_freshness f ON f.source_id=i.source_id
  WHERE r.order_id=? AND r.state='reserved'`).all(orderId) as any[];
 if(!rows.length)return null;
 if(rows.some(x=>!x.result_item||!x.source_row||x.fence==='unavailable'))return 'unavailable';
 return rows.some(x=>x.source_version!==x.version)?'changed':'current';
}
/** Shared order boundary for designer/direct submit, portal approval and scoped client approval. */
function assertItemSourceCurrent(orderId:string){
 const state=itemSourceState(orderId);
 if(state==='unavailable')throw new ScopedAccessError(409,'Request source is unavailable; reserved item terms need designer review');
 if(state==='changed')throw new ScopedAccessError(409,'Request source changed; reserved item terms need designer review');
}
/** Designer submits the current revision for client approval, stamped with the active scope revision. */
export function submitForApproval(id: string): ChangeOrderView {
  assertItemSourceCurrent(id);
  const order = getChangeOrder(id);
  if (!order) throw new Error("Change order not found");
  requireEditable(order);
  validateItemizedInvoiceTerms(order);
  const scopeRevisionId = getProjectForRun(order.runId).scopeRevisionId;
  if(order.scopeContext&&!contextRatesCurrent(order.scopeContext,order.runId))throw new Error('Rates changed or historical rates are unknown; edit and review the proposal rates before submitting');
  // A baseline change changes the proposal's approval context even when its price
  // did not change. An invitation issued before re-review must never become valid again.
  if(order.assessmentId&&!contextCurrent(linkedScopeContext('assessment',order.assessmentId),order.runId))throw new Error('Assessment context changed; designer re-review or reassessment is required');
  const contextChanged=order.scopeContext&&!contextCurrent(order.scopeContext,order.runId);
  const revision = order.revision + ((order.scopeRevisionId && order.scopeRevisionId !== scopeRevisionId)||contextChanged||order.status==='needs_re_review' ? 1 : 0);
  transaction(() => {
    if(!order.scopeContext||contextChanged)linkScopeContext('proposal',id,revision,captureScopeContext(order.runId).id);
    db.prepare("UPDATE change_orders SET status = 'awaiting_client_approval', scope_revision_id = ?, revision = ?, scope_snapshot_json = ? WHERE id = ?")
      .run(scopeRevisionId, revision, JSON.stringify(getProjectForRun(order.runId)), id);
    if(revision!==order.revision)copySchedule(db.prepare('SELECT * FROM change_orders WHERE id=?').get(id),order.revision);
    db.prepare("INSERT OR IGNORE INTO proposal_revisions (change_order_id, revision, snapshot_json, created_at) VALUES (?,?,?,?)")
      .run(id, revision, JSON.stringify({ ...getChangeOrder(id), merchantEmail: config.paypalMerchantEmail }), new Date().toISOString());
  });
  return getChangeOrder(id)!;
}

/**
 * Client approval, bound to the exact revision (Q09) and rejected when the
 * scope baseline moved after submission (Q08). Server-side, not a UI warning.
 */
export function approveChangeOrder(id: string, session: { changeOrderId: string | null; changeOrderRevision: number | null }): ChangeOrderView {return transaction(()=>approveInTransaction(id,session));}
function approveInTransaction(id: string, session: { changeOrderId: string | null; changeOrderRevision: number | null }): ChangeOrderView {
  const order = getChangeOrder(id);
  if (!order) throw new Error("Change order not found");
  if (session.changeOrderId !== id || session.changeOrderRevision !== order.revision) {
    throw new Error("Approval link does not match the current change-order revision");
  }
  if (order.approvalStatus === "approved" &&
      db.prepare("SELECT id FROM approvals WHERE change_order_id = ? AND change_order_revision = ?").get(id, order.revision)) return order;
  if (order.status !== "awaiting_client_approval") {
    if(order.status==='needs_re_review')throw new Error('Scope baseline or rates changed. Designer re-review is required before approval.');
    throw new Error(`Cannot approve from status ${order.status}`);
  }
  assertItemSourceCurrent(id);
  validateItemizedInvoiceTerms(order);
  const proposal = db.prepare("SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?").get(id, order.revision) as any;
  if (!proposal) throw new Error("Missing immutable proposal terms");
  validateItemizedInvoiceTerms(JSON.parse(proposal.snapshot_json));
  const activeScope = getProjectForRun(order.runId).scopeRevisionId;
  if (order.scopeRevisionId !== activeScope || order.stale) {
    db.prepare("UPDATE change_orders SET status = 'needs_re_review' WHERE id = ?").run(id);
    throw new Error("Scope baseline changed after this proposal was sent. Designer re-review is required before approval.");
  }
  db.prepare(
    "INSERT INTO approvals (change_order_id, change_order_revision, scope_revision_id, actor_role, created_at) VALUES (?,?,?,?,?)"
  ).run(id, order.revision, activeScope, "client", new Date().toISOString());
  const approval=db.prepare('SELECT id FROM approvals WHERE change_order_id=? AND change_order_revision=? ORDER BY id DESC LIMIT 1').get(id,order.revision) as any;
  if(order.scopeContext)linkScopeContext('approval',String(approval.id),1,order.scopeContext.id);
  db.prepare("UPDATE proposal_item_reservations SET state='committed' WHERE order_id=? AND state='reserved'").run(id);
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
  if (installmentInFlight(runId)||[...inFlightInvoices.keys()].some(id => getChangeOrder(id)?.runId === runId)) throw new Error("Wait for invoice operations to finish before resetting");
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
  db.prepare('DELETE FROM design_evidence_bytes WHERE run_id=?').run(runId);
  db.prepare("UPDATE assessment_attempts SET outcome=CASE WHEN outcome IN ('prepared','dispatched') THEN 'uncertain' ELSE outcome END,updated_at=? WHERE run_id=?").run(now,runId);
  db.prepare(`UPDATE webhook_receipts SET state='tombstoned',processed_at=? WHERE invoice_id IN (SELECT paypal_invoice_id FROM invoice_tombstones WHERE run_id=?)`).run(now,runId);
  db.prepare(`UPDATE jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,error_category='tombstoned',updated_at=?,completed_at=?
    WHERE run_id=? OR (kind='paypal_reconcile' AND json_valid(payload_json) AND json_extract(payload_json,'$.invoiceId') IN (SELECT paypal_invoice_id FROM invoice_tombstones WHERE run_id=?))`).run(now,now,runId,runId);
  db.prepare("UPDATE inbox_settings SET settings_json=json_set(settings_json,'$.intake',json('false'),'$.autoAssess',json('false')) WHERE run_id=?").run(runId);
  db.prepare("UPDATE request_inbox SET availability='reset',updated_at=? WHERE run_id=?").run(now,runId);
  for (const table of ["agent_outbox","agent_messages","agent_requests","agent_policies","agent_policy_history"]) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId);
  }
  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_portals'").get()) db.prepare("UPDATE agent_portals SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("UPDATE sessions SET revoked = 1 WHERE run_id = ?").run(runId);
  db.prepare("UPDATE invitations SET revoked = 1 WHERE run_id = ?").run(runId);
  // A reset revokes the run's agent connector credentials with its sessions; budget history is retained.
  db.prepare("UPDATE connector_credentials SET revoked_at = ?, revoked_reason = 'reset' WHERE run_id = ? AND revoked_at IS NULL").run(now, runId);
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
const inFlightRefreshes = new Map<string, Promise<ChangeOrderView>>();
export const isInvoiceInFlight=(orderId:string)=>inFlightInvoices.has(orderId);
export async function ensureInvoice(orderId: string, assertAuthorized?: () => void): Promise<ChangeOrderView> {
  assertAuthorized?.();
  getChangeOrder(orderId);
  if(db.prepare('SELECT id FROM invoice_records WHERE order_id=? AND adoption_issue IS NOT NULL').get(orderId))throw new Error('Legacy invoice association requires review');
  const scheduled=getChangeOrder(orderId);if(scheduled&&hasExplicitSchedule(orderId,scheduled.revision))return ensureDueInstallments(orderId,()=>{assertAuthorized?.();});
  const running = inFlightInvoices.get(orderId);
  if (running) { const result = await running; assertAuthorized?.(); return result; }
  const task = resumeInvoice(orderId, assertAuthorized).finally(() => inFlightInvoices.delete(orderId));
  inFlightInvoices.set(orderId, task);
  const result = await task; assertAuthorized?.(); return result;
}

async function resumeInvoice(orderId: string, assertAuthorized?: () => void): Promise<ChangeOrderView> {
  assertAuthorized?.();
  const authorized = () => { assertAuthorized?.(); return true; };
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
  // A legacy approved proposal may predate input validation. Reject it without
  // creating financial-operation state or changing its immutable approval.
  const terms = recordedTerms(order, !existing);
  const now = new Date().toISOString();
  if (!existing) {
    db.prepare(
      "INSERT INTO invoice_operations (operation_key, change_order_id, state, created_at, updated_at, representation, approved_terms_json) VALUES (?,?, 'creating', ?, ?, ?, ?)"
    ).run(opKey, orderId, now, now, terms.representation, JSON.stringify(terms));
  }
  db.prepare("UPDATE change_orders SET status = 'creating_invoice' WHERE id = ?").run(orderId);

  const reference = terms.reference;
  let created: { id: string; href: string | null };
  const knownId = existing?.paypal_invoice_id ?? order.paypalInvoiceId;
  if (knownId) {
    created = { id: knownId, href: null };
  } else {
  // A previous create may have reached PayPal even if we never received its response.
  const reconciled = existing ? await paypal.findInvoiceByNumber(terms.invoiceNumber, authorized) : null;
  try {
    assertAuthorized?.();
    if (reconciled) created = { id: reconciled, href: null };
    else
    created = await paypal.createDraftInvoice({
      merchantEmail: terms.merchantEmail,
      buyerEmail: config.paypalBuyerEmail,
      description: order.deliverables.join("; ") || order.title,
      amountMinor: terms.totalMinor,
      currency: terms.currency,
      reference,
      approvedTerms: terms,
    }, authorized);
  } catch (err) {
    // Lost/duplicate create: reconcile against PayPal before any second creation (spec §7).
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("DUPLICATE_INVOICE_NUMBER")) throw err;
    const found = await paypal.findInvoiceByNumber(terms.invoiceNumber, authorized);
    if (!found) throw err;
    created = { id: found, href: null };
  }
  }
  db.prepare(
    "UPDATE invoice_operations SET state = 'created', paypal_invoice_id = ?, updated_at = ? WHERE operation_key = ?"
  ).run(created.id, new Date().toISOString(), opKey);

  // Persist the association before publication, so a failed send can resume.
  db.prepare("UPDATE change_orders SET paypal_invoice_id = ? WHERE id = ?").run(created.id, orderId);
  assertAuthorized?.();
  const detail = await paypal.getInvoice(created.id, authorized);
  assertAuthorized?.();
  validateInvoice({ ...order, paypalInvoiceId: created.id }, detail);
  const recordSent = () => {
    // A completed provider send must survive authority loss during the response.
    db.prepare("UPDATE invoice_operations SET state = 'sent', updated_at = ? WHERE operation_key = ?")
      .run(new Date().toISOString(), opKey);
  };
  const payerUrl = detail.status === "DRAFT" ? await paypal.sendInvoice(created.id, authorized, recordSent) : detail.payerViewUrl;
  assertAuthorized?.();
  db.prepare(
    "UPDATE change_orders SET paypal_invoice_id = ?, invoice_url = ? WHERE id = ?"
  ).run(created.id, payerUrl, orderId);
  db.prepare(
    "UPDATE invoice_operations SET state = 'sent', updated_at = ? WHERE operation_key = ?"
  ).run(new Date().toISOString(), opKey);
  return refreshPaymentStatus(orderId, assertAuthorized);
}

/** The exact approval snapshot and invoice representation are fixed before provider creation. */
function recordedTerms(order: ChangeOrderView, newOperation = false): ApprovedInvoiceTerms {
  const operation = db.prepare("SELECT * FROM invoice_operations WHERE change_order_id = ?").get(order.id) as any;
  if (operation?.approved_terms_json) return { ...JSON.parse(operation.approved_terms_json), invoiceId: order.paypalInvoiceId ?? undefined };
  const row = db.prepare(`SELECT p.snapshot_json FROM proposal_revisions p JOIN approvals a
    ON a.change_order_id=p.change_order_id AND a.change_order_revision=p.revision
    WHERE p.change_order_id=? AND p.revision=? AND a.actor_role='client'`).get(order.id,order.revision) as any;
  if (!row) throw new Error("Missing immutable approved proposal terms");
  const snapshot = JSON.parse(row.snapshot_json);
  const representation = newOperation ? "itemized-v1" : operation?.representation;
  if (representation !== "itemized-v1" && representation !== "aggregate-v0") throw new Error("Unknown invoice representation provenance requires review");
  const reference = representation === "itemized-v1" ? `order:${order.id};revision:${snapshot.revision};scope:${snapshot.scopeRevisionId}` : `SS-${order.id.slice(0,8)}`;
  if(reference.length>120)throw new Error("Approved revision reference exceeds provider limit");
  const terms: ApprovedInvoiceTerms = {
    merchantEmail: snapshot.merchantEmail ?? config.paypalMerchantEmail,
    merchantProvenance: snapshot.merchantEmail ? "approval-snapshot" : "legacy-configuration",
    currency:snapshot.currency,totalMinor:snapshot.totalMinor,lineItems:snapshot.lineItems,representation,reference,
    invoiceNumber:representation === "itemized-v1" ? `SS-${order.id.replaceAll('-','').slice(0,22)}` : reference,
    ...(representation === "aggregate-v0" ? {legacyDescription:snapshot.deliverables.join("; ") || snapshot.title} : {}),
  };
  approvedProviderItems(terms);
  db.prepare("UPDATE invoice_operations SET representation=?, approved_terms_json=? WHERE change_order_id=?")
    .run(representation,JSON.stringify(terms),order.id);
  return {...terms,invoiceId:order.paypalInvoiceId ?? undefined};
}

function validateInvoice(order: ChangeOrderView, detail: paypal.InvoiceDetail): void {
  const problems=invoiceTermProblems(detail,recordedTerms(order));
  if(problems.length) throw new Error("PayPal invoice does not match the approved change order: "+problems.join("; "));
}

/** Queue retrievals rather than coalescing: each newer request observes after the previous write. */
export async function refreshPaymentStatus(orderId: string, assertAuthorized?: () => void, applyInTransaction?: () => void): Promise<ChangeOrderView> {
  assertAuthorized?.();
  const scheduled=getChangeOrder(orderId);
  if(db.prepare('SELECT id FROM invoice_records WHERE order_id=? AND adoption_issue IS NOT NULL').get(orderId))throw new Error('Legacy invoice association requires review');
  if(scheduled&&hasExplicitSchedule(orderId,scheduled.revision)){
    for(const m of scheduled.installments??[])if(m.paypalInvoiceId)await refreshInvoiceRecord(m.invoiceRecordId,()=>{assertAuthorized?.();});
    transaction(()=>{assertAuthorized?.();applyInTransaction?.();});return getChangeOrder(orderId)!;
  }
  const previous=inFlightRefreshes.get(orderId);
  const task=(async()=>{if(previous)await previous.catch(()=>{});assertAuthorized?.();return retrievePaymentStatus(orderId,assertAuthorized,applyInTransaction);})();
  inFlightRefreshes.set(orderId,task);
  try{return await task;}finally{if(inFlightRefreshes.get(orderId)===task)inFlightRefreshes.delete(orderId);}
}

async function retrievePaymentStatus(orderId: string, assertAuthorized?: () => void, applyInTransaction?: () => void): Promise<ChangeOrderView> {
  assertAuthorized?.();
  const order = getChangeOrder(orderId);
  if (!order) throw new Error("Change order not found (possibly reset)");
  if (!order.paypalInvoiceId) return order;
  const detail = await paypal.getInvoice(order.paypalInvoiceId, () => { assertAuthorized?.(); return true; });
  assertAuthorized?.();
  return transaction(()=>{
    assertAuthorized?.();
    const current = getChangeOrder(orderId);
    if (!current || current.projectId !== order.projectId || current.runId !== order.runId || current.revision !== order.revision ||
        current.paypalInvoiceId !== order.paypalInvoiceId || isTombstonedInvoice(order.paypalInvoiceId!)) {
      throw new Error("This demo was reset or invoice association changed while payment status was being checked");
    }
    assertRunActive(current.runId);
    let financial;
    try {financial=deriveFinancialState(detail,recordedTerms(current));}
    catch(error) {
      financial={invoiceState:"unknown" as const,paymentState:"review_required" as const,rawStatus:detail.raw?.status??null,
        amountDueMinor:null,paidMinor:null,refundedMinor:null,observedAt:new Date().toISOString(),representation:"unknown" as const,
        merchantProvenance:"legacy-configuration" as const,issues:[error instanceof Error?error.message:String(error)]};
    }
    const display=compatibilityStatus(financial);
    db.prepare("INSERT INTO payment_observations (change_order_id, paypal_invoice_id, raw_status, display_status, amount_due_minor, checked_at, financial_json) VALUES (?,?,?,?,?,?,?)")
      .run(orderId,order.paypalInvoiceId,typeof detail.status === "string"?detail.status:JSON.stringify(detail.status??null),display,financial.amountDueMinor,financial.observedAt,JSON.stringify(financial));
    db.prepare("UPDATE change_orders SET status = ? WHERE id = ?").run(display,orderId);
    if (detail.payerViewUrl) db.prepare("UPDATE change_orders SET invoice_url = ? WHERE id = ?").run(detail.payerViewUrl,orderId);
    // Historical Paid remains in the conversation; the current activity follows this observation.
    db.prepare("UPDATE agent_requests SET state = 'quoted', updated_at = ? WHERE order_id = ? AND state = 'paid' AND ? != 'paid'")
      .run(financial.observedAt,orderId,financial.paymentState);
    if (financial.paymentState !== "paid" && (current.financialState?.paymentState !== financial.paymentState || current.financialState?.invoiceState !== financial.invoiceState)) {
      const names: Record<string,string> = {due:"Payment due",partial:"Partially paid",pending:"Payment pending",refunded:"Refunded",partially_refunded:"Partially refunded",review_required:"Payment needs review",unknown:"Payment needs review",not_started:"Payment not started"};
      const summary = (financial.invoiceState === "cancelled" ? "Invoice cancelled. " : "") + names[financial.paymentState];
      for (const request of db.prepare("SELECT id,run_id FROM agent_requests WHERE order_id=?").all(orderId)) {
        db.prepare("INSERT INTO agent_messages (id,run_id,request_id,actor,body,created_at) VALUES (?,?,?,'agent',?,?)")
          .run(randomUUID(),request.run_id,request.id,`Current financial status: ${summary}. Approval for revision ${current.revision} remains saved.`,financial.observedAt);
        db.prepare("UPDATE agent_outbox SET state='cancelled',updated_at=? WHERE request_id=? AND kind='figma' AND state='pending' AND marker LIKE ?")
          .run(financial.observedAt,request.id,`%:paid-${orderId}-${current.revision}]`);
      }
    }
    applyInTransaction?.(); // Synchronous lease/fencing hook; never await while holding SQLite's transaction.
    return getChangeOrder(orderId)!;
  });
}
