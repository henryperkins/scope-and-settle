// Shared contracts between backend, Figma plugin UI, and client review page.

/** Canvas-safe projection. A hidden monetary policy removes money before crossing the native bridge. */
export interface StatusCardView {
  schemaVersion: 1;
  fileKey: string; projectId: string; runId: string; orderId: string; revision: number;
  title: string; deliverables: string[];
  scope: {revisionId: string | null; snapshotId: string | null; version: number | null; rateVersion: number | null; approved: boolean};
  approvalState: string; invoiceState: string; paymentState: string; deliveryState: 'not_recorded';
  paymentObservedAt: string | null; appReadAt: string; projectionVersion: number;
  displayPolicy: {version: number; showAmounts: boolean};
  money: {currency: string; totalMinor: number; amountDueMinor: number | null; paidMinor: number | null; refundedMinor: number | null} | null;
  appUrl: string;
}

export type ResourceGrant =
  | Readonly<{ kind: "project"; resourceId: string; revision: null }>
  | Readonly<{ kind: "change_order" | "scope"; resourceId: string; revision: number }>;

/** Structural contract only. Services require server-minted, private provenance. */
export interface ActorContext {
  readonly projectId: string;
  readonly runId: string;
  readonly role: "designer" | "client";
  readonly actorId: string;
  readonly grant: ResourceGrant;
}

export interface DraftChangeOrderInput {
  itemIds?: string[]; operationId?: string;
  title: string;
  commentId: string | null;
  deliverables: string[];
  lineItems: LineItem[];
  currency: string;
  assessmentId?: string | null;
}

export interface FigmaComment {
  id: string;
  message: string;
  userHandle: string | null;
  userId?: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  nodeId: string | null;
  parentId: string | null;
}

export type Classification = "included" | "new_work" | "needs_clarification";

export interface ScopeClause {
  id: string;
  text: string;
}

export interface RateCardItem {
  id: string;
  description: string;
  unitAmountMinor: number;
}

export interface ProjectView {
  id: string;
  name: string;
  figmaFileKey: string;
  currency: string;
  scopeRevisionId: string;
  scopeClauses: ScopeClause[];
  rateCard: RateCardItem[];
}

export type ChangeOrderStatus =
  | "draft"
  | "awaiting_client_approval"
  | "needs_re_review"
  | "approved"
  | "creating_invoice"
  | "payment_due"
  | "paid"
  | "payment_review_required"
  | "error";

export interface FinancialState {
  invoiceState: "draft" | "scheduled" | "payable" | "closed" | "cancelled" | "unknown";
  paymentState: "not_started" | "due" | "pending" | "partial" | "paid" | "partially_refunded" | "refunded" | "review_required" | "unknown";
  rawStatus: unknown;
  amountDueMinor: number | null;
  paidMinor: number | null;
  refundedMinor: number | null;
  observedAt: string;
  representation: "itemized-v1" | "aggregate-v0" | "unknown";
  merchantProvenance: "approval-snapshot" | "legacy-configuration";
  issues: string[];
}

export type PriceSource = "rate_card" | "designer";

export interface LineItem {
  rateCardId: string | null;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  /** Q07: provenance is carried to the client page. AI never sets amounts. */
  priceSource: PriceSource;
}

