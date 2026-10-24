import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './source-freshness-fixture.mjs';

// T12a: human-confirmed agent action preparation (submit_for_client_approval and issue_approved_invoice)
// through T10's reviewed-action service and T11's operation-bound connector authority.
const DEFAULT_OPS = ['get_project_scope', 'assess_change_request', 'draft_change_order', 'get_payment_status'];
const PREPARE_OPS = ['submit_for_client_approval', 'issue_approved_invoice'];
const ALL_OPS = [...DEFAULT_OPS, ...PREPARE_OPS];
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEAK = /demo:(grant|session)|connector:|ssc1\.|INV2-|@example\.com|invoiceUrl|approvalUrl|payerView|\/review#|#resume=|actorId|confirmerId|initiatorId|parentRef|digest|secret/i;
const status = code => error => error?.status === code;

async function setup() {
  process.env.MCP_CONNECTOR_ENABLED = 'true';
  const f = await fixture();
  f.auth = await f.app.load('mcpAuth');
  for (const name of ['scopeLedger', 'judging', 'judgeAccess', 'agentPortal', 'agentPolicy', 'outboundActions']) {
    f.m[name] = await f.app.load(name);
  }
  f.issue = (body = { consent: true }, { token = f.session.token, origin = f.base } = {}) =>
    f.http('/api/connectors', 'POST', body, token, origin ? { Origin: origin } : {});
  f.issued = async (body = { consent: true }) => {
    const r = await f.issue(body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  f.mint = (secret, operation) => f.auth.mintConnectorContext('Bearer ' + secret, operation);
  f.entrance = name => {
    const fn = f.auth.connectorEntrances?.[name] ?? f.auth.connectorPreparationEntrances?.[name];
    assert.equal(typeof fn, 'function', `Missing connector entrance ${name}`);
    return fn;
  };
  f.call = (credential, operation, input) => f.entrance(operation)(f.mint(credential.secret, operation), input);
  f.designer = (options = {}) => {
    const session = f.m.sessions.createSession({ projectId: 'demo', role: 'designer', runId: f.m.db.currentRunId(), ...options });
    return { session, ctx: f.m.context.contextFromSessionToken(session.token) };
  };
  f.confirmHttp = (actionId, previewHash, { token = f.session.token, origin = f.base, body } = {}) =>
    f.http('/api/reviewed-actions/' + encodeURIComponent(actionId) + '/confirm', 'POST', body ?? { previewHash, consent: true }, token, origin ? { Origin: origin } : {});
  return f;
}

test('T12a preparation is opt-in, has zero side effects and returns only the bounded review reference', async () => {
  const f = await setup();
  try {
    f.root('p1', 'Gallery alpha screen');
    f.reply('p1r', 'p1', 'Banner bravo screen');
    // Default issuance excludes both preparation tools; existing credentials never gain them.
    const defaultCred = await f.issued();
    assert.deepEqual(defaultCred.connector.operations, DEFAULT_OPS);
    for (const op of PREPARE_OPS) {
      assert.throws(() => f.mint(defaultCred.secret, op), status(403), op);
    }
    const optIn = await f.issued({ consent: true, operations: ALL_OPS });
    assert.deepEqual(optIn.connector.operations, ALL_OPS);
    assert.deepEqual(f.auth.listConnectorCredentials(f.ctx).operations, ALL_OPS);

    const assessed = await f.call(optIn, 'assess_change_request', { commentId: 'p1' });
    const [item1, item2] = assessed.items;
    const draft1 = await f.call(optIn, 'draft_change_order', {
      operationId: 'prep-draft-1',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item1.itemId, expected: item1.review }],
    });
    const draft2 = await f.call(optIn, 'draft_change_order', {
      operationId: 'prep-draft-2',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item2.itemId, expected: item2.review }],
    });

    // Submit and client-approve draft2 without issuing an invoice yet; then assess p1b for draft1 under the updated commitment context.
    f.root('p1b', 'Carousel charlie screen');
    const sub2 = f.service.submitScopedOrder(f.ctx, draft2.orderId);
    f.orders.approveChangeOrder(draft2.orderId, { changeOrderId: draft2.orderId, changeOrderRevision: sub2.order.revision });
    const assessedAfter = await f.call(optIn, 'assess_change_request', { commentId: 'p1b' });
    const draftAfter = await f.call(optIn, 'draft_change_order', {
      operationId: 'prep-draft-after',
      assessmentId: assessedAfter.assessmentId,
      items: [{ itemId: assessedAfter.items[0].itemId, expected: assessedAfter.items[0].review }],
    });

    const beforeCounts = f.counts();
    const beforeProvider = f.provider.counts();
    const beforeCalls = f.calls;

    // draft1 (from before draft2's approval) is now stale for submit because commitment context changed.
    await assert.rejects(
      async () => f.call(optIn, 'submit_for_client_approval', { orderId: draft1.orderId, expectedRevision: draft1.revision }),
      status(409),
    );

    const prepSubmit = await f.call(optIn, 'submit_for_client_approval', {
      orderId: draftAfter.orderId,
      expectedRevision: draftAfter.revision,
    });
    const prepInvoice = await f.call(optIn, 'issue_approved_invoice', {
      orderId: draft2.orderId,
      expectedRevision: sub2.order.revision,
    });

    // Zero publication, approval, invoice, outbox, outbound, provider or AI effects during preparation.
    assert.deepEqual(f.counts(), beforeCounts);
    assert.deepEqual(f.provider.counts(), beforeProvider);
    assert.equal(f.calls, beforeCalls);
    assert.equal(f.orders.getChangeOrder(draftAfter.orderId).status, 'draft');
    assert.equal(f.orders.getChangeOrder(draft2.orderId).paypalInvoiceId, null);

    for (const [prep, kind, orderId, revision] of [
      [prepSubmit, 'submit_for_client_approval', draftAfter.orderId, draftAfter.revision],
      [prepInvoice, 'issue_approved_invoice', draft2.orderId, sub2.order.revision],
    ]) {
      assert.deepEqual(
        Object.keys(prep).sort(),
        ['actionId', 'expiresAt', 'kind', 'orderId', 'previewHash', 'reviewUrl', 'revision', 'state'],
      );
      assert.match(prep.actionId, UUID);
      assert.equal(prep.kind, kind);
      assert.equal(prep.orderId, orderId);
      assert.equal(prep.revision, revision);
      assert.match(prep.previewHash, HEX64);
      assert.equal(prep.reviewUrl, `${f.base}/designer?action=${encodeURIComponent(prep.actionId)}`);
      assert.equal(prep.state, 'prepared');
      assert.doesNotMatch(JSON.stringify(prep), LEAK);
      const row = f.db.prepare('SELECT * FROM reviewed_actions WHERE id=?').get(prep.actionId);
      assert.equal(row.initiator_id, `connector:${optIn.connector.id}`);
      assert.equal(row.confirmer_id, f.ctx.actorId);
      assert.equal(row.state, 'prepared');
      assert.doesNotMatch(row.preview_json, /\/review#|#resume=|ssc1\./);
    }
  } finally {
    await f.close();
  }
});

