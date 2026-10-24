import { randomUUID } from "node:crypto";
import {hasExplicitSchedule} from './milestoneStore.js';
export {prepareMilestoneAction,confirmMilestoneAction,getMilestoneAction} from './installmentActions.js';
import { db, getProjectForRun, transaction } from "./db.js";
import {
  requireDesignerContext,
  requireOperationContext,
  sessionForContext,
  ScopedAccessError,
  type ActorContext,
  type ServiceContext,
} from "./context.js";
import { contentHash } from "./scopePersistence.js";
import {
  scopeContextForRun,
  contextCurrent,
  contextRatesCurrent,
  linkedScopeContext,
} from "./scopeLedger.js";
import {
  requestById,
  messagesFor,
  now,
  runtimeValue,
  setRuntimeValue,
} from "./agentStore.js";
import {
  refreshFigmaSource,
  captureRequestSource,
  requireSourceCurrent,
  requireAssessedSourceCurrent,
  SourceUnavailableError,
  type RequestSourceReference,
} from "./requestSources.js";
import { postComment, FigmaRequestError } from "./figma.js";
import {
  getAccessToken,
  getInvoice,
  findInvoiceByNumber,
  notifyInvoice,
  PayPalRequestError,
  type InvoiceNotification,
  type InvoiceDetail,
} from "./paypal.js";
import { getScopedOrder, submitScopedOrder } from "./changeOrderService.js";
import {
  getChangeOrder,
  ensureInvoice,
  itemSourceState,
  isTombstonedInvoice,
  refreshPaymentStatus,
} from "./orders.js";
import {
  invoiceTermProblems,
  validateItemizedInvoiceTerms,
  type ApprovedInvoiceTerms,
} from "./paymentState.js";
import {
  claimOutbound,
  beginOutbound,
  finishOutbound,
  requireUnpaidInvoice,
} from "./outboundActions.js";
import {
  connectorRow,
  connectorRecord,
  connectorEligible,
} from "./connectorStore.js";
import {
  projectPreparedAction,
  type ActionPreparationProjection,
} from "./connectorProjections.js";
import { recordPublishedOrder } from "./requestLinks.js";
import { config } from "./env.js";
import type { ChangeOrderView, LineItem } from "../shared/types.js";

export type DisplayedRequestReference = {
  requestVersion: number;
  source: RequestSourceReference;
};
export type ReviewedActionInput =
  | ((
      | { kind: "post_clarification"; requestId: string; text: string }
      | {
          kind: "remind_invoice" | "cancel_invoice";
          requestId: string;
          orderId: string;
          revision: number;
          recipients: {
            sendToRecipient: boolean;
            sendToInvoicer: boolean;
            additionalRecipients: string[];
          };
        }
    ) & { expected: DisplayedRequestReference })
  | {
      kind: "submit_for_client_approval" | "issue_approved_invoice";
      orderId: string;
      expectedRevision: number;
    };
