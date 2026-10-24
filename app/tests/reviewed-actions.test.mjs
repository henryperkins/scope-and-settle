import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, required, selection } from "./reviewed-actions-fixture.mjs";
import { canonicalDraftFactory } from "./helpers.mjs";

test("reviewed preview has no outbound effect and exact displayed hash is required", async () => {
  const f = await fixture();
  try {
    required(f);
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    assert.equal(f.writes, 0);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM agent_outbox").get().n,
      0,
    );
    assert.match(p.wording, /system/i);
    assert.ok(p.previewHash);
    await assert.rejects(() =>
      f.actions.confirmReviewedAction(f.ctx, p.id, "edited"),
    );
    assert.equal(f.writes, 0);
    const result = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(result.state, "acknowledged");
    assert.equal(f.writes, 1);
    assert.equal(
      (await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash)).state,
      "acknowledged",
    );
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});
test("reviewed wrong actor, forged context, expired preview and changed source cannot confirm", async () => {
  const f = await fixture();
  try {
    required(f);
    const input = await f.figma(),
      p = await f.actions.prepareReviewedAction(f.ctx, input),
      other = f.sessions.createSession({
        projectId: "demo",
        role: "designer",
        runId: f.ctx.runId,
      });
    await assert.rejects(() =>
      f.actions.confirmReviewedAction(
        f.context.contextFromSessionToken(other.token),
        p.id,
        p.previewHash,
      ),
    );
    await assert.rejects(() =>
      f.actions.confirmReviewedAction({ ...f.ctx }, p.id, p.previewHash),
    );
    f.comments[0].message = "Changed after review";
    await assert.rejects(() =>
      f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash),
    );
    await f.inbox.refreshRequestThread(f.ctx, "root");
    const q = await f.actions.prepareReviewedAction(f.ctx, {
      ...input,
      expected: f.displayed(input.requestId),
    });
    f.db
      .prepare(
        "UPDATE reviewed_actions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(q.id);
    await assert.rejects(() =>
      f.actions.confirmReviewedAction(f.ctx, q.id, q.previewHash),
    );
    assert.equal(f.writes, 0);
  } finally {
    f.close();
  }
});
test("concurrent confirmations claim once and a second manual preview shares invoice cooldown", async () => {
  const f = await fixture();
  try {
    required(f);
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x)),
      q = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    await Promise.all([
      f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash),
      f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash),
    ]);
    assert.equal(f.writes, 1);
    const r = await f.actions.confirmReviewedAction(f.ctx, q.id, q.previewHash);
    assert.equal(r.state, "denied");
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});
test("uncertain reminder survives portal acknowledgement dismissal and replay without resend", async () => {
  const f = await fixture();
  try {
    required(f);
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    f.uncertain = true;
    assert.equal(
      (await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash)).state,
      "uncertain",
    );
    f.portal.handleAgentRequest(f.session, x.request.id, "acknowledge");
    f.portal.handleAgentRequest(f.session, x.request.id, "dismiss");
    assert.equal(
      (await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash)).state,
      "uncertain",
    );
    assert.equal(
      f.db.prepare("SELECT state FROM agent_outbox WHERE id=?").get(p.id).state,
      "uncertain",
    );
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});
for (const status of [
  "PAID",
  "CANCELLED",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "SCHEDULED",
  "UNKNOWN",
])
  test("reviewed invoice rejects authoritative " + status, async () => {
    const f = await fixture();
    try {
      required(f);
      const x = await f.invoice();
      f.provider.invoices.get(x.order.paypalInvoiceId).status = status;
      await assert.rejects(() =>
        f.actions.prepareReviewedAction(f.ctx, selection(x)),
      );
      assert.equal(f.writes, 0);
    } finally {
      f.close();
    }
  });
