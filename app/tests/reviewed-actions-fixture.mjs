import assert from "node:assert/strict";
import {
  isolatedApp,
  providerFixture,
  canonicalDraftFactory,
} from "./helpers.mjs";

export async function fixture() {
  const original = globalThis.fetch,
    app = await isolatedApp();
  process.env.FIGMA_COMMENT_POSTING_ENABLED = "true";
  const data = await app.load("db"),
    sessions = await app.load("sessions"),
    context = await app.load("context"),
    store = await app.load("agentStore"),
    orders = await app.load("orders"),
    service = await app.load("changeOrderService"),
    portal = await app.load("agentPortal"),
    inbox = await app.load("requestInbox");
  const actions = await app.load("reviewedActions").catch((e) => {
    if (e.code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  });
  const session = sessions.createSession({
      projectId: "demo",
      role: "designer",
      runId: data.currentRunId(),
    }),
    ctx = context.contextFromSessionToken(session.token),
    provider = providerFixture();
  let writes = 0,
    comments = [],
    hook = null,
    uncertain = false,
    wire = [],
    responseStatus = 204,
    cancelApplies = true,
    badAck = false,
    expireTokens = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === "api.figma.com") {
      if (init.method === "POST") {
        wire.push(JSON.parse(init.body));
        writes++;
        if (hook) await hook("post");
        const b = JSON.parse(init.body),
          reply = {
            id: "actual-reply-" + writes,
            parent_id: b.comment_id,
            message: b.message,
            user: { id: "fixture-designer" },
            created_at: new Date().toISOString(),
          };
        comments.push(reply);
        if (badAck) reply.parent_id = "wrong-root";
        if (uncertain) throw new TypeError("lost acknowledgement");
        return Response.json(reply);
      }
      const copy = structuredClone(comments);
      if (hook) await hook("read");
      return Response.json({ comments: copy });
    }
    if (/\/(remind|cancel)$/.test(u.pathname)) {
      wire.push(JSON.parse(init.body));
      writes++;
      if (hook) await hook("post");
      const inv = provider.invoices.get(u.pathname.split("/").at(-2));
      if (u.pathname.endsWith("/cancel") && cancelApplies)
        inv.status = "CANCELLED";
      if (uncertain) throw new TypeError("lost acknowledgement");
      return new Response(null, {
        status: responseStatus,
        headers: responseStatus === 429 ? { "Retry-After": "3600" } : {},
      });
    }
    if (u.pathname === "/v1/oauth2/token") {
      if (hook) await hook("oauth");
      return Response.json({
        access_token: "test-token",
        expires_in: expireTokens ? 1 : 3600,
      });
    }
    const response = await provider.fetch(url, init);
    if (hook && u.pathname.includes("/invoices/")) await hook("invoice-read");
    return response;
  };
  const make = await canonicalDraftFactory(app);
  async function invoice() {
    const input = make(ctx),
      source = data.db
        .prepare(
          "SELECT s.* FROM request_sources s JOIN request_item_results r ON r.source_id=s.id WHERE r.item_id=?",
        )
        .get(input.itemIds[0]),
      messages = JSON.parse(
        data.db
          .prepare(
            "SELECT messages_json FROM request_source_versions WHERE source_id=?",
          )
          .get(source.id).messages_json,
      );
    const request = store.createRequest(
      ctx.runId,
      source.source,
      source.root_id,
      messages[0].message,
      { inboxOnly: true },
    );
    data.db
      .prepare(
        "UPDATE agent_messages SET source_id=? WHERE request_id=? AND actor='client'",
      )
      .run(source.root_id, request.id);
    const draft = service.draftChangeOrder(ctx, input),
      submitted = service.submitScopedOrder(ctx, draft.id);
    portal.publishReviewedQuote(
      session,
      request.id,
      draft.id,
      draft.revision,
      true,
    );
    orders.approveChangeOrder(draft.id, {
      changeOrderId: draft.id,
      changeOrderRevision: draft.revision,
    });
    await orders.ensureInvoice(draft.id);
    data.db
      .prepare("UPDATE approvals SET created_at=? WHERE change_order_id=?")
      .run(new Date(Date.now() - 25 * 3600000).toISOString(), draft.id);
    return {
      request: store.requestById(request.id, ctx.runId),
      order: orders.getChangeOrder(draft.id),
      expected: displayed(request.id),
    };
  }
  function displayed(id) {
    const t = inbox.listRequestInbox(ctx).find((t) => t.id === id);
    return {
      requestVersion: store.requestById(id, ctx.runId).version,
      source: t.source,
    };
  }
  async function figma() {
    comments.push({
      id: "root",
      message: "Please clarify this change",
      user: { id: "client" },
      created_at: new Date().toISOString(),
    });
    const thread = await inbox.refreshRequestThread(ctx, "root");
    return {
      kind: "post_clarification",
      requestId: thread.id,
      text: "Which flow do you mean?",
      expected: displayed(thread.id),
    };
  }
  return {
    app,
    ...data,
    displayed,
    get wire() {
      return wire;
    },
    set responseStatus(v) {
      responseStatus = v;
    },
    set cancelApplies(v) {
      cancelApplies = v;
    },
    set badAck(v) {
      badAck = v;
    },
    set expireTokens(v) {
      expireTokens = v;
    },
    sessions,
    context,
    ctx,
    session,
    actions,
    provider,
    store,
    orders,
    portal,
    inbox,
    invoice,
    figma,
    get writes() {
      return writes;
    },
    get comments() {
      return comments;
    },
    set hook(v) {
      hook = v;
    },
    set uncertain(v) {
      uncertain = v;
    },
    close() {
      globalThis.fetch = original;
      data.db.close();
    },
  };
}
export function required(f) {
  assert.equal(
    typeof f.actions.prepareReviewedAction,
    "function",
    "reviewed preparation service required",
  );
  assert.equal(
    typeof f.actions.confirmReviewedAction,
    "function",
    "human confirmation service required",
  );
}
export const selection = (x) => ({
  kind: "remind_invoice",
  requestId: x.request.id,
  orderId: x.order.id,
  revision: x.order.revision,
  recipients: {
    sendToRecipient: true,
    sendToInvoicer: false,
    additionalRecipients: [],
  },
  expected: x.expected,
});