export interface ChangeOrderView {
  milestoneSchedule?: MilestoneSchedule;
  installments?: MilestoneView[];
  installmentSummary?: InstallmentSummary;
  scopeContext: ScopeContextReference | null;
  id: string;
  projectId: string;
  runId: string;
  scopeSnapshot: ProjectView | null;
  assessmentId: string | null;
  stale: boolean;
  title: string;
  commentId: string | null;
  deliverables: string[];
  lineItems: LineItem[];
  /** Monotonic revision of this change order; approvals bind to one revision (Q08/Q09). */
  revision: number;
  /** Scope revision the order was submitted against; staleness is checked server-side (Q08). */
  scopeRevisionId: string | null;
  totalMinor: number;
  currency: string;
  status: ChangeOrderStatus;
  approvalStatus: "draft" | "awaiting_client_approval" | "needs_re_review" | "approved";
  financialState: FinancialState | null;
  paypalInvoiceId: string | null;
  invoiceUrl: string | null;
  paymentStatus: string | null;
  amountDueMinor: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface MilestoneTerms {id:string;title:string;amountMinor:number;dueTrigger:'proposal_approval'|'delivery_acceptance';acceptanceCriteria:string[]}
export interface MilestoneSchedule {milestones:MilestoneTerms[];workStartPaymentMilestoneIds:string[]}
export interface MilestoneView extends Omit<MilestoneTerms,'id'> {id:string;localId:string;orderId:string;revision:number;invoiceRecordId:string;legacy:boolean;paypalInvoiceId:string|null;invoiceUrl:string|null;financialState:FinancialState|null;state:string}
export interface InstallmentSummary {approvedTotalMinor:number;invoicedMinor:number;payableDueMinor:number|null;futureUnbilledMinor:number;grossPaidMinor:number|null;refundedMinor:number|null;netPaidMinor:number|null;unknownRecordIds:string[];allObligationsPaid:boolean;workStartSatisfied:boolean}

export interface ScopeProvenance {kind:string;createdBy:string|null;sourceReference:string|null;sourceTime:string|null;capturedAt:string}
export interface ScopeSnapshot {id:string;projectId:string;runId:string;version:number;legacyRevision:string|null;clauses:ScopeClause[];contentHash:string;provenance:ScopeProvenance}
export interface RateSnapshot {id:string;projectId:string;runId:string;version:number;currency:string;entries:RateCardItem[];contentHash:string;provenance:ScopeProvenance}
export interface ScopeAcknowledgement {id:string;snapshotId:string;actorId:string;createdAt:string}
export interface ScopeCommitment {sourceType:'approved_change';resourceId:string;revision:number;terms:unknown;approvalEvidence:{id:number;createdAt:string};workDisposition:'committed';installmentSummary?:InstallmentSummary;financialState:FinancialState|null;deliveryReferences:unknown[]}
export interface ScopeContextReference {id:string;scopeVersion:number|null;rateVersion:number|null;scopeSnapshotId:string|null;rateSnapshotId:string|null;commitmentFingerprint:string|null;commitments:ScopeCommitment[];provenanceKind:string}
export interface ScopeContext {scopeSnapshot:ScopeSnapshot;rateSnapshot:RateSnapshot;contextVersion:number;acknowledgement:{state:'supplied_unacknowledged'|'acknowledged';records:ScopeAcknowledgement[]};commitments:ScopeCommitment[];commitmentFingerprint:string;contextFingerprint:string}

export interface CommentsResponse {
  fileKey: string;
  fetchedAt: string;
  comments: FigmaComment[];
}

export type ItemEvidence = {kind:'scope_clause';snapshotId:string;clauseId:string;quote:string}|{kind:'approved_change';resourceId:string;revision:number;quote:string};
export interface AssessmentItem {review?:ItemReviewReference;exactSourceDuplicate?:boolean;exactCommitment?:boolean;reservationState?:string|null;originalOrderId?:string|null;duplicateDecision?:string|null;designerPriced?:boolean;reviewReferences?:{resourceId:string;revision:number;decision:string|null}[];id:string;requestedDeliverable:string;requestQuote:string;classification:Classification;evidence:ItemEvidence[];rates:{rateCardId:string;quantity:number}[];questions:string[];existingCommitment:{resourceId:string;revision:number}|null;lineItems:LineItem[];proposedTotalMinor:number;lineageItemIds:string[]}
export interface ProposalReservation {operationId:string;orderId:string;itemIds:string[];assessmentId:string;expectedContextFingerprint:string}

export interface ItemReviewReference {
  assessmentId: string; sourceId: string; sourceVersion: number; contextFingerprint: string; termsFingerprint: string;
}
export interface DesignSelectionMetadata {
  id: string; name: string; type: string; width?: number | null; height?: number | null;
  selectedText?: string; componentId?: string | null;
  layout?: { x?: number; y?: number; layoutMode?: string };
}
export interface DesignEvidenceInput {
  commentId: string; fileKey: string; nodeIds: string[]; capturedAt: string;
  selection: DesignSelectionMetadata[]; imageDataUrl?: string;
  relevance?: { confirmed: true; reason: string };
}
export interface DesignEvidenceSnapshot {
  id: string; projectId: string; runId: string; fileKey: string; nodeIds: string[];
  sourceId: string; sourceVersion: number; sourceHash: string; rootId: string;
  anchorNodeId: string | null; relationship: 'same_node' | 'different_node' | 'unknown_anchor';
  relevance: { actorId: string; reason: string; assertedAt: string } | null;
  capturedAt: string; receivedAt: string; verifiedAt: string; expiresAt: string;
  providerVersion: string | null; providerLastModified: string | null;
  authoritativeNodes: { id: string; name: string; type: string; width: number | null; height: number | null }[];
  selection: DesignSelectionMetadata[]; verification: 'verified' | 'unavailable';
  unavailableReason: string | null; collectionSource: 'client_plugin_claim';
  pixelProvenance: 'client_supplied' | 'none'; imageHash: string | null;
  imageWidth: number | null; imageHeight: number | null; hash: string;
  freshness?: 'fresh' | 'stale';
}