test("cancel reconciles lost acknowledgement without changing approved work commitments", async () => {
  const f = await fixture();
  try {
    required(f);
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        kind: "cancel_invoice",
      });
    f.uncertain = true;
    const result = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(result.state, "reconciled");
    assert.equal(result.providerStatus, "CANCELLED");
    assert.equal(
      f.orders.getChangeOrder(x.order.id).financialState.invoiceState,
      "cancelled",
    );
    assert.equal(
      f.orders.getChangeOrder(x.order.id).approvalStatus,
      "approved",
    );
    assert.ok(
      f.db
        .prepare(
          "SELECT id FROM proposal_item_reservations WHERE order_id=? AND state='committed'",
        )
        .get(x.order.id),
    );
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});
test("Figma clarification stores actual reply identity and never repeats an uncertain post", async () => {
  const f = await fixture();
  try {
    required(f);
    const p = await f.actions.prepareReviewedAction(f.ctx, await f.figma());
    f.uncertain = true;
    const result = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.ok(["uncertain", "reconciled"].includes(result.state));
    const replay = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.ok(["uncertain", "reconciled"].includes(replay.state));
    assert.equal(f.writes, 1);
    if (replay.state === "reconciled")
      assert.equal(replay.providerId, "actual-reply-1");
    assert.equal(f.inbox.getInboxSettings(f.ctx).notifications, false);
  } finally {
    f.close();
  }
});
test("held source read and post acknowledgement preserve authority and truthful outcome", async () => {
  const f = await fixture();
  try {
    required(f);
    const input = await f.figma();
    f.hook = async (phase) => {
      if (phase === "read") f.sessions.revokeSession(f.session.token);
    };
    await assert.rejects(() => f.actions.prepareReviewedAction(f.ctx, input));
    assert.equal(f.writes, 0);
  } finally {
    f.close();
  }
});

test("preparation requires displayed request reference and rejects exact-link substitution", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice();
    const { expected, ...without } = selection(x);
    await assert.rejects(
      () => f.actions.prepareReviewedAction(f.ctx, without),
      /displayed|reference/i,
    );
    await assert.rejects(() =>
      f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        expected: { ...expected, requestVersion: 999 },
      }),
    );
    const y = await f.invoice();
    await assert.rejects(() =>
      f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        orderId: y.order.id,
        revision: y.order.revision,
      }),
    );
    assert.equal(f.writes, 0);
  } finally {
    f.close();
  }
});

test("expiry and invoice revision are revalidated after held authoritative reads", async () => {
  for (const mode of ["expiry", "revision"]) {
    const f = await fixture();
    try {
      const x = await f.invoice(),
        p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
      f.hook = async (phase) => {
        if (phase === "invoice-read") {
          if (mode === "expiry")
            f.db
              .prepare(
                "UPDATE reviewed_actions SET expires_at='2000-01-01' WHERE id=?",
              )
              .run(p.id);
          else
            f.db
              .prepare(
                "UPDATE change_orders SET revision=revision+1 WHERE id=?",
              )
              .run(x.order.id);
        }
      };
      await assert.rejects(() =>
        f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash),
      );
      assert.equal(f.writes, 0);
    } finally {
      f.close();
    }
  }
});

test("post acknowledgement remains recorded through application revocation", async () => {
  const f = await fixture();
  try {
    const p = await f.actions.prepareReviewedAction(f.ctx, await f.figma());
    f.hook = async (phase) => {
      if (phase === "post") f.sessions.revokeSession(f.session.token);
    };
    const outcome = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(outcome.state, "acknowledged");
    assert.equal(outcome.providerId, "actual-reply-1");
    assert.equal(
      f.db
        .prepare("SELECT state FROM outbound_operations WHERE outbox_id=?")
        .get(p.id).state,
      "acknowledged",
    );
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});

test("single-use uncertainty survives policy cleanup and restart", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    f.uncertain = true;
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    const worker = await f.app.load("agentWorker");
    await worker.runAgentCycle();
    worker.recoverAgentJobs();
    assert.equal(
      f.db.prepare("SELECT state FROM reviewed_actions WHERE id=?").get(p.id)
        .state,
      "uncertain",
    );
    assert.equal(
      f.db.prepare("SELECT state FROM agent_outbox WHERE id=?").get(p.id).state,
      "uncertain",
    );
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});

