/** Bounded integration metadata. This module does not register tools or authorize service calls. */
export type CapabilityEnvironment = "sandbox" | "live";
export type EvidenceStatus = "documented" | "sandbox_verified" | "production_verified";
export type DeploymentEnablement = Readonly<Partial<Record<CapabilityEnvironment, readonly string[]>>>;

export interface Capability {
  readonly id: string;
  readonly provider: "paypal" | "figma" | "unknown";
  readonly method: string;
  readonly path: string | null;
  readonly sourceUrl: string | null;
  /** Date the contract was checked, not an inferred account-access check. */
  readonly checkedAt: string | null;
  readonly operationId: string | null;
  readonly inventoryRef: string;
  readonly environment: CapabilityEnvironment | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly evidenceRef: string;
  readonly evidenceCheckedAt: string | null;
  readonly evidenceScope: "configured_synthetic_project" | "none";
  readonly requiredRole: "designer" | "client" | "system" | "none";
  readonly approvalRule: string;
  readonly retryRule: "bounded_read_with_retry_after" | "reconcile_before_retry" | "no_automatic_retry";
  readonly implemented: boolean;
  readonly fixtureEvidenceRefs: readonly string[];
  readonly verifiedAccess: boolean;
  readonly deploymentEnabled: boolean;
  readonly enabled: boolean;
}

type Definition = Pick<Capability, "id" | "provider" | "method" | "path" | "sourceUrl" | "checkedAt" |
  "operationId" | "inventoryRef" | "requiredRole" | "approvalRule" | "retryRule" | "implemented" | "fixtureEvidenceRefs"> & {
    readonly sandboxEvidenceRef?: string;
  };

const baseline = "docs/verification/agent-integrations-baseline.md";
const paymentEvidence = "docs/JUDGING-VERIFICATION-2026-10-23.md";
const figmaEvidence = "docs/CLIENT-AGENT-VERIFICATION-2026-10-23.md";
const ordersFixture = ["app/tests/orders.test.mjs"];

function paypal(id: string, method: string, path: string, operationId: string, family: string,
  requiredRole: Capability["requiredRole"], approvalRule: string, retryRule: Capability["retryRule"],
  implemented = false, fixtureEvidenceRefs: readonly string[] = [], sandboxEvidenceRef?: string): Definition {
  return { id: `paypal.${id}`, provider: "paypal", method, path, operationId,
    sourceUrl: `https://developer.paypal.com/api/${family}/schema.json`, checkedAt: "2026-10-22",
    inventoryRef: "PAYPAL-REST-ENDPOINTS.csv", requiredRole, approvalRule, retryRule,
    implemented, fixtureEvidenceRefs, sandboxEvidenceRef };
}

function figma(id: string, method: string, path: string, sourcePage: string,
  approvalRule: string, retryRule: Capability["retryRule"], implemented = false,
  fixtureEvidenceRefs: readonly string[] = [], sandboxEvidenceRef?: string): Definition {
  return { id: `figma.${id}`, provider: "figma", method, path, operationId: null,
    sourceUrl: `https://developers.figma.com/docs/rest-api/${sourcePage}/`, checkedAt: "2026-10-23",
    inventoryRef: `${baseline}#figma-access`, requiredRole: "designer", approvalRule,
    retryRule, implemented, fixtureEvidenceRefs, sandboxEvidenceRef };
}