export interface ActionResult {
  id: string;
  state: "executing" | "acknowledged" | "reconciled" | "uncertain" | "denied";
  providerId?: string;
  providerStatus?: string;
  message: string;
  authorityChanged?: boolean;
  providerActorId?: string;
  notificationDelivery: "unverified";
  orderId?: string;
  revision?: number;
  /** Returned only to the authenticated owner designer confirmation call for submit_for_client_approval; never stored in preview_json, result_json or MCP output. */
  approvalUrl?: string;
  approvalExpiresAt?: string;
  /** Cancellation only: whether local payment status shows the confirmed CANCELLED. */
  localProjection?: "applied" | "pending";
}
export interface ActionPreview {
  id: string;
  kind: ReviewedActionInput["kind"];
  projectId: string;
  runId: string;
  initiatorId: string;
  confirmerId: string;
  parent: {
    grantId: string | null;
    actorId: string;
    connectorId?: string;
    parentKind?: "grant" | "session";
    parentRef?: string;
  };
  requestId: string;
  requestVersion: number;
  source: RequestSourceReference;
  fileKey: string;
  rootId: string;
  rootHash?: string;
  orderId?: string;
  revision?: number;
  title?: string;
  deliverables?: string[];
  lineItems?: LineItem[];
  totalMinor?: number;
  currency?: string;
  itemIds?: string[];
  assessmentId?: string | null;
  scope?: {
    scopeRevisionId: string | null;
    contextId?: string | null;
    contextVersion?: number;
    contextFingerprint?: string;
    scopeSnapshotId?: string;
    scopeVersion: number | null;
    rateSnapshotId?: string;
    rateVersion: number | null;
  };
  proposalTermsHash?: string;
  paypalEnv?: string;
  approvalId?: string;
  approvalAt?: string;
  invoiceId?: string;
  termsHash?: string;
  approvedTerms?: ApprovedInvoiceTerms;
  recipients?: { primary: string[]; merchant: string; cc: string[] };
  notification?: InvoiceNotification;
  text?: string;
  wording: string;
  expiresAt: string;
  previewHash: string;
  reviewUrl: string;
}
type Stored = Omit<ActionPreview, "previewHash" | "reviewUrl">;
function fail(message: string): never {
  throw new ScopedAccessError(409, message);
}
function only(value: any, keys: string[]) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k))
  );
}
function request(ctx: ActorContext, id: string) {
  requireDesignerContext(ctx);
  const r = requestById(id, ctx.runId);
  if (!r || r.state === "dismissed") fail("Current request required");
  return r;
}
function termsFor(
  ctx: ActorContext,
  requestId: string,
  orderId: string,
  revision: number,
) {
  const order = getScopedOrder(ctx, orderId),
    link = db
      .prepare(
        "SELECT request_id FROM request_order_links WHERE request_id=? AND run_id=? AND order_id=? AND revision=?",
      )
      .get(requestId, ctx.runId, orderId, revision);
  if (
    !link ||
    order.revision !== revision ||
    order.approvalStatus !== "approved" ||
    !order.paypalInvoiceId
  )
    fail("Select the exact linked approved invoice revision");
  return approvedTerms(order);
}
/** Immutable approved terms of the order's current revision, hashed with its identity. */
function approvedTerms(order: ChangeOrderView) {
  const operation = db
    .prepare(
      "SELECT approved_terms_json FROM invoice_operations WHERE change_order_id=?",
    )
    .get(order.id) as any;
  const approval = db
    .prepare(
      "SELECT created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client'",
    )
    .get(order.id, order.revision) as any;
  if (!approval || !operation?.approved_terms_json)
    fail("Immutable approved invoice terms required");
  const terms: ApprovedInvoiceTerms = {
    ...JSON.parse(operation.approved_terms_json),
    invoiceId: order.paypalInvoiceId,
  };
  return {
    order,
    terms,
    approvalAt: approval.created_at as string,
    hash: contentHash({ orderId: order.id, revision: order.revision, terms }),
  };
}
function notification(detail: InvoiceDetail, input: any) {
  if (
    !only(input, [
      "sendToRecipient",
      "sendToInvoicer",
      "additionalRecipients",
    ]) ||
    typeof input.sendToRecipient !== "boolean" ||
    typeof input.sendToInvoicer !== "boolean" ||
    !Array.isArray(input.additionalRecipients) ||
    input.additionalRecipients.length > 100 ||
    input.additionalRecipients.some(
      (v: any) => typeof v !== "string" || v.length > 254,
    ) ||
    new Set(input.additionalRecipients).size !==
      input.additionalRecipients.length
  )
    throw new ScopedAccessError(
      400,
      "Explicit notification recipients required",
    );
  const raw = detail.raw,
    primary = (raw.primary_recipients ?? []).map(
      (r: any) => r.billing_info?.email_address,
    ),
    merchant = raw.invoicer?.email_address,
    cc = raw.additional_recipients ?? [];
  if (
    !primary.length ||
    primary.some((s: any) => typeof s !== "string" || s.length > 254) ||
    typeof merchant !== "string" ||
    !Array.isArray(cc) ||
    cc.some((s: any) => typeof s !== "string" || s.length > 254)
  )
    fail("Invoice recipient identity is unavailable");
  // PayPal omission means all existing CCs. Until empty-selection behavior is qualified,
  // support no existing CCs, or the explicit complete existing set only.
  if (
    contentHash([...input.additionalRecipients].sort()) !==
    contentHash([...cc].sort())
  )
    fail(
      "Select the complete existing CC set; partial/empty CC suppression is not qualified",
    );
  return {
    recipients: { primary, merchant, cc: [...cc].sort() },
    notification: {
      send_to_recipient: input.sendToRecipient,
      send_to_invoicer: input.sendToInvoicer,
      additional_recipients: [...input.additionalRecipients].sort(),
    } as InvoiceNotification,
  };
}
async function sourceFor(
  ctx: ActorContext,
  r: ReturnType<typeof request>,
  guard: () => void,
) {
  if (r.source === "figma") {
    const resolved = await refreshFigmaSource(ctx.runId, r.source_id, guard);
    guard();
    if (resolved.root.resolvedAt)
      fail(
        "Resolved thread cannot receive a reviewed clarification or invoice action",
      );
    // A successful authoritative read must agree with the displayed inbox source.
    const row = db
      .prepare(
        "SELECT availability,source_id,source_version FROM request_inbox WHERE request_id=? AND run_id=?",
      )
      .get(r.id, ctx.runId) as any;
    if (
      row &&
      (row.availability !== "available" ||
        row.source_id !== resolved.reference.id ||
        row.source_version !== resolved.reference.version)
    )
      fail("Refresh the inbox to the current available authoritative thread");
    return {
      reference: resolved.reference,
      rootHash: contentHash({ root: resolved.root, replies: resolved.replies }),
    };
  }
  const source = {
    source: r.source,
    rootId: r.source_id,
    fileKey: "",
    messages: messagesFor(r.id, r.run_id)
      .filter((m) => m.actor === "client")
      .map((m) => ({ id: m.source_id ?? m.id, message: m.body })),
  };
  return { reference: captureRequestSource(ctx.runId, source) };
}
/** Fresh authoritative reads and immutable preview persistence only; no executable outbox. */
export async function prepareReviewedAction(
  ctx: ActorContext,
  input: ReviewedActionInput,
): Promise<ActionPreview> {
  requireDesignerContext(ctx);
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input.kind === "submit_for_client_approval" ||
      input.kind === "issue_approved_invoice")
  ) {
    if (!only(input, ["kind", "orderId", "expectedRevision"]))
      throw new ScopedAccessError(400, "Unsupported reviewed action input");
    return prepareOrderAction(ctx, input.kind, {
      orderId: input.orderId,
      expectedRevision: input.expectedRevision,
    });
  }
  if (
    !only(
      input,
      input?.kind === "post_clarification"
        ? ["kind", "requestId", "text", "expected"]
        : [
            "kind",
            "requestId",
            "orderId",
            "revision",
            "recipients",
            "expected",
          ],
    ) ||
    !["post_clarification", "remind_invoice", "cancel_invoice"].includes(
      input.kind,
    ) ||
    typeof (input as any).requestId !== "string" ||
    (input as any).requestId.length > 200
  )
    throw new ScopedAccessError(400, "Unsupported reviewed action input");
  const reqInput = input as Exclude<
    ReviewedActionInput,
    { kind: "submit_for_client_approval" | "issue_approved_invoice" }
  >;
  const r = request(ctx, reqInput.requestId),
    session = sessionForContext(ctx),
    id = randomUUID();
  if (
    !only(reqInput.expected, ["requestVersion", "source"]) ||
    reqInput.expected.requestVersion !== r.version ||
    !only(reqInput.expected.source, ["id", "version", "contentHash"]) ||
    typeof reqInput.expected.source.id !== "string" ||
    !Number.isSafeInteger(reqInput.expected.source.version) ||
    typeof reqInput.expected.source.contentHash !== "string"
  )
    fail("Exact displayed request reference required");
  requireSourceCurrent(ctx.runId, reqInput.expected.source);
  const guard = () => {
    const fresh = request(ctx, r.id);
    if (
      fresh.version !== r.version ||
      fresh.source !== r.source ||
      fresh.source_id !== r.source_id
    )
      fail("Request changed during action review");
  };
  const source = await sourceFor(ctx, r, guard);
  guard();
  if (contentHash(source.reference) !== contentHash(reqInput.expected.source))
    fail("Displayed source changed; refresh the inbox");
  const preview: Stored = {
    id,
    kind: reqInput.kind,
    projectId: ctx.projectId,
    runId: ctx.runId,
    initiatorId: ctx.actorId,
    confirmerId: ctx.actorId,
    parent: { grantId: session.grantId, actorId: ctx.actorId },
    requestId: r.id,
    requestVersion: r.version,
    source: source.reference,
    fileKey:
      r.source === "figma" ? getProjectForRun(ctx.runId).figmaFileKey : "",
    rootId: r.source_id,
    ...(source.rootHash ? { rootHash: source.rootHash } : {}),
    wording: "",
    expiresAt: new Date(
      Math.min(Date.now() + 10 * 60000, Date.parse(session.expiresAt)),
    ).toISOString(),
  };
  if (reqInput.kind === "post_clarification") {
    if (!config.figmaCommentPostingEnabled)
      throw new ScopedAccessError(
        403,
        "Figma posting is disabled; enable it with file_comments:write permission",
      );
    if (
      r.source !== "figma" ||
      typeof reqInput.text !== "string" ||
      !reqInput.text.trim() ||
      reqInput.text.length > 3500
    )
      throw new ScopedAccessError(
        400,
        "A Figma request and question of at most 3500 characters are required",
      );
    preview.text = `${reqInput.text.trim()}\n[Scope & Settle reviewed:${id}]`;
    preview.wording =
      "The exact question below will be posted as a reply in this Figma thread.";
  } else {
    if (
      !Number.isSafeInteger(reqInput.revision) ||
      typeof reqInput.orderId !== "string" ||
      reqInput.orderId.length > 200
    )
      throw new ScopedAccessError(400, "Exact order and revision required");
    const terms = termsFor(ctx, r.id, reqInput.orderId, reqInput.revision),
      detail = await getInvoice(terms.order.paypalInvoiceId!, () => {
        guard();
        return true;
      });
    guard();
    requireUnpaidInvoice(detail, terms.terms);
    const freshTerms = termsFor(ctx, r.id, reqInput.orderId, reqInput.revision);
    if (freshTerms.hash !== terms.hash)
      fail("Approved invoice terms changed during preparation");
    Object.assign(preview, {
      orderId: reqInput.orderId,
      revision: reqInput.revision,
      invoiceId: detail.id,
      termsHash: terms.hash,
      approvedTerms: terms.terms,
      ...notification(detail, reqInput.recipients),
    });
    preview.wording = `PayPal supplies the system-defined ${reqInput.kind === "remind_invoice" ? "reminder" : "cancellation"} subject and note; custom wording is ignored. ${reqInput.kind === "cancel_invoice" ? "Cancellation changes this invoice only; agreed work and approval remain committed. " : ""}Acknowledgement does not prove notification delivery.`;
  }
  guard();
  requireSourceCurrent(ctx.runId, preview.source);
  const hash = contentHash(preview),
    at = now();
  db.prepare(
    "INSERT INTO reviewed_actions(id,project_id,run_id,initiator_id,confirmer_id,kind,request_id,preview_json,preview_hash,expires_at,state,operation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?)",
  ).run(
    id,
    ctx.projectId,
    ctx.runId,
    ctx.actorId,
    ctx.actorId,
    reqInput.kind,
    r.id,
    JSON.stringify(preview),
    hash,
    preview.expiresAt,
    `reviewed:${id}`,
    at,
    at,
  );
  return {
    ...preview,
    previewHash: hash,
    reviewUrl: `${config.publicUrl}/designer?action=${encodeURIComponent(id)}`,
  };
}

