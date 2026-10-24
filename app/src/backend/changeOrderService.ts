import {reserveProposalItems} from "./requestItems.js";
import { db, getProjectForRun, transaction } from "./db.js";
import { ScopedAccessError, requireActiveContext, requireDesignerContext, requireOperationContext, sessionForContext, type ServiceContext } from "./context.js";
import { projectPayment, type PaymentStatusProjection } from "./connectorProjections.js";
import * as orders from "./orders.js";
import { createInvitation } from "./sessions.js";
import { createClientAccess } from "./judging.js";
import { getAssessment } from "./assessment.js";
import {contextCurrent,linkedScopeContext} from './scopeLedger.js';
import { config } from "./env.js";
import type { ActorContext, ChangeOrderView, DraftChangeOrderInput, LineItem } from "../shared/types.js";
export type { DraftChangeOrderInput } from "../shared/types.js";
export type EditChangeOrderInput = Partial<Pick<DraftChangeOrderInput,"title"|"deliverables"|"lineItems">>;
export type ApprovalResult = ChangeOrderView & { invoiceError?: string };
export interface SubmittedChangeOrder { order: ChangeOrderView; approvalUrl: string; approvalExpiresAt: string }

/** Private scoped-row membership check, shared by the session read and the payment-status entrance. */
function scopedOrderRow(projectId: string, runId: string, orderId: unknown): { id: string; revision: number } | null {
  if (typeof orderId !== "string") return null;
  return (db.prepare("SELECT id, revision FROM change_orders WHERE id = ? AND project_id = ? AND run_id = ?").get(orderId, projectId, runId) as any) ?? null;
}
export function getScopedOrder(ctx: ActorContext, orderId: string): ChangeOrderView {
  requireActiveContext(ctx);
  // Check membership before rowToView can access another run's frozen project.
  const row = scopedOrderRow(ctx.projectId, ctx.runId, orderId);
  if (!row) {
    if (db.prepare("SELECT id FROM change_orders WHERE id = ?").get(orderId)) throw new ScopedAccessError(403,"Session does not grant access to this proposal revision");
    throw new ScopedAccessError(404,"Change order not found");
  }
  if (ctx.role === "client" && (ctx.grant.kind !== "change_order" || ctx.grant.resourceId !== orderId || ctx.grant.revision !== row.revision)) {
    throw new ScopedAccessError(403,"Session does not grant access to this proposal revision");
  }
  const order=orders.getChangeOrder(orderId)!;
  return ctx.role==='client'&&order.scopeContext?{...order,scopeContext:{...order.scopeContext,commitments:[]}}:order;
}
/** Designer list only: pending reserved items' source state drives stale-source messaging and recovery. */
export function listScopedOrders(ctx: ActorContext): (ChangeOrderView & { itemSourceState: ReturnType<typeof orders.itemSourceState> })[] {
  requireDesignerContext(ctx);
  return db.prepare("SELECT id FROM change_orders WHERE project_id = ? AND run_id = ? ORDER BY created_at DESC")
    .all(ctx.projectId,ctx.runId).map(row=>{const order=getScopedOrder(ctx,String(row.id));return {...order,itemSourceState:orders.itemSourceState(order.id)};});
}
function lineItems(items: LineItem[]): LineItem[] {
  if (!Array.isArray(items)) throw new Error("Provide priced line items");
  return items.map(item=>({rateCardId:item?.rateCardId,priceSource:item?.priceSource,description:item?.description,
    quantity:item?.quantity,unitAmountMinor:item?.unitAmountMinor}));
}
export function draftChangeOrder(ctx: ActorContext, input: DraftChangeOrderInput): ChangeOrderView {
  requireDesignerContext(ctx);
  if (!Array.isArray(input.itemIds) || input.itemIds.length === 0 || !input.operationId) {
    throw new ScopedAccessError(400, 'Every new proposal requires canonical request item IDs from a reviewed assessment and an operation ID; select or reassess an authoritative request');
  }
  return transaction(() => {
    const binding = reserveProposalItems(ctx, input.itemIds!, input.operationId!);
    if (input.assessmentId && binding.assessmentId !== input.assessmentId) {
      throw new ScopedAccessError(409, 'Selected item assessment differs from the reviewed assessment');
    }
    return getScopedOrder(ctx, binding.orderId);
  });
}
export function editScopedOrder(ctx: ActorContext, orderId: string, input: EditChangeOrderInput): ChangeOrderView {
  requireDesignerContext(ctx); getScopedOrder(ctx,orderId);
  return orders.editChangeOrder(orderId,{title:input.title,deliverables:input.deliverables,
    ...(input.lineItems === undefined ? {} : {lineItems:lineItems(input.lineItems)})});
}
export function issueScopedClientAccess(ctx: ActorContext, orderId: string) {
  requireDesignerContext(ctx);
  const order = getScopedOrder(ctx,orderId), session = sessionForContext(ctx);
  if (!session.grantId) throw new ScopedAccessError(400,"Use submit to issue a development invitation");
  return createClientAccess(session,order);
}
export function submitScopedOrder(ctx: ActorContext, orderId: string): SubmittedChangeOrder {
  requireDesignerContext(ctx); getScopedOrder(ctx,orderId);
  return transaction(()=>{
    const order = orders.submitForApproval(orderId), session = sessionForContext(ctx);
    if (session.grantId) return {order,...issueScopedClientAccess(ctx,orderId)};
    const link = createInvitation({projectId:ctx.projectId,runId:ctx.runId,role:"client",changeOrderId:order.id,changeOrderRevision:order.revision});
    return {order,approvalUrl:`${config.publicUrl}/review#${link.token}`,approvalExpiresAt:link.expiresAt};
  });
}
export async function approveScopedOrder(ctx: ActorContext, orderId: string): Promise<ApprovalResult> {
  const session = sessionForContext(ctx);
  if (session.role !== "client") throw new ScopedAccessError(403,"Requires client role");
  getScopedOrder(ctx,orderId); orders.approveChangeOrder(orderId,session);
  try { await orders.ensureInvoice(orderId,()=>{getScopedOrder(ctx,orderId);}); }
  catch(error) {
    // Approval remains saved on provider failure, but revoked callers receive no data.
    const order = getScopedOrder(ctx,orderId);
    return {...order,invoiceError:error instanceof Error ? error.message : "Invoice preparation failed; approval is saved"};
  }
  return getScopedOrder(ctx,orderId);
}
export async function prepareScopedInvoice(ctx: ActorContext, orderId: string): Promise<ChangeOrderView> {
  requireDesignerContext(ctx); getScopedOrder(ctx,orderId);
  await orders.ensureInvoice(orderId,()=>{requireDesignerContext(ctx);getScopedOrder(ctx,orderId);});
  return getScopedOrder(ctx,orderId);
}
/**
 * Operation entrance `get_payment_status`: approval and payment observation for one exact scoped revision. Unfenced.
 * A fresh read retrieves the existing associated invoice only; it never issues, sends, reminds, cancels or enqueues.
 * Another run's order is indistinguishable from an unknown one.
 */