test("authenticated HTTP UI requires explicit same-origin exact-preview confirmation", async () => {
  const nativeFetch = globalThis.fetch,
    f = await fixture();
  let server;
  try {
    const x = await f.invoice();
    ({ server } = await f.app.load("server"));
    if (!server.listening)
      await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const { config } = await f.app.load("env");
    config.publicUrl = base;
    const call = (path, method = "GET", body, extra = {}) =>
      nativeFetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + f.session.token,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    let r = await call("/api/reviewed-actions", "POST", selection(x));
    assert.equal(r.status, 201);
    const p = await r.json();
    r = await call("/api/reviewed-actions/" + p.id);
    assert.equal(r.status, 200);
    assert.equal(f.writes, 0);
    for (const [body, headers] of [
      [{ previewHash: p.previewHash, consent: true }, {}],
      [
        { previewHash: p.previewHash, consent: true },
        { Origin: "https://wrong.example" },
      ],
      [{ previewHash: p.previewHash, confirmed: true }, { Origin: base }],
      [{ previewHash: "edited", consent: true }, { Origin: base }],
    ]) {
      r = await call(
        "/api/reviewed-actions/" + p.id + "/confirm",
        "POST",
        body,
        headers,
      );
      assert.ok([400, 403, 409].includes(r.status));
    }
    assert.equal(f.writes, 0);
    r = await call(
      "/api/reviewed-actions/" + p.id + "/confirm",
      "POST",
      { previewHash: p.previewHash, consent: true },
      { Origin: base },
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).state, "acknowledged");
    assert.equal(f.writes, 1);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    f.close();
  }
});

test("manual and worker actions share invoice uncertainty and attempt cadence", async () => {
  const f = await fixture();
  try {
    const policy = await f.app.load("agentPolicy"),
      worker = await f.app.load("agentWorker");
    policy.saveAgentPolicy(f.session, {
      enabled: true,
      consent: true,
      allowedRateIds: ["mobile_checkout"],
      maxQuoteMinor: 25000,
      maxTotalMinor: 50000,
      maxQuantity: 1,
      paypalReminders: true,
    });
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    f.uncertain = true;
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    await worker.runAgentCycle();
    assert.equal(f.writes, 1);
    assert.equal(
      f.db.prepare("SELECT state FROM agent_outbox WHERE id=?").get(p.id).state,
      "uncertain",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM outbound_operations WHERE dispatch_started=1",
        )
        .get().n,
      1,
    );
  } finally {
    f.close();
  }
});

test("worker-first reminder and manual preview share one durable invoice reservation", async () => {
  const f = await fixture();
  try {
    const policy = await f.app.load("agentPolicy"),
      worker = await f.app.load("agentWorker");
    policy.saveAgentPolicy(f.session, {
      enabled: true,
      consent: true,
      allowedRateIds: ["mobile_checkout"],
      maxQuoteMinor: 25000,
      maxTotalMinor: 50000,
      maxQuantity: 1,
      paypalReminders: true,
    });
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    await worker.runAgentCycle();
    assert.equal(f.writes, 1);
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM outbound_operations WHERE authority='policy' AND dispatch_started=1",
        )
        .get().n,
      1,
    );
    const outcome = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(outcome.state, "denied");
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});

test("Figma mismatched root acknowledgement remains uncertain rather than a receipt", async () => {
  const f = await fixture();
  try {
    const p = await f.actions.prepareReviewedAction(f.ctx, await f.figma());
    f.badAck = true;
    const result = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(result.state, "uncertain");
    assert.equal(result.providerId, undefined);
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});

test("cancel without matching authoritative CANCELLED remains uncertain and single-use", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        kind: "cancel_invoice",
      });
    f.cancelApplies = false;
    const outcome = await f.actions.confirmReviewedAction(
      f.ctx,
      p.id,
      p.previewHash,
    );
    assert.equal(outcome.state, "uncertain");
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    assert.equal(f.writes, 1);
  } finally {
    f.close();
  }
});

test("PayPal 429 retains shared backoff and no custom message fields on the wire", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    f.responseStatus = 429;
    assert.equal(
      (await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash)).state,
      "denied",
    );
    const q = await f.actions.prepareReviewedAction(f.ctx, {
      ...selection(x),
      kind: "cancel_invoice",
    });
    assert.equal(
      (await f.actions.confirmReviewedAction(f.ctx, q.id, q.previewHash)).state,
      "denied",
    );
    assert.equal(f.writes, 1);
    assert.deepEqual(f.wire[0], {
      send_to_recipient: true,
      send_to_invoicer: false,
      additional_recipients: [],
    });
    assert.ok(
      f.db
        .prepare(
          "SELECT retry_after_at FROM outbound_operations WHERE outbox_id=?",
        )
        .get(p.id).retry_after_at > Date.now(),
    );
  } finally {
    f.close();
  }
});

test("OAuth await revalidates authority and never posts after revocation", async () => {
  const f = await fixture();
  try {
    f.expireTokens = true;
    const x = await f.invoice(),
      p = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    f.hook = async (phase) => {
      if (phase === "oauth") f.sessions.revokeSession(f.session.token);
    };
    await assert.rejects(() =>
      f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash),
    );
    assert.equal(f.writes, 0);
  } finally {
    f.close();
  }
});

