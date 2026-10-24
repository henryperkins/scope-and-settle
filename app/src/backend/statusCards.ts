import {db, getProjectForRun, transaction} from './db.js';
import {requireDesignerContext, ScopedAccessError, type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {config} from './env.js';
import type {StatusCardView} from '../shared/types.js';
import {redactCardMoney} from '../shared/statusCardText.js';
import {projectPayment} from './connectorProjections.js';

export function getCardDisplaySettings(ctx: ActorContext) {
  requireDesignerContext(ctx);
  const row = db.prepare('SELECT show_amounts,version FROM status_card_settings WHERE project_id=? AND run_id=?').get(ctx.projectId, ctx.runId) as {show_amounts: number; version: number} | undefined;
  return {showAmounts: row?.show_amounts === 1, version: row?.version ?? 0};
}

export function saveCardDisplaySettings(ctx: ActorContext, input: unknown) {
  requireDesignerContext(ctx);
  const body = input as any;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['showAmounts', 'expectedVersion', 'consent'].includes(k)) || typeof body.showAmounts !== 'boolean' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || body.consent !== true) {
    throw new ScopedAccessError(400, 'Choose the monetary display setting, current version and explicit consent');
  }
  return transaction(() => {
    const current = getCardDisplaySettings(ctx);
    if (body.expectedVersion !== current.version) throw new ScopedAccessError(409, 'Card display setting changed; reload it before saving');
    db.prepare(`INSERT INTO status_card_settings VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,run_id) DO UPDATE SET show_amounts=excluded.show_amounts,version=excluded.version,actor_id=excluded.actor_id,updated_at=excluded.updated_at`)
      .run(ctx.projectId, ctx.runId, body.showAmounts ? 1 : 0, current.version + 1, ctx.actorId, new Date().toISOString());
    return getCardDisplaySettings(ctx);
  });
}

// Wall-clock-based logical sequence: distinct concurrent reads remain ordered without writing financial/business state.
let readClock = 0;
export function getStatusCard(ctx: ActorContext, orderId: string, revision: number): StatusCardView {
  requireDesignerContext(ctx);
  const order = getScopedOrder(ctx, orderId);
  if (!Number.isSafeInteger(revision) || revision < 1 || order.revision !== revision) throw new ScopedAccessError(409, 'Proposal revision changed; refresh before updating the card');
  const project = getProjectForRun(ctx.runId), displayPolicy = getCardDisplaySettings(ctx), financial = order.financialState;
  const canvasText = (value: string) => displayPolicy.showAmounts ? value : redactCardMoney(value);
  const payment=projectPayment(order,'stored_observation');
  const view: StatusCardView = {
    schemaVersion: 1, fileKey: project.figmaFileKey, projectId: ctx.projectId, runId: ctx.runId, orderId: order.id, revision: order.revision,
    title: canvasText(order.title), deliverables: order.deliverables.map(canvasText),
    scope: {revisionId: order.scopeRevisionId, snapshotId: order.scopeContext?.scopeSnapshotId ?? null, version: order.scopeContext?.scopeVersion ?? null, rateVersion: order.scopeContext?.rateVersion ?? null, approved: order.approvalStatus === 'approved'},
    approvalState: (order.status as string) === 'cancelled' ? 'cancelled' : order.approvalStatus,
    invoiceState: payment.invoiceState, paymentState: payment.paymentState, deliveryState: order.delivery?.state??'not_recorded',
    paymentObservedAt: payment.observedAt, appReadAt: new Date().toISOString(), projectionVersion: readClock = Math.max(Date.now(), readClock + 1),
    displayPolicy,
    money: displayPolicy.showAmounts ? {currency: order.currency, totalMinor: order.totalMinor, amountDueMinor: payment.amountDueMinor, paidMinor: payment.paidMinor, refundedMinor: payment.refundedMinor} : null,
    appUrl: new URL(config.publicUrl).origin + '/designer?order=' + encodeURIComponent(order.id) + '&run=' + encodeURIComponent(ctx.runId),
  };
  if (view.title.length > 200 || view.deliverables.length > 20 || view.deliverables.some(d => d.length > 4000) || Buffer.byteLength(JSON.stringify(view)) > 100_000) throw new ScopedAccessError(409, 'This proposal exceeds the bounded canvas card size; review it in the application');
  requireDesignerContext(ctx);
  return view;
}