function normalizedLines(items: LineItem[]): LineItem[] {
  return items.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitAmountMinor: li.unitAmountMinor,
    priceSource: li.priceSource === "designer" ? "designer" : "rate_card",
    rateCardId: li.rateCardId ?? null,
  }));
}

function validateTermsOrFail(
  terms: Pick<ApprovedInvoiceTerms, "currency" | "totalMinor" | "lineItems">,
) {
  try {
    validateItemizedInvoiceTerms(terms);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid invoice terms");
  }
}

function orderItemsFor(orderId: string) {
  return db
    .prepare(
      `SELECT r.item_id, r.state, r.assessment_id, i.source_id, i.source_version, s.source, s.file_key, s.root_id, s.version AS current_source_version, s.content_hash
       FROM proposal_item_reservations r
       LEFT JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id
       LEFT JOIN request_sources s ON s.id=i.source_id
       WHERE r.order_id=? AND r.state IN ('reserved','committed')
       ORDER BY r.rowid`,
    )
    .all(orderId) as any[];
}

/**
 * Shared action-preparation path for `submit_for_client_approval` and `issue_approved_invoice`.
 * Zero publication, approval, invoice, outbox, provider or AI effects.
 */
export async function prepareOrderAction(
  ctx: ServiceContext,
  kind: "submit_for_client_approval" | "issue_approved_invoice",
  input: unknown,
): Promise<ActionPreview> {
  const authority = requireOperationContext(ctx, kind);
  const body = input as any;
  if (
    !only(body, ["orderId", "expectedRevision"]) ||
    typeof body.orderId !== "string" ||
    !body.orderId.trim() ||
    body.orderId.length > 200 ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1
  ) {
    throw new ScopedAccessError(
      400,
      "Only an order ID and its exact expected revision are accepted",
    );
  }
  const row = db
    .prepare(
      "SELECT id, revision FROM change_orders WHERE id=? AND project_id=? AND run_id=?",
    )
    .get(body.orderId, ctx.projectId, ctx.runId) as any;
  if (!row) throw new ScopedAccessError(404, "Change order not found");
  if (row.revision !== body.expectedRevision)
    fail("Change order revision changed; reload before preparing this action");
  const order = getChangeOrder(body.orderId)!;
  if(kind==='issue_approved_invoice'&&hasExplicitSchedule(order.id,order.revision))fail('Select the exact installment in the authenticated designer application');
  const project = getProjectForRun(ctx.runId);
  const items = orderItemsFor(order.id);
  const rootId = String(items[0]?.root_id ?? order.commentId ?? order.id);
  const sourceKind = String(items[0]?.source ?? "figma");
  const linkedReq =
    (db
      .prepare(
        "SELECT id, version FROM agent_requests WHERE run_id=? AND (order_id=? OR (source=? AND source_id=?)) ORDER BY updated_at DESC LIMIT 1",
      )
      .get(ctx.runId, order.id, sourceKind, rootId) as any) ?? null;

  const id = randomUUID();
  const initiatorId =
    authority.kind === "connector"
      ? `connector:${authority.connector.id}`
      : ctx.actorId;
  const confirmerId =
    authority.kind === "connector"
      ? authority.connector.ownerActorId
      : ctx.actorId;
  const parent: Stored["parent"] =
    authority.kind === "connector"
      ? {
          grantId:
            authority.connector.parentKind === "grant"
              ? authority.connector.parentRef
              : null,
          actorId: authority.connector.ownerActorId,
          connectorId: authority.connector.id,
          parentKind: authority.connector.parentKind,
          parentRef: authority.connector.parentRef,
        }
      : { grantId: authority.session.grantId, actorId: ctx.actorId };
  const parentExpiry =
    authority.kind === "connector"
      ? authority.connector.expiresAt
      : authority.session.expiresAt;
  const expiresAt = new Date(
    Math.min(Date.now() + 10 * 60000, Date.parse(parentExpiry)),
  ).toISOString();

  const sourceRef: RequestSourceReference = items[0]?.source_id
    ? {
        id: String(items[0].source_id),
        version: Number(items[0].source_version),
        contentHash: String(items[0].content_hash),
      }
    : {
        id: order.id,
        version: order.revision,
        contentHash: contentHash(order.deliverables),
      };

  const preview: Stored = {
    id,
    kind,
    projectId: ctx.projectId,
    runId: ctx.runId,
    initiatorId,
    confirmerId,
    parent,
    requestId: linkedReq ? String(linkedReq.id) : "",
    requestVersion: linkedReq ? Number(linkedReq.version) : 0,
    source: sourceRef,
    fileKey: project.figmaFileKey,
    rootId,
    orderId: order.id,
    revision: order.revision,
    title: order.title,
    deliverables: [...order.deliverables],
    wording: "",
    expiresAt,
  };

  if (kind === "submit_for_client_approval") {
    if (
      order.approvalStatus === "approved" ||
      order.paypalInvoiceId ||
      !["draft", "awaiting_client_approval", "needs_re_review"].includes(
        order.status,
      )
    ) {
      fail(
        "Only an unapproved editable proposal can be submitted for client approval",
      );
    }
    const srcState = itemSourceState(order.id);
    if (srcState === "unavailable") throw new SourceUnavailableError();
    if (srcState === "changed")
      fail("Request source changed; reserved item terms need designer review");
    for (const item of items) {
      if (item.source_id) {
        requireAssessedSourceCurrent(
          String(item.source_id),
          Number(item.source_version),
          "Request source changed or is unavailable; reserved item terms need designer review",
        );
      }
    }
    validateTermsOrFail(order);
    if (order.currency !== project.currency)
      fail("Proposal currency does not match project currency");
    const scopeCtx = scopeContextForRun(ctx.runId);
    if (order.scopeContext && !contextRatesCurrent(order.scopeContext, ctx.runId))
      fail(
        "Rates changed or historical rates are unknown; edit and review the proposal rates before submitting",
      );
    if (
      order.assessmentId &&
      !contextCurrent(linkedScopeContext("assessment", order.assessmentId), ctx.runId)
    )
      fail(
        "Assessment context changed; designer re-review or reassessment is required",
      );
    if (order.scopeContext && !contextCurrent(order.scopeContext, ctx.runId))
      fail("Scope context changed; designer re-review is required before submitting");
    if (
      order.stale ||
      (order.scopeRevisionId && order.scopeRevisionId !== project.scopeRevisionId)
    )
      fail("Scope baseline changed; designer re-review is required before submitting");

    const lines = normalizedLines(order.lineItems);
    const reservedItemIds = items
      .filter((r) => r.state === "reserved")
      .map((r) => String(r.item_id));
    const scopeSummary = {
      scopeRevisionId: project.scopeRevisionId,
      contextId: order.scopeContext?.id ?? null,
      contextVersion: scopeCtx.contextVersion,
      contextFingerprint: scopeCtx.contextFingerprint,
      scopeSnapshotId: scopeCtx.scopeSnapshot.id,
      scopeVersion: scopeCtx.scopeSnapshot.version,
      rateSnapshotId: scopeCtx.rateSnapshot.id,
      rateVersion: scopeCtx.rateSnapshot.version,
    };
    preview.lineItems = lines;
    preview.totalMinor = order.totalMinor;
    preview.currency = order.currency;
    preview.itemIds = reservedItemIds;
    preview.assessmentId = order.assessmentId;
    preview.scope = scopeSummary;
    preview.proposalTermsHash = contentHash({
      orderId: order.id,
      revision: order.revision,
      title: order.title,
      deliverables: order.deliverables,
      lineItems: lines,
      totalMinor: order.totalMinor,
      currency: order.currency,
      itemIds: reservedItemIds,
      assessmentId: order.assessmentId,
      scope: scopeSummary,
      source: preview.source,
    });
    preview.wording =
      "Submit this proposal revision for client review. Confirmation publishes these exact terms and issues a private client review link inside the authenticated designer application; it does not approve the proposal or create an invoice.";
  } else {
    const approval = db
      .prepare(
        "SELECT id, scope_revision_id, created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client' ORDER BY id DESC LIMIT 1",
      )
      .get(order.id, order.revision) as any;
    if (order.approvalStatus !== "approved" || !approval)
      fail(
        "Invoice preparation requires persisted client approval of this exact revision",
      );
    const proposal = db
      .prepare(
        "SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?",
      )
      .get(order.id, order.revision) as any;
    if (!proposal) fail("Missing immutable approved proposal terms");
    const snapshot = JSON.parse(proposal.snapshot_json);
    validateTermsOrFail(order);
    validateTermsOrFail(snapshot);
    const merchantEmail = snapshot.merchantEmail ?? config.paypalMerchantEmail;
    if (
      typeof merchantEmail !== "string" ||
      !merchantEmail.trim() ||
      merchantEmail.toLowerCase() !== config.paypalMerchantEmail.toLowerCase()
    ) {
      fail("Approved proposal merchant differs from configured PayPal merchant");
    }
    const orderLines = normalizedLines(order.lineItems);
    const snapLines = normalizedLines(snapshot.lineItems ?? []);
    if (
      order.currency !== snapshot.currency ||
      order.currency !== project.currency ||
      order.totalMinor !== snapshot.totalMinor ||
      JSON.stringify(orderLines) !== JSON.stringify(snapLines) ||
      JSON.stringify(order.deliverables) !==
        JSON.stringify(snapshot.deliverables)
    ) {
      fail("Approved proposal terms do not match persisted approval snapshot");
    }
    if (
      !order.scopeRevisionId ||
      order.scopeRevisionId !== approval.scope_revision_id ||
      (snapshot.scopeRevisionId &&
        snapshot.scopeRevisionId !== order.scopeRevisionId)
    ) {
      fail("Approved scope revision does not match proposal snapshot");
    }
    if (order.paypalInvoiceId && isTombstonedInvoice(order.paypalInvoiceId))
      fail("Associated invoice is tombstoned");

    const existingOp = db
      .prepare(
        "SELECT representation, approved_terms_json, paypal_invoice_id FROM invoice_operations WHERE change_order_id=?",
      )
      .get(order.id) as any;
    const representation = (existingOp?.representation ?? "itemized-v1") as
      | "itemized-v1"
      | "aggregate-v0";
    const reference =
      representation === "itemized-v1"
        ? `order:${order.id};revision:${snapshot.revision};scope:${snapshot.scopeRevisionId}`
        : `SS-${order.id.slice(0, 8)}`;
    const invoiceNumber =
      representation === "itemized-v1"
        ? `SS-${order.id.replaceAll("-", "").slice(0, 22)}`
        : reference;
    const terms: ApprovedInvoiceTerms = existingOp?.approved_terms_json
      ? {
          ...JSON.parse(existingOp.approved_terms_json),
          ...(order.paypalInvoiceId ? { invoiceId: order.paypalInvoiceId } : {}),
        }
      : {
          merchantEmail,
          merchantProvenance: snapshot.merchantEmail
            ? "approval-snapshot"
            : "legacy-configuration",
          currency: snapshot.currency,
          totalMinor: snapshot.totalMinor,
          lineItems: orderLines,
          representation,
          reference,
          invoiceNumber,
        };
    if (
      terms.currency !== order.currency ||
      terms.totalMinor !== order.totalMinor ||
      terms.merchantEmail.toLowerCase() !==
        config.paypalMerchantEmail.toLowerCase()
    ) {
      fail("Stored invoice operation terms do not match the approved proposal");
    }
    const scopeSummary = {
      scopeRevisionId: order.scopeRevisionId,
      contextId: order.scopeContext?.id ?? null,
      scopeVersion: order.scopeContext?.scopeVersion ?? null,
      rateVersion: order.scopeContext?.rateVersion ?? null,
    };
    preview.approvedTerms = terms;
    preview.paypalEnv = config.paypalEnv;
    preview.approvalId = String(approval.id);
    preview.approvalAt = String(approval.created_at);
    preview.scope = scopeSummary;
    preview.termsHash = contentHash({
      orderId: order.id,
      revision: order.revision,
      approvalId: String(approval.id),
      paypalEnv: config.paypalEnv,
      merchantEmail: merchantEmail.toLowerCase(),
      currency: order.currency,
      totalMinor: order.totalMinor,
      lineItems: orderLines,
      deliverables: order.deliverables,
      scope: scopeSummary,
    });
    preview.wording =
      "Issue or recover the PayPal invoice for this client-approved proposal revision. Confirmation verifies the persisted client approval, exact revision, scope, merchant, currency and itemized amounts before calling PayPal.";
  }

  requireOperationContext(ctx, kind);
  const hash = contentHash(preview),
    at = now();
  db.prepare(
    "INSERT INTO reviewed_actions(id,project_id,run_id,initiator_id,confirmer_id,kind,request_id,preview_json,preview_hash,expires_at,state,operation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?)",
  ).run(
    id,
    ctx.projectId,
    ctx.runId,
    initiatorId,
    confirmerId,
    kind,
    preview.requestId,
    JSON.stringify(preview),
    hash,
    preview.expiresAt,
    `reviewed:${id}`,
    at,
    at,
  );
  return {
    ...preview,
    previewHash: hash,
    reviewUrl: `${config.publicUrl}/designer?action=${encodeURIComponent(id)}`,
  };
}