test('T12a connector authority, forged approval/confirm fields and non-owner humans cannot confirm or execute', async () => {
  const f = await setup();
  try {
    f.root('f1', 'Gallery alpha screen');
    const cred = await f.issued({ consent: true, operations: ALL_OPS });
    const assessed = await f.call(cred, 'assess_change_request', { commentId: 'f1' });
    const draft = await f.call(cred, 'draft_change_order', {
      operationId: 'forged-draft',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: assessed.items[0].itemId, expected: assessed.items[0].review }],
    });

    // Forged approval, confirmation, price, merchant, currency and actor arguments are rejected at preparation.
    for (const op of PREPARE_OPS) {
      for (const extra of [
        { confirmed: true },
        { consent: true },
        { approved: true },
        { clientApproved: true },
        { approvalStatus: 'approved' },
        { totalMinor: 100 },
        { amount: 100 },
        { currency: 'EUR' },
        { merchant: 'attacker@example.com' },
        { merchantEmail: 'attacker@example.com' },
        { actorId: f.ctx.actorId },
        { confirmerId: f.ctx.actorId },
        { projectId: 'demo' },
        { runId: f.ctx.runId },
        { items: [] },
        { lineItems: [] },
        { scope: {} },
      ]) {
        await assert.rejects(
          async () => f.call(cred, op, { orderId: draft.orderId, expectedRevision: draft.revision, ...extra }),
          status(400),
          `${op} accepted ${JSON.stringify(extra)}`,
        );
      }
    }

    // Unapproved proposal cannot prepare issue_approved_invoice.
    await assert.rejects(
      async () => f.call(cred, 'issue_approved_invoice', { orderId: draft.orderId, expectedRevision: draft.revision }),
      status(409),
    );

    const prepSubmit = await f.call(cred, 'submit_for_client_approval', {
      orderId: draft.orderId,
      expectedRevision: draft.revision,
    });

    // Connector contexts and connector bearer tokens cannot read or confirm reviewed actions.
    for (const op of ALL_OPS) {
      const mctx = f.mint(cred.secret, op);
      assert.throws(() => f.actions.getReviewedAction(mctx, prepSubmit.actionId), status(401));
      await assert.rejects(() => f.actions.confirmReviewedAction(mctx, prepSubmit.actionId, prepSubmit.previewHash), status(401));
    }
    assert.equal((await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { token: cred.secret })).status, 401);

    // Another designer session in the same project/run is NOT the parent owner and cannot read or confirm.
    const otherDesigner = f.designer();
    assert.throws(() => f.actions.getReviewedAction(otherDesigner.ctx, prepSubmit.actionId), status(404));
    await assert.rejects(
      () => f.actions.confirmReviewedAction(otherDesigner.ctx, prepSubmit.actionId, prepSubmit.previewHash),
      status(404),
    );
    assert.equal(
      (await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { token: otherDesigner.session.token })).status,
      404,
    );

    // A client session cannot read or confirm.
    const clientSession = f.m.sessions.createSession({
      projectId: 'demo',
      role: 'client',
      runId: f.ctx.runId,
      changeOrderId: draft.orderId,
      changeOrderRevision: draft.revision,
    });
    assert.equal((await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { token: clientSession.token })).status, 403);

    // Missing Origin, wrong Origin, missing consent or wrong previewHash cannot confirm.
    assert.equal((await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { origin: null })).status, 403);
    assert.equal((await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { origin: 'https://www.figma.com' })).status, 403);
    assert.equal(
      (await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { body: { previewHash: prepSubmit.previewHash, consent: false } })).status,
      400,
    );
    assert.equal(
      (await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash, { body: { previewHash: prepSubmit.previewHash, confirmed: true } })).status,
      400,
    );
    assert.equal((await f.confirmHttp(prepSubmit.actionId, '0'.repeat(64))).status, 409);

    // Visiting the landing URL or reading the action preview never executes or changes state.
    const landing = await fetch(prepSubmit.reviewUrl);
    assert.equal(landing.status, 200);
    const viewed = await f.http('/api/reviewed-actions/' + prepSubmit.actionId);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.body.result.state, 'prepared');
    assert.equal(f.orders.getChangeOrder(draft.orderId).status, 'draft');
    assert.equal(f.count('SELECT COUNT(*) n FROM invitations'), 0);

    // Expiry and parent invalidation cannot turn a prepared review into authority.
    const countsBeforeExpiry = f.counts();
    const expiryPrep = await f.call(cred, 'submit_for_client_approval', { orderId: draft.orderId, expectedRevision: draft.revision });
    f.db.prepare('UPDATE reviewed_actions SET expires_at=? WHERE id=?').run(new Date(0).toISOString(), expiryPrep.actionId);
    await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, expiryPrep.actionId, expiryPrep.previewHash), status(409));
    const shortCredential = await f.issued({ consent: true, operations: ALL_OPS, expiresInMinutes: 1 });
    const shortPrep = await f.call(shortCredential, 'submit_for_client_approval', { orderId: draft.orderId, expectedRevision: draft.revision });
    const originalNow = Date.now;
    try {
      Date.now = () => Date.parse(shortCredential.connector.expiresAt) + 1;
      await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, shortPrep.actionId, shortPrep.previewHash), status(409));
    } finally {
      Date.now = originalNow;
    }
    f.db.prepare('UPDATE sessions SET expires_at=?').run(new Date(0).toISOString());
    await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, prepSubmit.actionId, prepSubmit.previewHash), status(401));
    assert.deepEqual(f.counts(), countsBeforeExpiry);
    f.orders.resetDemoRun(f.ctx.runId);
    assert.equal((await f.confirmHttp(prepSubmit.actionId, prepSubmit.previewHash)).status, 401);
    assert.deepEqual(f.provider.counts(), { creates: 0, sends: 0 });
  } finally {
    await f.close();
  }
});