test("explicit existing CC set is required; new or silently omitted recipients cannot be added", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice();
    f.provider.invoices.get(x.order.paypalInvoiceId).additional_recipients = [
      "existing@example.com",
    ];
    await assert.rejects(() =>
      f.actions.prepareReviewedAction(f.ctx, selection(x)),
    );
    await assert.rejects(() =>
      f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        recipients: {
          sendToRecipient: true,
          sendToInvoicer: false,
          additionalRecipients: ["new@example.com"],
        },
      }),
    );
    const p = await f.actions.prepareReviewedAction(f.ctx, {
      ...selection(x),
      recipients: {
        sendToRecipient: false,
        sendToInvoicer: true,
        additionalRecipients: ["existing@example.com"],
      },
    });
    assert.deepEqual(p.recipients.cc, ["existing@example.com"]);
    await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
    assert.deepEqual(f.wire[0], {
      send_to_recipient: false,
      send_to_invoicer: true,
      additional_recipients: ["existing@example.com"],
    });
  } finally {
    f.close();
  }
});

test("interrupted claimed and dispatching actions retain single-use reconciliation across restart", async () => {
  for (const dispatched of [false, true]) {
    const f = await fixture();
    try {
      const x = await f.invoice(),
        p = await f.actions.prepareReviewedAction(f.ctx, selection(x)),
        outbound = await f.app.load("outboundActions"),
        at = new Date().toISOString();
      f.db
        .prepare("UPDATE reviewed_actions SET state='executing' WHERE id=?")
        .run(p.id);
      f.db
        .prepare(
          "INSERT INTO agent_outbox(id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES(?,?,?,'reminder','{}',?,?,?)",
        )
        .run(p.id, f.ctx.runId, x.request.id, p.id, at, at);
      outbound.claimOutbound({
        id: p.id,
        runId: f.ctx.runId,
        authority: "human_review",
        actionId: p.id,
        kind: "reminder",
        invoiceId: x.order.paypalInvoiceId,
        approvalAt: "2000-01-01",
      });
      if (dispatched) outbound.beginOutbound(p.id);
      const worker = await f.app.load("agentWorker");
      worker.recoverAgentJobs();
      assert.equal(
        (await f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash))
          .state,
        "uncertain",
      );
      assert.equal(f.writes, 0);
      assert.equal(
        f.db
          .prepare(
            "SELECT dispatch_started FROM outbound_operations WHERE outbox_id=?",
          )
          .get(p.id).dispatch_started,
        dispatched ? 1 : 0,
      );
    } finally {
      f.close();
    }
  }
});

test("reviewed Figma posting requires explicit deployment enablement", async () => {
  const f = await fixture();
  try {
    const input = await f.figma(),
      { config } = await f.app.load("env");
    config.figmaCommentPostingEnabled = false;
    await assert.rejects(
      () => f.actions.prepareReviewedAction(f.ctx, input),
      /disabled/,
    );
    assert.equal(f.writes, 0);
  } finally {
    f.close();
  }
});

test("cancellation retains the invoice reservation throughout held provider read-back", async () => {
  const f = await fixture();
  let release;
  try {
    const x = await f.invoice(),
      cancel = await f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        kind: "cancel_invoice",
      }),
      reminder = await f.actions.prepareReviewedAction(f.ctx, selection(x));
    let posted = false,
      heldOnce = false,
      enter;
    const entered = new Promise((r) => (enter = r)),
      held = new Promise((r) => (release = r));
    f.cancelApplies = false;
    f.hook = async (phase) => {
      if (phase === "post") posted = true;
      if (phase === "invoice-read" && posted && !heldOnce) {
        heldOnce = true;
        enter();
        await held;
      }
    };
    const cancelling = f.actions.confirmReviewedAction(
      f.ctx,
      cancel.id,
      cancel.previewHash,
    );
    await entered;
    const concurrent = await f.actions.confirmReviewedAction(
      f.ctx,
      reminder.id,
      reminder.previewHash,
    );
    release();
    const cancelled = await cancelling;
    assert.equal(concurrent.state, "denied");
    assert.equal(cancelled.state, "uncertain");
    assert.equal(f.writes, 1);
  } finally {
    release?.();
    f.close();
  }
});