export async function prepareConnectorSubmit(
  ctx: ServiceContext,
  input: unknown,
): Promise<ActionPreparationProjection> {
  const preview = await prepareOrderAction(
    ctx,
    "submit_for_client_approval",
    input,
  );
  return projectPreparedAction(
    preview as ActionPreview & { kind: "submit_for_client_approval" },
  );
}

export async function prepareConnectorInvoice(
  ctx: ServiceContext,
  input: unknown,
): Promise<ActionPreparationProjection> {
  const preview = await prepareOrderAction(
    ctx,
    "issue_approved_invoice",
    input,
  );
  return projectPreparedAction(
    preview as ActionPreview & { kind: "issue_approved_invoice" },
  );
}
function owned(ctx: ActorContext, id: string) {
  requireDesignerContext(ctx);
  const row = db
    .prepare(
      "SELECT * FROM reviewed_actions WHERE id=? AND project_id=? AND run_id=? AND confirmer_id=?",
    )
    .get(id, ctx.projectId, ctx.runId, ctx.actorId) as any;
  if (!row)
    throw new ScopedAccessError(
      404,
      "Reviewed action not found for this application actor",
    );
  return row;
}
export function getReviewedAction(ctx: ActorContext, id: string) {
  const row = owned(ctx, id);
  return {
    preview: {
      ...JSON.parse(row.preview_json),
      previewHash: row.preview_hash,
      reviewUrl: `${config.publicUrl}/designer?action=${encodeURIComponent(id)}`,
    },
    result: row.result_json
      ? JSON.parse(row.result_json)
      : { id, state: row.state },
  };
}
function result(
  id: string,
  state: ActionResult["state"],
  message: string,
  extra: any = {},
): ActionResult {
  return { id, state, message, notificationDelivery: "unverified", ...extra };
}
function storeResult(
  id: string,
  r: ActionResult,
  retryAfter: number | null = null,
) {
  return transaction(() => {
    finishOutbound(
      id,
      r.state === "executing" ? "uncertain" : r.state,
      r,
      retryAfter,
    );
    db.prepare(
      "UPDATE reviewed_actions SET state=?,result_json=?,updated_at=? WHERE id=?",
    ).run(r.state, JSON.stringify(r), now(), id);
    return r;
  });
}
/**
 * Authority to record provider truth about an already-sent cancellation: the live designer
 * owning this action, the scoped order and the exact stored association. Preview expiry and
 * request/source currency fence only new outbound effects, so they are deliberately absent.
 */