test('T12a submit_for_client_approval enforces source fence, scope/terms currency and parent/connector liveness, and strips client links outside human confirm', async () => {
  const f = await setup();
  try {
    f.root('s1', 'Gallery alpha screen');
    f.reply('s1r', 's1', 'Banner bravo screen');
    f.root('s2', 'Carousel charlie screen');
    const cred = await f.issued({ consent: true, operations: ALL_OPS });
    const assessed = await f.call(cred, 'assess_change_request', { commentId: 's1' });
    const [item1, item2] = assessed.items;
    const draft1 = await f.call(cred, 'draft_change_order', {
      operationId: 'sub-draft-1',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item1.itemId, expected: item1.review }],
    });
    const draft2 = await f.call(cred, 'draft_change_order', {
      operationId: 'sub-draft-2',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item2.itemId, expected: item2.review }],
    });
    const assessedS2 = await f.call(cred, 'assess_change_request', { commentId: 's2' });
    const draftS2 = await f.call(cred, 'draft_change_order', {
      operationId: 'sub-draft-s2',
      assessmentId: assessedS2.assessmentId,
      items: [{ itemId: assessedS2.items[0].itemId, expected: assessedS2.items[0].review }],
    });

    // Wrong revision is rejected.
    await assert.rejects(
      async () => f.call(cred, 'submit_for_client_approval', { orderId: draft1.orderId, expectedRevision: draft1.revision + 1 }),
      status(409),
    );

    const prep1 = await f.call(cred, 'submit_for_client_approval', {
      orderId: draft1.orderId,
      expectedRevision: draft1.revision,
    });
    const prepS2 = await f.call(cred, 'submit_for_client_approval', {
      orderId: draftS2.orderId,
      expectedRevision: draftS2.revision,
    });

    // Latching s2 fences both new submit preparation on s2 and confirmation of the already-prepared prepS2.
    f.remove('s2');
    await assert.rejects(
      async () => f.call(cred, 'assess_change_request', { commentId: 's2' }),
      error => [400, 409].includes(error.status),
    );
    await assert.rejects(
      async () => f.call(cred, 'submit_for_client_approval', { orderId: draftS2.orderId, expectedRevision: draftS2.revision }),
      status(409),
    );
    await assert.rejects(
      () => f.actions.confirmReviewedAction(f.ctx, prepS2.actionId, prepS2.previewHash),
      status(409),
    );
    assert.equal(f.orders.getChangeOrder(draftS2.orderId).status, 'draft');

    // Mutating amount, currency, line items or revision after preview denies confirmation; restoring allows it.
    const origOrder = f.db.prepare('SELECT total_minor, currency, line_items_json, revision FROM change_orders WHERE id=?').get(draft1.orderId);
    for (const [sql, param] of [
      ['UPDATE change_orders SET total_minor=99999 WHERE id=?', draft1.orderId],
      ["UPDATE change_orders SET currency='EUR' WHERE id=?", draft1.orderId],
      ["UPDATE change_orders SET line_items_json=json_set(line_items_json,'$[0].description','Changed after preview') WHERE id=?", draft1.orderId],
      ['UPDATE change_orders SET revision=revision+1 WHERE id=?', draft1.orderId],
    ]) {
      f.db.prepare(sql).run(param);
      await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, prep1.actionId, prep1.previewHash), status(409));
      f.db
        .prepare('UPDATE change_orders SET total_minor=?, currency=?, line_items_json=?, revision=? WHERE id=?')
        .run(origOrder.total_minor, origOrder.currency, origOrder.line_items_json, origOrder.revision, draft1.orderId);
    }
    f.db.prepare("UPDATE proposal_item_reservations SET state='released' WHERE order_id=?").run(draft1.orderId);
    await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, prep1.actionId, prep1.previewHash), status(409));
    f.db.prepare("UPDATE proposal_item_reservations SET state='reserved' WHERE order_id=?").run(draft1.orderId);

    // Revoking the initiating connector denies confirmation of its prepared action.
    const shortCred = await f.issued({ consent: true, operations: ALL_OPS });
    const revokedPrep = await f.call(shortCred, 'submit_for_client_approval', {
      orderId: draft2.orderId,
      expectedRevision: draft2.revision,
    });
    f.auth.revokeConnectorCredential(f.ctx, shortCred.connector.id);
    await assert.rejects(
      () => f.actions.confirmReviewedAction(f.ctx, revokedPrep.actionId, revokedPrep.previewHash),
      status(409),
    );
    assert.equal(f.orders.getChangeOrder(draft2.orderId).status, 'draft');

    // Confirming prep1 by the owner designer session publishes draft1, leaves draft2 untouched, and returns approvalUrl only in the confirm response.
    const confirmed = await f.confirmHttp(prep1.actionId, prep1.previewHash);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.state, 'acknowledged');
    assert.match(confirmed.body.approvalUrl, /\/review#/);
    assert.equal(f.orders.getChangeOrder(draft1.orderId).status, 'awaiting_client_approval');
    assert.equal(f.orders.getChangeOrder(draft2.orderId).status, 'draft');

    // Stored result_json and GET /api/reviewed-actions/:id never persist the raw client approvalUrl bearer token.
    const storedRow = f.db.prepare('SELECT preview_json, result_json FROM reviewed_actions WHERE id=?').get(prep1.actionId);
    assert.doesNotMatch(storedRow.preview_json, /\/review#|#resume=/);
    assert.doesNotMatch(storedRow.result_json, /\/review#|#resume=/);

    // Replaying confirmation is idempotent and does not issue a second invitation or bump revision.
    const invitationsAfterFirst = f.count('SELECT COUNT(*) n FROM invitations');
    const replay = await f.confirmHttp(prep1.actionId, prep1.previewHash);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.state, 'acknowledged');
    assert.equal(f.count('SELECT COUNT(*) n FROM invitations'), invitationsAfterFirst);
  } finally {
    await f.close();
  }
});