// Successful cancellation reconciliation must reach the local financial projection on every path.
const confirm = (f, p) =>
  f.actions.confirmReviewedAction(f.ctx, p.id, p.previewHash);
const recorded = (f, id) => ({
  action: f.db.prepare("SELECT * FROM reviewed_actions WHERE id=?").get(id),
  outbound: f.db
    .prepare("SELECT * FROM outbound_operations WHERE outbox_id=?")
    .get(id),
});
/** Cancellation changes the invoice only: approval, revision, terms and committed items stay. */
function commitments(f, x) {
  const terms = () =>
      f.db
        .prepare(
          "SELECT approved_terms_json FROM invoice_operations WHERE change_order_id=?",
        )
        .get(x.order.id).approved_terms_json,
    before = terms();
  return () => {
    const order = f.orders.getChangeOrder(x.order.id),
      items = f.db
        .prepare(
          "SELECT state FROM proposal_item_reservations WHERE order_id=?",
        )
        .all(x.order.id);
    assert.equal(order.revision, x.order.revision);
    assert.equal(order.approvalStatus, "approved");
    assert.equal(terms(), before);
    assert.ok(items.length > 0);
    assert.ok(items.every((item) => item.state === "committed"));
  };
}
/** First confirmation sends once, but PayPal does not yet report CANCELLED. */
async function uncertainCancel(f) {
  const x = await f.invoice(),
    check = commitments(f, x),
    p = await f.actions.prepareReviewedAction(f.ctx, {
      ...selection(x),
      kind: "cancel_invoice",
    });
  f.cancelApplies = false;
  const first = await confirm(f, p);
  assert.equal(first.state, "uncertain");
  assert.equal(f.writes, 1);
  assert.equal(recorded(f, p.id).outbound.state, "uncertain");
  assert.equal(
    f.orders.getChangeOrder(x.order.id).financialState.invoiceState,
    "payable",
  );
  return { x, p, check };
}

test("R1 delayed CANCELLED read-back on a later confirmation applies the local financial projection", async () => {
  const f = await fixture();
  try {
    const { x, p, check } = await uncertainCancel(f);
    f.provider.invoices.get(x.order.paypalInvoiceId).status = "CANCELLED";
    const later = await confirm(f, p);
    assert.equal(later.state, "reconciled");
    assert.equal(later.providerStatus, "CANCELLED");
    assert.equal(f.writes, 1);
    const local = f.orders.getChangeOrder(x.order.id);
    assert.equal(local.financialState.invoiceState, "cancelled");
    assert.notEqual(local.financialState.paymentState, "due");
    assert.notEqual(local.status, "payment_due");
    assert.equal(later.localProjection, "applied");
    assert.equal(recorded(f, p.id).outbound.state, "reconciled");
    const again = await confirm(f, p);
    assert.equal(again.state, "reconciled");
    assert.equal(again.localProjection, "applied");
    assert.equal(f.writes, 1);
    check();
  } finally {
    f.close();
  }
});

test("R2 delayed CANCELLED read-back after the ten-minute preview expiry still projects", async () => {
  const f = await fixture();
  try {
    const { x, p, check } = await uncertainCancel(f);
    f.db
      .prepare(
        "UPDATE reviewed_actions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(p.id);
    f.provider.invoices.get(x.order.paypalInvoiceId).status = "CANCELLED";
    const later = await confirm(f, p);
    assert.equal(later.state, "reconciled");
    assert.equal(later.providerStatus, "CANCELLED");
    const local = f.orders.getChangeOrder(x.order.id);
    assert.equal(local.financialState.invoiceState, "cancelled");
    assert.notEqual(local.status, "payment_due");
    assert.equal(later.localProjection, "applied");
    assert.equal(f.writes, 1);
    assert.equal((await confirm(f, p)).localProjection, "applied");
    assert.equal(f.writes, 1);
    check();
  } finally {
    f.close();
  }
});

test("R3 restart-recovered cancellation projects a later CANCELLED read-back without another write", async () => {
  const f = await fixture();
  try {
    const x = await f.invoice(),
      check = commitments(f, x),
      p = await f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        kind: "cancel_invoice",
      }),
      outbound = await f.app.load("outboundActions");
    let enter;
    const entered = new Promise((r) => (enter = r));
    // The process stops while its cancellation POST is in flight; that call never resumes.
    f.hook = async (phase) => {
      if (phase !== "post") return;
      enter();
      await new Promise(() => {});
    };
    void confirm(f, p);
    await entered;
    f.hook = null;
    assert.equal(f.writes, 1);
    assert.equal(recorded(f, p.id).action.state, "executing");
    outbound.recoverOutbound();
    assert.equal(recorded(f, p.id).action.state, "uncertain");
    assert.equal(recorded(f, p.id).outbound.state, "uncertain");
    assert.equal(recorded(f, p.id).outbound.dispatch_started, 1);
    f.provider.invoices.get(x.order.paypalInvoiceId).status = "CANCELLED";
    const later = await confirm(f, p);
    assert.equal(later.state, "reconciled");
    assert.equal(later.providerStatus, "CANCELLED");
    const local = f.orders.getChangeOrder(x.order.id);
    assert.equal(local.financialState.invoiceState, "cancelled");
    assert.notEqual(local.status, "payment_due");
    assert.equal(later.localProjection, "applied");
    assert.equal(recorded(f, p.id).outbound.state, "reconciled");
    assert.equal(f.writes, 1);
    assert.equal((await confirm(f, p)).state, "reconciled");
    assert.equal(f.writes, 1);
    check();
  } finally {
    f.close();
  }
});