// Each PayPal operation is a selected exact method/path from the 222-row inventory.
// No wildcard registration, inference from a related product, or environment-variable auto-enable.
const definitions = new Map<string, Definition>([
  paypal("invoices.create", "POST", "/v2/invoicing/invoices", "invoices.create", "invoicing/v2", "client",
    "Exact current revision approved by client; server-derived merchant and amount", "reconcile_before_retry",
    true, [...ordersFixture, "app/tests/paypal.test.mjs"], paymentEvidence),
  paypal("invoices.send", "POST", "/v2/invoicing/invoices/{invoice_id}/send", "invoices.send", "invoicing/v2", "system",
    "Publish only the invoice bound to the approved revision", "reconcile_before_retry", true, ordersFixture, paymentEvidence),
  paypal("invoices.get", "GET", "/v2/invoicing/invoices/{invoice_id}", "invoices.get", "invoicing/v2", "system",
    "Authorized run and stored invoice association", "bounded_read_with_retry_after", true,
    [...ordersFixture, "app/tests/webhooks.test.mjs"], paymentEvidence),
  paypal("invoices.search", "POST", "/v2/invoicing/search-invoices", "invoices.search-invoices", "invoicing/v2", "system",
    "Reconcile only the stored invoice operation and merchant", "bounded_read_with_retry_after", true, ordersFixture),
  paypal("invoices.remind", "POST", "/v2/invoicing/invoices/{invoice_id}/remind", "invoices.remind", "invoicing/v2", "system",
    "Explicit reminder opt-in and current unpaid state; recheck delegated authority", "no_automatic_retry", true,
    ["app/tests/agent-worker.test.mjs", "app/tests/agent-recovery.test.mjs", "app/tests/reviewed-actions.test.mjs"]),
  paypal("invoices.cancel", "POST", "/v2/invoicing/invoices/{invoice_id}/cancel", "invoices.cancel", "invoicing/v2", "designer",
    "Separate reviewed cancellation; never infer consent from invoice state", "reconcile_before_retry", true, ["app/tests/reviewed-actions.test.mjs"]),
  paypal("webhooks.verify", "POST", "/v1/notifications/verify-webhook-signature", "verify-webhook-signature.post", "webhooks/v1", "system",
    "Verify original notification and signature headers before authoritative retrieval", "bounded_read_with_retry_after", true,
    ["app/tests/webhooks.test.mjs"], "docs/PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md"),
  figma("comments.read", "GET", "/v1/files/:key/comments", "comments-endpoints",
    "Configured-file allowlist and authorized project/run", "bounded_read_with_retry_after", true,
    ["app/tests/agent-worker.test.mjs", "app/tests/request-inbox.test.mjs"], figmaEvidence),
  figma("comments.write", "POST", "/v1/files/:key/comments", "comments-endpoints",
    "Approved designer policy or separately reviewed reply; configured file/thread only", "reconcile_before_retry", true,
    ["app/tests/agent-worker.test.mjs", "app/tests/agent-recovery.test.mjs", "app/tests/reviewed-actions.test.mjs"], figmaEvidence),
  figma("context.nodes", "GET", "/v1/files/:key/nodes", "file-endpoints",
    "Explicit relevant node selection and configured-file allowlist", "bounded_read_with_retry_after", true, ["app/tests/design-evidence.test.mjs"]),
  figma("webhooks.create", "POST", "/v2/webhooks", "webhooks-endpoints",
    "Operator verifies scope, plan, context association and passcode before provisioning", "reconcile_before_retry"),
  figma("webhooks.get", "GET", "/v2/webhooks/:webhook_id", "webhooks-endpoints",
    "Authorized operator and stored webhook/context association", "bounded_read_with_retry_after"),
  paypal("products.create", "POST", "/v1/catalogs/products", "products.create", "catalog-products/v1", "designer",
    "Separately reviewed retainer product; verified product access required", "reconcile_before_retry"),
  paypal("plans.create", "POST", "/v1/billing/plans", "plans.create", "subscriptions/v1", "designer",
    "Separately reviewed price, cadence and allowance", "reconcile_before_retry"),
  paypal("subscriptions.create", "POST", "/v1/billing/subscriptions", "subscriptions.create", "subscriptions/v1", "client",
    "Explicit buyer approval of subscription terms; no inferred overage consent", "reconcile_before_retry"),
  paypal("subscriptions.get", "GET", "/v1/billing/subscriptions/{id}", "subscriptions.get", "subscriptions/v1", "system",
    "Authorized tenant and stored merchant/subscription association", "bounded_read_with_retry_after"),
  paypal("subscriptions.cancel", "POST", "/v1/billing/subscriptions/{id}/cancel", "subscriptions.cancel", "subscriptions/v1", "designer",
    "Separate reviewed subscription cancellation", "reconcile_before_retry"),
  paypal("refunds.create", "POST", "/v2/payments/captures/{capture_id}/refund", "captures.refund", "payments/v2", "designer",
    "Review refund amount and actual eligible capture; an invoice transaction ID is not a capture ID", "reconcile_before_retry"),
  paypal("refunds.get", "GET", "/v2/payments/refunds/{refund_id}", "refunds.get", "payments/v2", "system",
    "Authorized tenant and stored merchant/refund association", "bounded_read_with_retry_after"),
  paypal("invoice-refunds.record", "POST", "/v2/invoicing/invoices/{invoice_id}/refunds", "invoices.refunds", "invoicing/v2", "designer",
    "Reviewed external-refund bookkeeping only; this operation does not move funds", "reconcile_before_retry"),
].map(definition => [definition.id, definition]));

/** Flags are explicit deployment input, copied once; service authorization remains authoritative. */
export function createCapabilityRegistry(enablement: DeploymentEnablement = {}): {
  getCapability(id: string, environment: CapabilityEnvironment): Capability;
} {
  const enabledIds = {
    sandbox: new Set(enablement.sandbox ?? []),
    live: new Set(enablement.live ?? []),
  };
  return Object.freeze({
    getCapability(id: string, environment: CapabilityEnvironment): Capability {
      const validEnvironment = environment === "sandbox" || environment === "live";
      const definition = definitions.get(id);
      const sandboxEvidenceRef = environment === "sandbox" ? definition?.sandboxEvidenceRef : undefined;
      const evidenceStatus: EvidenceStatus = sandboxEvidenceRef ? "sandbox_verified" : "documented";
      // No production evidence is recorded. Adding it requires a separately reviewed access record.
      const verifiedAccess = validEnvironment && Boolean(sandboxEvidenceRef);
      const deploymentEnabled = validEnvironment && Boolean(definition) && enabledIds[environment].has(id);
      const { sandboxEvidenceRef: _evidence, ...metadata } = definition ?? {
        id, provider: "unknown" as const, method: "NONE", path: null, sourceUrl: null, checkedAt: null,
        operationId: null, inventoryRef: baseline, requiredRole: "none" as const,
        approvalRule: "Denied: unknown capability", retryRule: "no_automatic_retry" as const,
        implemented: false, fixtureEvidenceRefs: [], sandboxEvidenceRef: undefined,
      };
      return Object.freeze({ ...metadata, environment: validEnvironment ? environment : null,
        evidenceStatus, evidenceRef: sandboxEvidenceRef ?? `${baseline}#unverified-access`,
        evidenceCheckedAt: sandboxEvidenceRef ? "2026-10-23" : null,
        evidenceScope: sandboxEvidenceRef ? "configured_synthetic_project" : "none",
        fixtureEvidenceRefs: Object.freeze([...metadata.fixtureEvidenceRefs]),
        verifiedAccess, deploymentEnabled, enabled: deploymentEnabled && verifiedAccess && metadata.implemented,
      });
    },
  });
}

/** Default registry is intentionally disabled until a deployment explicitly supplies its flags. */
export const { getCapability } = createCapabilityRegistry();