test('T12a issue_approved_invoice requires exact persisted client approval, revalidates terms/merchant/scope at confirmation and reuses one invoice operation', async () => {
  const f = await setup();
  try {
    f.root('inv1', 'Gallery alpha screen');
    f.reply('inv1r', 'inv1', 'Banner bravo screen');
    // Test with a judging grant parent as well: renewal under the same grant preserves the owner_actor_id.
    const access = f.m.judging.createJudgeAccess();
    const judge = f.m.judging.startJudgeRun(access.credential);
    const jctx = f.m.context.contextFromSessionToken(judge.token);
    const cred = f.auth.issueConnectorCredential(jctx, { consent: true, operations: ALL_OPS });

    const assessed = await f.call(cred, 'assess_change_request', { commentId: 'inv1' });
    const [item1, item2] = assessed.items;
    const draft1 = await f.call(cred, 'draft_change_order', {
      operationId: 'inv-draft-1',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item1.itemId, expected: item1.review }],
    });
    const draft2 = await f.call(cred, 'draft_change_order', {
      operationId: 'inv-draft-2',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: item2.itemId, expected: item2.review }],
    });

    // Submit both partial proposals.
    const sub1 = f.service.submitScopedOrder(jctx, draft1.orderId);
    const sub2 = f.service.submitScopedOrder(jctx, draft2.orderId);

    // Neither is approved yet: issue_approved_invoice is refused.
    await assert.rejects(
      async () => f.call(cred, 'issue_approved_invoice', { orderId: draft1.orderId, expectedRevision: sub1.order.revision }),
      status(409),
    );

    // Client approves only draft1 revision 1; draft2 remains awaiting_client_approval.
    f.orders.approveChangeOrder(draft1.orderId, { changeOrderId: draft1.orderId, changeOrderRevision: sub1.order.revision });
    await assert.rejects(
      async () => f.call(cred, 'issue_approved_invoice', { orderId: draft2.orderId, expectedRevision: sub2.order.revision }),
      status(409),
    );
    await assert.rejects(
      async () => f.call(cred, 'issue_approved_invoice', { orderId: draft1.orderId, expectedRevision: sub1.order.revision + 1 }),
      status(409),
    );

    // Even if the Figma source is now deleted and latched unavailable, approved commitments and invoice issuance stay unfenced.
    f.remove('inv1', 'inv1r');
    await assert.rejects(
      async () => f.call(cred, 'assess_change_request', { commentId: 'inv1' }),
      error => [400, 409].includes(error.status),
    );

    const prepA = await f.call(cred, 'issue_approved_invoice', {
      orderId: draft1.orderId,
      expectedRevision: sub1.order.revision,
    });
    const prepB = await f.call(cred, 'issue_approved_invoice', {
      orderId: draft1.orderId,
      expectedRevision: sub1.order.revision,
    });
    assert.deepEqual(f.provider.counts(), { creates: 0, sends: 0 });

    // Renew the judging designer session: the renewed session still represents the same grant owner and can confirm.
    const renewed = f.m.judging.renewJudgeSession(judge.renewalCredential);
    const renewedCtx = f.m.context.contextFromSessionToken(renewed.token);

    // Mutating merchant, environment, amount, currency, scope or approval before/during confirmation is denied.
    const origMerchant = f.m.env.config.paypalMerchantEmail;
    f.m.env.config.paypalMerchantEmail = 'wrong-merchant@example.com';
    await assert.rejects(
      () => f.actions.confirmReviewedAction(renewedCtx, prepA.actionId, prepA.previewHash),
      status(409),
    );
    f.m.env.config.paypalMerchantEmail = origMerchant;

    const originalEnvironment = f.m.env.config.paypalEnv;
    f.m.env.config.paypalEnv = 'live';
    await assert.rejects(() => f.actions.confirmReviewedAction(renewedCtx, prepA.actionId, prepA.previewHash), status(409));
    f.m.env.config.paypalEnv = originalEnvironment;
    for (const [column, changed] of [['currency', 'EUR'], ['scope_revision_id', 'changed-scope'], ['revision', sub1.order.revision + 1]]) {
      const original = f.db.prepare(`SELECT ${column} AS value FROM change_orders WHERE id=?`).get(draft1.orderId).value;
      f.db.prepare(`UPDATE change_orders SET ${column}=? WHERE id=?`).run(changed, draft1.orderId);
      await assert.rejects(() => f.actions.confirmReviewedAction(renewedCtx, prepA.actionId, prepA.previewHash), status(409));
      f.db.prepare(`UPDATE change_orders SET ${column}=? WHERE id=?`).run(original, draft1.orderId);
    }
    f.db.prepare("UPDATE approvals SET actor_role='designer' WHERE change_order_id=?").run(draft1.orderId);
    await assert.rejects(() => f.actions.confirmReviewedAction(renewedCtx, prepA.actionId, prepA.previewHash), status(409));
    f.db.prepare("UPDATE approvals SET actor_role='client' WHERE change_order_id=?").run(draft1.orderId);

    // Terms changed during a held OAuth await are denied before any invoice creation.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/v1/oauth2/token')) {
        f.db.prepare('UPDATE change_orders SET total_minor=99999 WHERE id=?').run(draft1.orderId);
      }
      return origFetch(url, init);
    };
    try {
      await assert.rejects(
        () => f.actions.confirmReviewedAction(renewedCtx, prepA.actionId, prepA.previewHash),
        status(409),
      );
      assert.deepEqual(f.provider.counts(), { creates: 0, sends: 0 });
    } finally {
      globalThis.fetch = origFetch;
      f.db.prepare('UPDATE change_orders SET total_minor=? WHERE id=?').run(draft1.totalMinor, draft1.orderId);
    }

    // Prepare a fresh invoice action after the denied attempt; concurrent confirmations and a second action reuse one invoice operation.
    const prepC = await f.call(cred, 'issue_approved_invoice', {
      orderId: draft1.orderId,
      expectedRevision: sub1.order.revision,
    });
    const [res1, res2] = await Promise.all([
      f.actions.confirmReviewedAction(renewedCtx, prepC.actionId, prepC.previewHash),
      f.actions.confirmReviewedAction(renewedCtx, prepC.actionId, prepC.previewHash),
    ]);
    assert.equal(res1.state, 'acknowledged');
    assert.equal(res2.state, 'acknowledged');
    assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });
    const invoiceId = f.orders.getChangeOrder(draft1.orderId).paypalInvoiceId;
    assert.ok(invoiceId);
    assert.equal(f.orders.getChangeOrder(draft2.orderId).paypalInvoiceId, null);

    // Confirming prepB for the same approved revision reuses the existing invoice operation without creating or sending a second invoice.
    const resB = await f.actions.confirmReviewedAction(renewedCtx, prepB.actionId, prepB.previewHash);
    assert.equal(resB.state, 'acknowledged');
    assert.equal(resB.providerId, invoiceId);
    assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });
    assert.equal(f.count('SELECT COUNT(*) n FROM invoice_operations WHERE change_order_id=?', draft1.orderId), 1);
  } finally {
    await f.close();
  }
});