test("R4 transient projection read failure keeps the CANCELLED outcome and a later confirmation applies it", async () => {
  for (const mode of ["dispatch", "delayed"]) {
    const f = await fixture();
    try {
      const x = await f.invoice(),
        check = commitments(f, x),
        invoiceId = x.order.paypalInvoiceId,
        p = await f.actions.prepareReviewedAction(f.ctx, {
          ...selection(x),
          kind: "cancel_invoice",
        });
      if (mode === "delayed") {
        f.cancelApplies = false;
        assert.equal((await confirm(f, p)).state, "uncertain");
        f.provider.invoices.get(invoiceId).status = "CANCELLED";
      }
      // Reconciliation's read of the CANCELLED invoice succeeds; the projection's fresh read fails.
      let cancelledReads = 0;
      f.hook = async (phase) => {
        if (
          phase === "invoice-read" &&
          f.provider.invoices.get(invoiceId).status === "CANCELLED" &&
          ++cancelledReads === 2
        )
          throw new TypeError("transient projection read failure");
      };
      const outcome = await confirm(f, p);
      assert.equal(cancelledReads, 2, mode);
      assert.equal(outcome.state, "reconciled", mode);
      assert.equal(outcome.providerStatus, "CANCELLED");
      assert.equal(outcome.localProjection, "pending");
      assert.match(outcome.message, /pending/);
      assert.doesNotMatch(outcome.message, /now shows/);
      const saved = recorded(f, p.id);
      assert.equal(saved.action.state, "reconciled");
      assert.equal(
        JSON.parse(saved.action.result_json).providerStatus,
        "CANCELLED",
      );
      assert.equal(saved.outbound.state, "reconciled");
      const local = f.orders.getChangeOrder(x.order.id);
      assert.equal(local.financialState.invoiceState, "payable");
      assert.equal(local.status, "payment_due");
      assert.equal(f.writes, 1);
      f.hook = null;
      const retried = await confirm(f, p);
      assert.equal(retried.state, "reconciled");
      assert.equal(retried.localProjection, "applied");
      assert.equal(
        f.orders.getChangeOrder(x.order.id).financialState.invoiceState,
        "cancelled",
      );
      assert.equal(f.writes, 1);
      check();
    } finally {
      f.close();
    }
  }
});

