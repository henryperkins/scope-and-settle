// Shared contracts between backend, Figma plugin UI, and client review page.

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
  | "error";

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
  paypalInvoiceId: string | null;
  invoiceUrl: string | null;
  paymentStatus: string | null;
  amountDueMinor: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface CommentsResponse {
  fileKey: string;
  fetchedAt: string;
  comments: FigmaComment[];
}