test('T12a uncertain invoice outcome, restart recovery and read-only outcome check never duplicate or resend, and portal flow is unchanged', async () => {
  const f = await setup();
  try {
    f.root('u1', 'Gallery alpha screen');
    const cred = await f.issued({ consent: true, operations: ALL_OPS });
    const assessed = await f.call(cred, 'assess_change_request', { commentId: 'u1' });
    const draft = await f.call(cred, 'draft_change_order', {
      operationId: 'uncertain-inv-draft',
      assessmentId: assessed.assessmentId,
      items: [{ itemId: assessed.items[0].itemId, expected: assessed.items[0].review }],
    });
    const sub = f.service.submitScopedOrder(f.ctx, draft.orderId);
    f.orders.approveChangeOrder(draft.orderId, { changeOrderId: draft.orderId, changeOrderRevision: sub.order.revision });

    const prep = await f.call(cred, 'issue_approved_invoice', {
      orderId: draft.orderId,
      expectedRevision: sub.order.revision,
    });

    // Simulate a lost response after PayPal send completes on the provider side.
    const origFetch = globalThis.fetch;
    let failSendResponse = true;
    globalThis.fetch = async (url, init) => {
      const res = await origFetch(url, init);
      if (failSendResponse && String(url).endsWith('/send')) {
        failSendResponse = false;
        throw new TypeError('lost send response');
      }
      return res;
    };
    let firstOutcome;
    try {
      firstOutcome = await f.actions.confirmReviewedAction(f.ctx, prep.actionId, prep.previewHash);
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(firstOutcome.state, 'uncertain');
    assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });

    // Read-only outcome check (reconcile via confirmReviewedAction on the uncertain action) observes the sent invoice without resending.
    const reconciled = await f.actions.confirmReviewedAction(f.ctx, prep.actionId, prep.previewHash);
    assert.equal(reconciled.state, 'reconciled');
    assert.ok(['SENT', 'UNPAID'].includes(reconciled.providerStatus), String(reconciled.providerStatus));
    assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });
    assert.equal(f.orders.getChangeOrder(draft.orderId).financialState.invoiceState, 'payable');

    // Restart recovery: an interrupted executing action becomes uncertain on recoverOutbound() and reconciles read-only.
    f.db.prepare("UPDATE reviewed_actions SET state='executing', result_json=NULL WHERE id=?").run(prep.actionId);
    f.db.prepare("UPDATE outbound_operations SET state='dispatching' WHERE outbox_id=?").run(prep.actionId);
    f.m.outboundActions.recoverOutbound();
    assert.equal(f.db.prepare('SELECT state FROM reviewed_actions WHERE id=?').get(prep.actionId).state, 'uncertain');
    const afterRestart = await f.actions.confirmReviewedAction(f.ctx, prep.actionId, prep.previewHash);
    assert.equal(afterRestart.state, 'reconciled');
    assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });

    // Direct client portal approval-and-invoice flow remains unchanged.
    f.m.agentPolicy.saveAgentPolicy(f.session, {
      enabled: true,
      consent: true,
      allowedRateIds: ['mobile_checkout', 'additional_onboarding_screen'],
      maxQuoteMinor: 50000,
      maxTotalMinor: 100000,
      maxQuantity: 2,
    });
    const portalAccess = f.m.agentPortal.createPortalAccess(f.session);
    const portalSession = f.m.agentPortal.getPortalSession(portalAccess.credential);
    const portalReq = f.m.agentPortal.addPortalRequest(portalSession, 'Add one onboarding screen', 'portal-key-12a');
    const portalAssessed = await f.m.requestItems.assessStoredRequest(f.ctx, portalReq.id);
    const portalDraft = f.service.draftChangeOrder(f.ctx, {
      itemIds: [portalAssessed.items[0].id],
      operationId: 'portal-op-12a',
      assessmentId: portalAssessed.id,
    });
    const portalSubmitted = f.service.submitScopedOrder(f.ctx, portalDraft.id);
    f.m.agentPortal.publishReviewedQuote(f.session, portalReq.id, portalDraft.id, portalSubmitted.order.revision, true);
    const portalApproved = await f.m.agentPortal.approvePortalQuote(
      portalSession,
      portalReq.id,
      portalSubmitted.order.revision,
      true,
      portalDraft.id,
    );
    assert.equal(portalApproved.order.approvalStatus, 'approved');
    assert.ok(portalApproved.order.paypalInvoiceId);
    assert.deepEqual(f.provider.counts(), { creates: 2, sends: 2 });
  } finally {
    await f.close();
  }
});