test("R5 changed invoice association, tombstone or revoked caller blocks the projection but keeps the CANCELLED outcome", async () => {
  for (const mode of ["association", "tombstone", "revoked"]) {
    const f = await fixture();
    try {
      const { x, p, check } = await uncertainCancel(f),
        invoiceId = x.order.paypalInvoiceId,
        observations = () =>
          f.db
            .prepare(
              "SELECT COUNT(*) n FROM payment_observations WHERE change_order_id=?",
            )
            .get(x.order.id).n,
        before = observations();
      if (mode === "association")
        f.db
          .prepare("UPDATE change_orders SET paypal_invoice_id=? WHERE id=?")
          .run("INV2-REASSOCIATED", x.order.id);
      if (mode === "tombstone")
        f.db
          .prepare(
            "INSERT INTO invoice_tombstones (paypal_invoice_id, change_order_id, run_id, created_at) VALUES (?,?,?,?)",
          )
          .run(invoiceId, x.order.id, f.ctx.runId, new Date().toISOString());
      let cancelledReads = 0;
      f.hook = async (phase) => {
        if (
          phase === "invoice-read" &&
          f.provider.invoices.get(invoiceId).status === "CANCELLED" &&
          ++cancelledReads === 2 &&
          mode === "revoked"
        )
          f.sessions.revokeSession(f.session.token);
      };
      f.provider.invoices.get(invoiceId).status = "CANCELLED";
      if (mode === "revoked") {
        // A caller whose authority ended before the projection receives no data.
        await assert.rejects(confirm(f, p), (error) => error.status === 401);
      } else {
        const outcome = await confirm(f, p);
        assert.equal(outcome.state, "reconciled", mode);
        assert.equal(outcome.providerStatus, "CANCELLED");
        assert.equal(outcome.localProjection, "pending");
        assert.match(outcome.message, /pending/);
      }
      // A changed association stops before any projection read; a tombstone or revocation is
      // caught by the serialized refresh after its fresh read, before anything is recorded.
      assert.equal(cancelledReads, mode === "association" ? 1 : 2, mode);
      const saved = recorded(f, p.id);
      assert.equal(saved.action.state, "reconciled", mode);
      assert.equal(
        JSON.parse(saved.action.result_json).providerStatus,
        "CANCELLED",
      );
      assert.equal(saved.outbound.state, "reconciled");
      assert.equal(observations(), before, mode);
      assert.equal(
        f.orders.getChangeOrder(x.order.id).financialState.invoiceState,
        "payable",
      );
      assert.equal(f.writes, 1);
      if (mode !== "revoked") {
        const retried = await confirm(f, p);
        assert.equal(retried.state, "reconciled");
        assert.equal(retried.localProjection, "pending");
        assert.equal(observations(), before);
        assert.equal(f.writes, 1);
      }
      check();
    } finally {
      f.close();
    }
  }
});

/** The same canonical approved invoice as f.invoice(), linked to an actual Figma request thread. */
async function figmaInvoice(f) {
  const make = await canonicalDraftFactory(f.app),
    service = await f.app.load("changeOrderService"),
    thread = await f.figma(),
    draft = service.draftChangeOrder(f.ctx, make(f.ctx));
  service.submitScopedOrder(f.ctx, draft.id);
  f.portal.publishReviewedQuote(
    f.session,
    thread.requestId,
    draft.id,
    draft.revision,
    true,
  );
  f.orders.approveChangeOrder(draft.id, {
    changeOrderId: draft.id,
    changeOrderRevision: draft.revision,
  });
  await f.orders.ensureInvoice(draft.id);
  return {
    request: f.store.requestById(thread.requestId, f.ctx.runId),
    order: f.orders.getChangeOrder(draft.id),
    expected: f.displayed(thread.requestId),
  };
}

test("R6 Figma request and source moving on after dispatch do not block the cancellation projection", async () => {
  const f = await fixture();
  try {
    const x = await figmaInvoice(f),
      check = commitments(f, x),
      p = await f.actions.prepareReviewedAction(f.ctx, {
        ...selection(x),
        kind: "cancel_invoice",
      });
    assert.equal(x.request.source, "figma");
    // The client replies in the Figma thread while the cancellation POST is in flight.
    f.hook = async (phase) => {
      if (phase !== "post") return;
      f.hook = null;
      f.comments.push({
        id: "client-followup",
        parent_id: "root",
        message: "Also add a receipt screen",
        user: { id: "client" },
        created_at: new Date().toISOString(),
      });
      await f.inbox.refreshRequestThread(f.ctx, "root");
    };
    const outcome = await confirm(f, p),
      moved = f.displayed(x.request.id);
    assert.notEqual(moved.requestVersion, x.expected.requestVersion);
    assert.notEqual(moved.source.version, x.expected.source.version);
    assert.equal(outcome.state, "reconciled");
    assert.equal(outcome.providerStatus, "CANCELLED");
    const local = f.orders.getChangeOrder(x.order.id);
    assert.equal(local.financialState.invoiceState, "cancelled");
    assert.notEqual(local.status, "payment_due");
    assert.equal(outcome.localProjection, "applied");
    assert.equal(f.writes, 1);
    assert.equal((await confirm(f, p)).localProjection, "applied");
    assert.equal(f.writes, 1);
    check();
  } finally {
    f.close();
  }
});
