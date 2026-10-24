import {
  invoiceTermProblems,
  type ApprovedInvoiceTerms,
} from "./paymentState.js";
import type { InvoiceDetail } from "./paypal.js";
import { db, transaction } from "./db.js";
import { config } from "./env.js";
import { now } from "./agentStore.js";
import { ScopedAccessError } from "./context.js";

export function invoiceActionKey(invoiceId: string) {
  return `${config.paypalEnv}:${config.paypalMerchantEmail.toLowerCase()}:${invoiceId}`;
}
/** Atomic durable invoice lock and cadence shared by policy and reviewed sends. */
export function claimOutbound(input: {
  id: string;
  runId: string;
  authority: "policy" | "human_review";
  actionId?: string;
  kind: string;
  invoiceId?: string;
  approvalAt?: string;
}) {
  return transaction(() => {
    if (
      db
        .prepare("SELECT outbox_id FROM outbound_operations WHERE outbox_id=?")
        .get(input.id)
    )
      throw new ScopedAccessError(
        409,
        "Operation was already claimed; inspect its stored outcome",
      );
    const key = input.invoiceId ? invoiceActionKey(input.invoiceId) : null;
    if (key) {
      const active = db
        .prepare(
          "SELECT outbox_id FROM outbound_operations WHERE invoice_key=? AND (state IN ('claimed','dispatching','uncertain') OR retry_after_at>?)",
        )
        .get(key, Date.now());
      if (active)
        throw new ScopedAccessError(
          409,
          "An invoice action is in flight, uncertain or waiting for provider backoff",
        );
      // Historical outbox rows remain evidence even after warning acknowledgement/dismissal.
      const rows = db
        .prepare(
          "SELECT * FROM agent_outbox WHERE kind='reminder' AND json_valid(body) AND json_extract(body,'$.invoiceId')=? AND id<>?",
        )
        .all(input.invoiceId!, input.id) as any[];
      const attempts = db
        .prepare(
          "SELECT * FROM outbound_operations WHERE invoice_key=? AND kind='reminder' AND dispatch_started=1 ORDER BY attempted_at DESC",
        )
        .all(key) as any[];
      if (
        rows.some(
          (r) =>
            r.attempts > 0 &&
            r.state !== "sent" &&
            !db
              .prepare(
                "SELECT outbox_id FROM outbound_operations WHERE outbox_id=?",
              )
              .get(r.id),
        )
      )
        throw new ScopedAccessError(
          409,
          "A previous reminder may have been delivered; resolve uncertainty before another action",
        );
      if (input.kind === "reminder") {
        const sent = rows
          .filter((r) => r.state === "sent" || r.attempts > 0)
          .map((r) => Date.parse(r.updated_at));
        const last = Math.max(
          0,
          ...sent,
          ...attempts.map((r) => Date.parse(r.attempted_at)),
        );
        if (
          !input.approvalAt ||
          !Number.isFinite(Date.parse(input.approvalAt)) ||
          Date.now() - Date.parse(input.approvalAt) < 86400000 ||
          Date.now() - last < 86400000
        )
          throw new ScopedAccessError(
            409,
            "Reminders require 24 hours after approval and between attempts",
          );
        if (
          input.authority === "policy" &&
          rows.filter(
            (r) =>
              !db
                .prepare(
                  "SELECT outbox_id FROM outbound_operations WHERE outbox_id=? AND authority='human_review'",
                )
                .get(r.id),
          ).length >= 2
        )
          throw new ScopedAccessError(
            409,
            "Automatic reminder lifetime limit reached",
          );
      }
    }
    const at = now();
    db.prepare(
      "INSERT INTO outbound_operations(outbox_id,authority,action_id,run_id,invoice_key,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'claimed',?,?)",
    ).run(
      input.id,
      input.authority,
      input.actionId ?? null,
      input.runId,
      key,
      input.kind,
      at,
      at,
    );
    if (key)
      db.prepare(
        "UPDATE agent_outbox SET state='cancelled',error='Coalesced with another reviewed or policy invoice action',updated_at=? WHERE kind='reminder' AND state='pending' AND attempts=0 AND json_valid(body) AND json_extract(body,'$.invoiceId')=? AND id<>? AND NOT EXISTS(SELECT 1 FROM outbound_operations o WHERE o.outbox_id=agent_outbox.id AND o.authority='human_review')",
      ).run(at, input.invoiceId!, input.id);
  });
}
export function beginOutbound(id: string) {
  return transaction(() => {
    const at = now();
    const changed = db
      .prepare(
        "UPDATE outbound_operations SET state='dispatching',dispatch_started=1,attempted_at=?,updated_at=? WHERE outbox_id=? AND state='claimed'",
      )
      .run(at, at, id);
    if (changed.changes !== 1)
      throw new ScopedAccessError(
        409,
        "Dispatch was already started or closed",
      );
    db.prepare(
      "UPDATE agent_outbox SET state='sending',attempts=attempts+1,updated_at=? WHERE id=?",
    ).run(at, id);
  });
}
export function finishOutbound(
  id: string,
  state: "acknowledged" | "reconciled" | "uncertain" | "denied",
  result: any,
  retryAfterAt: number | null = null,
) {
  return transaction(() => {
    const at = now();
    db.prepare(
      "UPDATE outbound_operations SET state=?,result_json=?,provider_id=?,retry_after_at=?,updated_at=? WHERE outbox_id=?",
    ).run(
      state,
      JSON.stringify(result),
      result.providerId ?? null,
      retryAfterAt,
      at,
      id,
    );
    db.prepare(
      "UPDATE agent_outbox SET state=?,provider_id=COALESCE(?,provider_id),error=?,updated_at=? WHERE id=?",
    ).run(
      state === "acknowledged" || state === "reconciled"
        ? "sent"
        : state === "uncertain"
          ? "uncertain"
          : "review",
      result.providerId ?? null,
      result.message ?? null,
      at,
      id,
    );
  });
}
export function recoverOutbound() {
  return transaction(() => {
    const at = now();
    db.prepare(
      "UPDATE outbound_operations SET state='uncertain',updated_at=? WHERE state IN ('claimed','dispatching')",
    ).run(at);
    const interrupted = db
      .prepare("SELECT id FROM reviewed_actions WHERE state='executing'")
      .all() as { id: string }[];
    for (const row of interrupted) {
      const result = {
        id: row.id,
        state: "uncertain",
        message: "Execution interrupted; reconcile without resending",
        notificationDelivery: "unverified",
      };
      db.prepare(
        "UPDATE reviewed_actions SET state='uncertain',result_json=?,updated_at=? WHERE id=?",
      ).run(JSON.stringify(result), at, row.id);
      db.prepare(
        "UPDATE outbound_operations SET result_json=? WHERE outbox_id=? AND state='uncertain'",
      ).run(JSON.stringify(result), row.id);
    }
    db.prepare(
      "UPDATE agent_outbox SET state='uncertain',updated_at=? WHERE id IN(SELECT outbox_id FROM outbound_operations WHERE state='uncertain')",
    ).run(at);
  });
}

/** Positive eligibility and immutable terms, shared by manual and automatic invoice notifications. */
export function requireUnpaidInvoice(
  detail: InvoiceDetail,
  terms: ApprovedInvoiceTerms,
) {
  if (
    invoiceTermProblems(detail, terms).length ||
    detail.id !== terms.invoiceId
  )
    throw new ScopedAccessError(
      409,
      "Authoritative invoice differs from approved identity or terms",
    );
  if (
    !["SENT", "UNPAID"].includes(detail.status) ||
    detail.amountDueMinor !== terms.totalMinor ||
    detail.raw.payments ||
    detail.raw.refunds
  )
    throw new ScopedAccessError(
      409,
      "Only fully unpaid sent invoices without payment/refund activity support this action",
    );
}