test('T12a read-only invoice outcome checks reject owner revocation during provider retrieval', async () => {
  const f = await setup();
  try {
    f.root('outcome-owner', 'Gallery alpha screen');
    const cred = await f.issued({ consent: true, operations: ALL_OPS });
    const assessed = await f.call(cred, 'assess_change_request', { commentId: 'outcome-owner' });
    const draft = await f.call(cred, 'draft_change_order', {
      operationId: 'outcome-owner-draft', assessmentId: assessed.assessmentId,
      items: [{ itemId: assessed.items[0].itemId, expected: assessed.items[0].review }],
    });
    f.service.submitScopedOrder(f.ctx, draft.orderId);
    f.orders.approveChangeOrder(draft.orderId, { changeOrderId: draft.orderId, changeOrderRevision: draft.revision });
    const prep = await f.call(cred, 'issue_approved_invoice', { orderId: draft.orderId, expectedRevision: draft.revision });
    const originalFetch = globalThis.fetch;
    let loseAcknowledgement = true;
    globalThis.fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (loseAcknowledgement && String(url).endsWith('/send')) {
        loseAcknowledgement = false;
        throw new TypeError('synthetic lost send acknowledgement');
      }
      return response;
    };
    try {
      assert.equal((await f.actions.confirmReviewedAction(f.ctx, prep.actionId, prep.previewHash)).state, 'uncertain');
      const invoiceId = f.orders.getChangeOrder(draft.orderId).paypalInvoiceId;
      let revoked = false;
      globalThis.fetch = async (url, init) => {
        const response = await originalFetch(url, init);
        if (String(url).endsWith('/invoices/' + invoiceId)) {
          f.m.sessions.revokeSession(f.session.token);
          revoked = true;
        }
        return response;
      };
      await assert.rejects(() => f.actions.confirmReviewedAction(f.ctx, prep.actionId, prep.previewHash), status(401));
      assert.equal(revoked, true);
      assert.deepEqual(f.provider.counts(), { creates: 1, sends: 1 });
      assert.equal(f.db.prepare('SELECT state FROM reviewed_actions WHERE id=?').get(prep.actionId).state, 'uncertain');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await f.close();
  }
});