function cancellationAuthority(ctx: ActorContext, p: Stored) {
  owned(ctx, p.id);
  const order = getScopedOrder(ctx, p.orderId!);
  if (
    order.revision !== p.revision ||
    order.approvalStatus !== "approved" ||
    order.paypalInvoiceId !== p.invoiceId ||
    approvedTerms(order).hash !== p.termsHash
  )
    fail(
      "The reviewed invoice association changed; local status was not updated",
    );
  return order;
}
function projected(outcome: ActionResult, applied: boolean): ActionResult {
  return {
    ...outcome,
    localProjection: applied ? "applied" : "pending",
    message: applied
      ? "PayPal confirms CANCELLED and local payment status now shows it; cause and notification delivery are unverified"
      : "PayPal confirms CANCELLED; the local payment status update is still pending (Check payment retries it); cause and notification delivery are unverified",
  };
}
/**
 * The single local projection of a matching authoritative CANCELLED. It never sends: the
 * serialized payment refresh takes one fresh read and applies it transactionally. A failure
 * leaves the stored provider outcome untouched and is reported as pending.
 */
async function projectCancellation(
  ctx: ActorContext,
  p: Stored,
  outcome: ActionResult,
): Promise<ActionResult> {
  let applied = false;
  try {
    const order = await refreshPaymentStatus(p.orderId!, () => {
      cancellationAuthority(ctx, p);
    });
    applied = order.financialState?.invoiceState === "cancelled";
  } catch {}
  return projected(outcome, applied);
}
function locallyCancelled(ctx: ActorContext, p: Stored) {
  try {
    return (
      cancellationAuthority(ctx, p).financialState?.invoiceState === "cancelled"
    );
  } catch {
    return false;
  }
}
async function reconcile(ctx: ActorContext, row: any): Promise<ActionResult> {
  const p: Stored = JSON.parse(row.preview_json),
    saved = row.result_json
      ? JSON.parse(row.result_json)
      : result(p.id, "uncertain", "Delivery is uncertain; do not resend");
  if (p.kind === "cancel_invoice") {
    let cancelled: ActionResult | undefined;
    try {
      const detail = await getInvoice(p.invoiceId!, () => {
        owned(ctx, p.id);
        return true;
      });
      if (
        detail.id === p.invoiceId &&
        detail.status === "CANCELLED" &&
        p.approvedTerms &&
        !invoiceTermProblems(detail, p.approvedTerms).length
      )
        cancelled = storeResult(
          p.id,
          result(
            p.id,
            "reconciled",
            "PayPal confirms CANCELLED; cause and notification delivery are unverified",
            { providerStatus: "CANCELLED" },
          ),
        );
    } catch {}
    // Dispatch, its error path, later confirmations and restart recovery all arrive here.
    if (cancelled) return projectCancellation(ctx, p, cancelled);
  }
  if (p.kind === "issue_approved_invoice") {
    try {
      const order = getScopedOrder(ctx, p.orderId!);
      const existingOp = db
        .prepare("SELECT paypal_invoice_id FROM invoice_operations WHERE change_order_id=?")
        .get(order.id) as any;
      let invoiceId: string | null =
        order.paypalInvoiceId ?? existingOp?.paypal_invoice_id ?? null;
      if (!invoiceId && p.approvedTerms?.invoiceNumber) {
        invoiceId = await findInvoiceByNumber(
          p.approvedTerms.invoiceNumber,
          () => {
            owned(ctx, p.id);
            return true;
          },
        );
      }
      if (invoiceId) {
        const detail = await getInvoice(invoiceId, () => {
          owned(ctx, p.id);
          return true;
        });
        if (
          detail.id === invoiceId &&
          detail.status !== "DRAFT" &&
          p.approvedTerms &&
          !invoiceTermProblems(detail, { ...p.approvedTerms, invoiceId }).length
        ) {
          transaction(() => {
            owned(ctx, p.id);
            db.prepare(
              "UPDATE change_orders SET paypal_invoice_id=COALESCE(paypal_invoice_id,?),invoice_url=COALESCE(invoice_url,?) WHERE id=?",
            ).run(detail.id, detail.payerViewUrl, order.id);
            db.prepare(
              "UPDATE invoice_operations SET state='sent',paypal_invoice_id=COALESCE(paypal_invoice_id,?),updated_at=? WHERE change_order_id=?",
            ).run(detail.id, now(), order.id);
          });
          await refreshPaymentStatus(order.id, () => {
            owned(ctx, p.id);
          });
          return storeResult(
            p.id,
            result(
              p.id,
              "reconciled",
              "PayPal confirms the approved invoice was issued; local payment status is updated",
              { providerId: detail.id, providerStatus: detail.status },
            ),
          );
        }
      }
    } catch {}
    // A failed read may retain the saved outcome, but an owner who lost authority
    // during that read must receive an authentication failure rather than that fallback.
    owned(ctx, p.id);
  }
  // Figma has no safe resend or strong posting-identity receipt when the ACK was lost.
  // The unique reviewed marker is retained for manual provider inspection, not a receipt.
  return saved;
}