export async function getPaymentStatus(ctx: ServiceContext, input: unknown): Promise<PaymentStatusProjection> {
  requireOperationContext(ctx, "get_payment_status");
  const body = input as any;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["orderId","expectedRevision","refresh"].includes(key)) ||
    typeof body.orderId !== "string" || !body.orderId.trim() || body.orderId.length > 200 || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
    (body.refresh !== undefined && typeof body.refresh !== "boolean")) {
    throw new ScopedAccessError(400, "Only an order ID, its exact expected revision and an optional refresh flag are accepted");
  }
  const current = () => {
    requireOperationContext(ctx, "get_payment_status");
    const row = scopedOrderRow(ctx.projectId, ctx.runId, body.orderId);
    if (!row) throw new ScopedAccessError(404, "Change order not found");
    if (row.revision !== body.expectedRevision) throw new ScopedAccessError(409, "Change order revision changed; reload before reading its payment status");
  };
  current();
  let source: PaymentStatusProjection["source"];
  const paymentOrder=orders.getChangeOrder(body.orderId)!;
  if (body.refresh === true && (paymentOrder.paypalInvoiceId||paymentOrder.installments?.some(m=>!!m.paypalInvoiceId))) {
    await orders.refreshPaymentStatus(body.orderId, current);
    source = "provider_retrieval";
  } else source = orders.getChangeOrder(body.orderId)!.lastCheckedAt ? "stored_observation" : "none";
  current();
  return projectPayment(orders.getChangeOrder(body.orderId)!, source);
}
export async function getSettlement(ctx: ActorContext, orderId: string): Promise<ChangeOrderView> {
  getScopedOrder(ctx,orderId);
  await orders.refreshPaymentStatus(orderId,()=>{getScopedOrder(ctx,orderId);});
  return getScopedOrder(ctx,orderId);
}