function assertConnectorParentLive(ctx: ActorContext, p: Stored) {
  const session = sessionForContext(ctx);
  if (
    (session.grantId ?? null) !== p.parent.grantId ||
    ctx.actorId !== p.parent.actorId
  ) {
    fail("Confirmer authority does not match the preview parent");
  }
  if (p.parent.connectorId) {
    if (!config.mcpConnectorEnabled)
      fail("The Figma agent connector is disabled on this server");
    const row = connectorRow(p.parent.connectorId);
    const record = row ? connectorRecord(row) : null;
    if (
      !record ||
      !connectorEligible(record) ||
      record.projectId !== ctx.projectId ||
      record.runId !== ctx.runId ||
      record.ownerActorId !== ctx.actorId ||
      !record.operations.includes(p.kind as any)
    ) {
      fail("Initiating connector authority expired, was revoked or changed");
    }
  }
}

const inFlightOrderConfirmations = new Map<string, Promise<ActionResult>>();

/** Application-authenticated exact displayed hash; JSON actor/connector fields grant no authority. */
export async function confirmReviewedAction(
  ctx: ActorContext,
  id: string,
  previewHash: string,
): Promise<ActionResult> {
  const outcome = await confirmOnce(ctx, id, previewHash);
  // The provider outcome is already durable. A pending projection can mean this caller's
  // authority ended mid-call; a caller without current authority receives no data.
  if (outcome.localProjection === "pending") owned(ctx, id);
  return outcome;
}
async function confirmOnce(
  ctx: ActorContext,
  id: string,
  previewHash: string,
): Promise<ActionResult> {
  let row = owned(ctx, id);
  if (typeof previewHash !== "string" || row.preview_hash !== previewHash)
    throw new ScopedAccessError(
      409,
      "Confirm the exact displayed preview hash",
    );
  const inFlight = inFlightOrderConfirmations.get(id);
  if (inFlight) {
    const settled = await inFlight;
    owned(ctx, id);
    return settled;
  }
  if (row.state !== "prepared") {
    if (row.state === "uncertain") return reconcile(ctx, row);
    const saved: ActionResult = row.result_json
      ? JSON.parse(row.result_json)
      : result(id, "executing", "This action is already executing");
    // A stored CANCELLED whose local projection is missing (failed read or interrupted process)
    // retries only the read-only projection; it never resends or relabels the outcome.
    if (
      row.state === "reconciled" &&
      row.kind === "cancel_invoice" &&
      saved.providerStatus === "CANCELLED"
    ) {
      const p: Stored = JSON.parse(row.preview_json);
      return locallyCancelled(ctx, p)
        ? projected(saved, true)
        : projectCancellation(ctx, p, saved);
    }
    return saved;
  }
  const p: Stored = JSON.parse(row.preview_json);
  if (
    Date.parse(row.expires_at) <= Date.now() ||
    contentHash(p) !== previewHash
  )
    fail("Reviewed preview expired or changed");

  if (p.kind === "submit_for_client_approval") {
    const submitGuard = () => {
      const live = owned(ctx, id);
      assertConnectorParentLive(ctx, p);
      if (Date.parse(live.expires_at) <= Date.now())
        fail("Reviewed preview expired");
      const order = getScopedOrder(ctx, p.orderId!);
      if (
        order.revision !== p.revision ||
        order.approvalStatus === "approved" ||
        order.paypalInvoiceId ||
        !["draft", "awaiting_client_approval", "needs_re_review"].includes(
          order.status,
        )
      ) {
        fail("Proposal revision or status changed after preview");
      }
      const srcState = itemSourceState(order.id);
      if (srcState === "unavailable")
        fail("Request source is unavailable; reserved item terms need designer review");
      if (srcState === "changed")
        fail("Request source changed; reserved item terms need designer review");
      const items = orderItemsFor(order.id);
      for (const item of items) {
        if (item.source_id) {
          requireAssessedSourceCurrent(
            String(item.source_id),
            Number(item.source_version),
            "Request source changed or is unavailable; reserved item terms need designer review",
          );
        }
      }
      validateTermsOrFail(order);
      const project = getProjectForRun(ctx.runId);
      const scopeCtx = scopeContextForRun(ctx.runId);
      if (order.currency !== project.currency)
        fail("Proposal currency changed after preview");
      if (order.scopeContext && !contextRatesCurrent(order.scopeContext, ctx.runId))
        fail("Proposal rates changed after preview");
      if (
        order.assessmentId &&
        !contextCurrent(
          linkedScopeContext("assessment", order.assessmentId),
          ctx.runId,
        )
      )
        fail("Assessment context changed after preview");
      if (order.scopeContext && !contextCurrent(order.scopeContext, ctx.runId))
        fail("Scope context changed after preview");
      if (
        order.stale ||
        project.scopeRevisionId !== p.scope?.scopeRevisionId ||
        scopeCtx.contextFingerprint !== p.scope?.contextFingerprint ||
        scopeCtx.scopeSnapshot.id !== p.scope?.scopeSnapshotId ||
        scopeCtx.rateSnapshot.id !== p.scope?.rateSnapshotId
      ) {
        fail("Scope or rate card changed after preview");
      }
      const reservedItemIds = items
        .filter((r) => r.state === "reserved")
        .map((r) => String(r.item_id));
      const lines = normalizedLines(order.lineItems);
      const currentTermsHash = contentHash({
        orderId: order.id,
        revision: order.revision,
        title: order.title,
        deliverables: order.deliverables,
        lineItems: lines,
        totalMinor: order.totalMinor,
        currency: order.currency,
        itemIds: reservedItemIds,
        assessmentId: order.assessmentId,
        scope: p.scope,
        source: p.source,
      });
      if (currentTermsHash !== p.proposalTermsHash)
        fail("Proposal terms changed after preview");
    };
    submitGuard();
    return transaction(() => {
      submitGuard();
      row = owned(ctx, id);
      if (row.state !== "prepared") {
        return row.result_json
          ? JSON.parse(row.result_json)
          : result(id, "executing", "This action is already executing");
      }
      const at = now();
      db.prepare(
        "UPDATE reviewed_actions SET state='executing',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=? AND state='prepared'",
      ).run(ctx.actorId, at, at, id);
      const submitted = submitScopedOrder(ctx, p.orderId!);
      if (p.requestId) {
        const reqRow = requestById(p.requestId, ctx.runId);
        if (
          reqRow &&
          !db
            .prepare(
              "SELECT request_id FROM request_order_links WHERE order_id=? AND request_id<>?",
            )
            .get(submitted.order.id, reqRow.id)
        ) {
          recordPublishedOrder(
            reqRow,
            submitted.order.id,
            submitted.order.revision,
          );
        }
      }
      const ack = result(
        id,
        "acknowledged",
        "Proposal submitted for client review; share the private client review link from the designer application",
        { orderId: submitted.order.id, revision: submitted.order.revision },
      );
      db.prepare(
        "UPDATE reviewed_actions SET state='acknowledged',result_json=?,updated_at=? WHERE id=?",
      ).run(JSON.stringify(ack), now(), id);
      return {
        ...ack,
        approvalUrl: submitted.approvalUrl,
        approvalExpiresAt: submitted.approvalExpiresAt,
      };
    });
  }

  if (p.kind === "issue_approved_invoice") {
    const invoiceGuard = () => {
      const live = owned(ctx, id);
      assertConnectorParentLive(ctx, p);
      if (live.state === "prepared" && Date.parse(live.expires_at) <= Date.now())
        fail("Reviewed preview expired");
      const order = getScopedOrder(ctx, p.orderId!);
      if (order.revision !== p.revision || order.approvalStatus !== "approved")
        fail("Approved proposal revision changed");
      const approval = db
        .prepare(
          "SELECT id, scope_revision_id, created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client' ORDER BY id DESC LIMIT 1",
        )
        .get(order.id, order.revision) as any;
      if (!approval || String(approval.id) !== p.approvalId)
        fail("Persisted client approval changed or is missing");
      const proposal = db
        .prepare(
          "SELECT snapshot_json FROM proposal_revisions WHERE change_order_id=? AND revision=?",
        )
        .get(order.id, order.revision) as any;
      if (!proposal) fail("Missing immutable approved proposal terms");
      const snapshot = JSON.parse(proposal.snapshot_json);
      validateTermsOrFail(order);
      validateTermsOrFail(snapshot);
      const project = getProjectForRun(ctx.runId);
      const merchantEmail = snapshot.merchantEmail ?? config.paypalMerchantEmail;
      if (
        typeof merchantEmail !== "string" ||
        !merchantEmail.trim() ||
        merchantEmail.toLowerCase() !==
          config.paypalMerchantEmail.toLowerCase() ||
        merchantEmail.toLowerCase() !==
          p.approvedTerms!.merchantEmail.toLowerCase() ||
        config.paypalEnv !== p.paypalEnv
      ) {
        fail("PayPal merchant or environment changed after preview");
      }
      const orderLines = normalizedLines(order.lineItems);
      const snapLines = normalizedLines(snapshot.lineItems ?? []);
      if (
        order.currency !== snapshot.currency ||
        order.currency !== project.currency ||
        order.totalMinor !== snapshot.totalMinor ||
        JSON.stringify(orderLines) !== JSON.stringify(snapLines) ||
        JSON.stringify(order.deliverables) !==
          JSON.stringify(snapshot.deliverables)
      ) {
        fail("Approved proposal terms changed after preview");
      }
      if (
        order.scopeRevisionId !== approval.scope_revision_id ||
        order.scopeRevisionId !== p.scope?.scopeRevisionId ||
        (order.scopeContext?.id ?? null) !== (p.scope?.contextId ?? null)
      ) {
        fail("Approved scope context changed after preview");
      }
      const currentHash = contentHash({
        orderId: order.id,
        revision: order.revision,
        approvalId: String(approval.id),
        paypalEnv: config.paypalEnv,
        merchantEmail: merchantEmail.toLowerCase(),
        currency: order.currency,
        totalMinor: order.totalMinor,
        lineItems: orderLines,
        deliverables: order.deliverables,
        scope: p.scope,
      });
      if (currentHash !== p.termsHash)
        fail("Approved invoice terms changed after preview");
      if (order.paypalInvoiceId && isTombstonedInvoice(order.paypalInvoiceId))
        fail("Associated invoice is tombstoned");
      const existingOp = db
        .prepare(
          "SELECT approved_terms_json FROM invoice_operations WHERE change_order_id=?",
        )
        .get(order.id) as any;
      if (existingOp?.approved_terms_json) {
        const opTerms = JSON.parse(existingOp.approved_terms_json);
        if (
          opTerms.currency !== order.currency ||
          opTerms.totalMinor !== order.totalMinor ||
          opTerms.merchantEmail.toLowerCase() !== merchantEmail.toLowerCase()
        ) {
          fail("Stored invoice operation terms do not match approved proposal");
        }
      }
    };

    const runInvoiceConfirmation = async (): Promise<ActionResult> => {
      invoiceGuard();
      await getAccessToken();
      invoiceGuard();
      const claimed = transaction(() => {
        invoiceGuard();
        row = owned(ctx, id);
        if (row.state !== "prepared") return false;
        const at = now();
        db.prepare(
          "UPDATE reviewed_actions SET state='executing',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=? AND state='prepared'",
        ).run(ctx.actorId, at, at, id);
        db.prepare(
          "INSERT INTO agent_outbox(id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES(?,?,?,'invoice',?,?,?,?)",
        ).run(
          id,
          ctx.runId,
          p.requestId,
          JSON.stringify({
            authority: "human_review",
            actionId: id,
            orderId: p.orderId,
            revision: p.revision,
          }),
          `reviewed:${id}`,
          at,
          at,
        );
        claimOutbound({
          id,
          runId: ctx.runId,
          authority: "human_review",
          actionId: id,
          kind: "invoice",
        });
        beginOutbound(id);
        return true;
      });
      if (!claimed) {
        const live = owned(ctx, id);
        return live.result_json
          ? JSON.parse(live.result_json)
          : result(id, "executing", "This action is already executing");
      }
      try {
        const updated = await ensureInvoice(p.orderId!, invoiceGuard);
        return storeResult(
          id,
          result(
            id,
            "acknowledged",
            "PayPal invoice issued and verified for the approved proposal revision",
            {
              providerId: updated.paypalInvoiceId ?? undefined,
              providerStatus:
                updated.financialState?.rawStatus ??
                updated.paymentStatus ??
                "SENT",
              orderId: updated.id,
              revision: updated.revision,
            },
          ),
        );
      } catch (error) {
        if (error instanceof ScopedAccessError) {
          const hasInvoice = !!getChangeOrder(p.orderId!)?.paypalInvoiceId;
          storeResult(
            id,
            result(
              id,
              hasInvoice ? "uncertain" : "denied",
              error.message,
              { authorityChanged: true },
            ),
          );
          throw error;
        }
        const rejected =
          error instanceof PayPalRequestError &&
          error.status !== null &&
          error.status >= 400 &&
          error.status < 500;
        const hasOp = !!db
          .prepare(
            "SELECT operation_key FROM invoice_operations WHERE change_order_id=?",
          )
          .get(p.orderId!);
        const uncertain = hasOp && !rejected;
        return storeResult(
          id,
          result(
            id,
            uncertain ? "uncertain" : "denied",
            uncertain
              ? "Provider outcome is uncertain; check provider outcome without resending"
              : "Invoice action was not acknowledged; review authority, eligibility or provider limits",
          ),
          error instanceof PayPalRequestError ? error.retryAfterAt : null,
        );
      }
    };

    const task = runInvoiceConfirmation().finally(() => {
      if (inFlightOrderConfirmations.get(id) === task)
        inFlightOrderConfirmations.delete(id);
    });
    inFlightOrderConfirmations.set(id, task);
    return await task;
  }
  const guard = () => {
    const live = owned(ctx, id);
    if (Date.parse(live.expires_at) <= Date.now())
      fail("Reviewed preview expired");
    const r = request(ctx, p.requestId);
    if (r.version !== p.requestVersion || r.source_id !== p.rootId)
      fail("Reviewed request changed");
    requireSourceCurrent(ctx.runId, p.source);
    if (p.orderId) {
      const t = termsFor(ctx, p.requestId, p.orderId, p.revision!);
      if (t.hash !== p.termsHash || t.order.paypalInvoiceId !== p.invoiceId)
        fail("Approved invoice revision changed");
    }
  };
  guard();
  const r = request(ctx, p.requestId),
    source = await sourceFor(ctx, r, guard);
  guard();
  if (
    contentHash(source.reference) !== contentHash(p.source) ||
    source.rootHash !== p.rootHash
  )
    fail("Authoritative source changed after preview");
  let invoice: ReturnType<typeof termsFor> | undefined;
  if (p.orderId) {
    invoice = termsFor(ctx, p.requestId, p.orderId, p.revision!);
    const detail = await getInvoice(p.invoiceId!, () => {
      guard();
      return true;
    });
    guard();
    requireUnpaidInvoice(detail, invoice.terms);
    const current = notification(detail, {
      sendToRecipient: p.notification!.send_to_recipient,
      sendToInvoicer: p.notification!.send_to_invoicer,
      additionalRecipients: p.notification!.additional_recipients,
    });
    if (contentHash(current.recipients) !== contentHash(p.recipients))
      fail("Invoice recipients changed after preview");
  }
  const authorityChanged = () => {
    try {
      guard();
      return false;
    } catch {
      return true;
    }
  };
  const kind =
    p.kind === "post_clarification"
      ? "figma"
      : p.kind === "remind_invoice"
        ? "reminder"
        : "cancel";
  const claimed = transaction(() => {
    guard();
    row = owned(ctx, id);
    if (row.state !== "prepared") return false;
    const at = now();
    db.prepare(
      "UPDATE reviewed_actions SET state='executing',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=? AND state='prepared'",
    ).run(ctx.actorId, at, at, id);
    db.prepare(
      "INSERT INTO agent_outbox(id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.runId,
      p.requestId,
      kind,
      JSON.stringify({
        authority: "human_review",
        actionId: id,
        text: p.text,
        invoiceId: p.invoiceId,
        orderId: p.orderId,
        revision: p.revision,
      }),
      `reviewed:${id}`,
      at,
      at,
    );
    try {
      claimOutbound({
        id,
        runId: ctx.runId,
        authority: "human_review",
        actionId: id,
        kind,
        invoiceId: p.invoiceId,
        approvalAt: invoice?.approvalAt,
      });
    } catch (error) {
      const denied = result(
        id,
        "denied",
        error instanceof ScopedAccessError
          ? error.message
          : "Invoice action could not be claimed",
      );
      db.prepare(
        "UPDATE agent_outbox SET state='cancelled',error=? WHERE id=?",
      ).run(denied.message, id);
      db.prepare(
        "UPDATE reviewed_actions SET state='denied',result_json=? WHERE id=?",
      ).run(JSON.stringify(denied), id);
      return false;
    }
    return true;
  });
  if (!claimed) {
    const live = owned(ctx, id);
    return live.result_json
      ? JSON.parse(live.result_json)
      : result(id, "executing", "This action is already executing");
  }
  try {
    guard();
    if (kind === "figma") {
      if (!config.figmaCommentPostingEnabled) fail("Figma posting is disabled");
      if (Date.now() < Number(runtimeValue("figma-next-send-at") || 0))
        fail("Figma send cooldown is active");
      setRuntimeValue("figma-next-send-at", String(Date.now() + 30000));
      const sent = await postComment(p.fileKey, p.rootId, p.text!, guard, () =>
        beginOutbound(id),
      );
      return storeResult(
        id,
        result(
          id,
          "acknowledged",
          "Figma acknowledged this reply; refresh the authoritative thread before reassessment",
          {
            providerId: sent.id,
            providerActorId: sent.userId,
            authorityChanged: authorityChanged(),
          },
        ),
      );
    }
    await notifyInvoice(
      p.invoiceId!,
      kind === "reminder" ? "remind" : "cancel",
      p.notification!,
      () => {
        guard();
        return true;
      },
      () => beginOutbound(id),
    );
    const acknowledged = result(
      id,
      "acknowledged",
      "PayPal acknowledged the action; notification delivery is unverified",
      { providerStatus: "204", authorityChanged: authorityChanged() },
    );
    if (kind === "cancel") {
      // Retain the active invoice reservation until read-back either proves the
      // cancellation or leaves a durable uncertain hold. A 204 alone cannot unlock it.
      transaction(() => {
        const pending = {
          ...acknowledged,
          state: "executing",
          message:
            "Cancellation acknowledged; authoritative read-back in progress",
        };
        db.prepare(
          "UPDATE outbound_operations SET result_json=?,updated_at=? WHERE outbox_id=?",
        ).run(JSON.stringify(pending), now(), id);
        db.prepare(
          "UPDATE reviewed_actions SET result_json=?,updated_at=? WHERE id=?",
        ).run(JSON.stringify(pending), now(), id);
      });
      let reconciled: ActionResult | undefined;
      try {
        reconciled = await reconcile(ctx, owned(ctx, id));
      } catch {}
      if (reconciled?.state === "reconciled") return reconciled;
      return storeResult(
        id,
        result(
          id,
          "uncertain",
          "Cancellation acknowledged; authoritative CANCELLED read-back is pending",
          { providerStatus: "204", authorityChanged: authorityChanged() },
        ),
      );
    }
    return storeResult(id, acknowledged);
  } catch (error) {
    const op = db
      .prepare(
        "SELECT dispatch_started FROM outbound_operations WHERE outbox_id=?",
      )
      .get(id) as any;
    const rejected =
      (error instanceof PayPalRequestError &&
        error.status !== null &&
        error.status >= 400 &&
        error.status < 500) ||
      (error instanceof FigmaRequestError &&
        [400, 401, 403, 404, 429].includes(error.status));
    const uncertain = !!op?.dispatch_started && !rejected;
    const retryAfter =
      error instanceof PayPalRequestError
        ? error.retryAfterAt
        : error instanceof FigmaRequestError && error.status === 429
          ? Date.now() + error.retryAfterSeconds * 1000
          : null;
    if (kind === "figma" && retryAfter)
      setRuntimeValue("figma-next-send-at", String(retryAfter));
    const outcome = storeResult(
      id,
      result(
        id,
        uncertain ? "uncertain" : "denied",
        uncertain
          ? "Provider outcome is uncertain; inspect recorded evidence and do not resend"
          : "Action was not acknowledged; review authority, eligibility or provider limits",
        { authorityChanged: authorityChanged() },
      ),
      retryAfter,
    );
    if (kind === "cancel" && uncertain) {
      try {
        return await reconcile(ctx, owned(ctx, id));
      } catch {}
    }
    return outcome;
  }
}
