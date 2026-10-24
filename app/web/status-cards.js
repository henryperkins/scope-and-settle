import {busy} from './common.js';

/** UI-only correlation. Native messages contain opaque context, never the session or private access links. */
export function mountStatusCards({request, getContext, post, inPlugin}) {
  const panel = document.getElementById('card-display-panel');
  let alive = true, counter = 0, epoch = null, pending = null;
  const signature = () => {
    const c = getContext();
    return JSON.stringify([c.session?.token,c.session?.runId,c.project?.id,c.project?.figmaFileKey,c.fileKey,c.generation,c.evidenceEpoch]);
  };
  function say(message) { const status = document.getElementById('status-card-notice'); if (alive && status) status.textContent = message; }
  function invalidate() {
    if (epoch !== null) { post({type: 'status-card-context', context: null}); say('Card update cancelled. Refresh explicitly when the current record is ready.'); }
    epoch = null; counter++;
    if (pending) { clearTimeout(pending.timeout); pending.resolve(null); pending = null; }
  }
  async function refresh() {
    const policy = await request('/api/project/card-display');
    if (!alive) return;
    panel.innerHTML = `<h2>Linked Figma status cards</h2><p>Cards show a cached snapshot. Payment and delivery stay separate. Refresh a linked card explicitly in the running plugin.</p><p id="status-card-notice" role="status" aria-live="polite"></p>`;
    if (inPlugin) {
      const p = document.createElement('p'); p.id = 'card-current-policy'; p.textContent = policy.showAmounts ? 'Amounts are enabled for this run. Manage monetary display from the designer page in your browser.' : 'Amounts are hidden. Manage monetary display from the designer page in your browser.'; panel.append(p);
    } else {
      const form = document.createElement('form');
      form.innerHTML = `<label class="check" for="card-show-amounts"><input id="card-show-amounts" type="checkbox"${policy.showAmounts ? ' checked' : ''}><span>Show monetary amounts on this run’s Figma cards</span></label><p class="muted">Amounts are hidden by default. Turning this off removes amounts on the next successful card refresh. Previously saved or shared copies remain.</p><label class="check" for="card-display-consent"><input id="card-display-consent" type="checkbox" required><span>I approve this canvas display setting.</span></label><button id="save-card-display" type="submit" class="secondary">Save card display</button>`;
      form.onsubmit = event => { event.preventDefault(); busy(document.getElementById('save-card-display'), async () => {
        await request('/api/project/card-display', 'POST', {showAmounts: document.getElementById('card-show-amounts').checked, expectedVersion: policy.version, consent: document.getElementById('card-display-consent').checked});
        invalidate(); await refresh(); say('Display setting saved. Refresh existing cards in the plugin to apply it.');
      }); };
      panel.append(form);
    }
  }
  async function upsert(order) {
    invalidate();
    const c = getContext(), expected = signature(), invocationId = 'card-' + (++counter) + '-' + crypto.randomUUID();
    if (!inPlugin || !c.session || c.fileKey !== c.project?.figmaFileKey) throw new Error('Open the connected project in the Figma plugin to update its card.');
    const capturedEpoch = epoch = invocationId;
    post({type: 'status-card-context', context: {epoch, fileKey: c.project.figmaFileKey, projectId: c.project.id, runId: c.session.runId, appOrigin: new URL(window.SCOPE_SETTLE_API || location.origin).origin}});
    say('Reading the cached application status…');
    let view;
    try { view = await request('/api/change-orders/' + encodeURIComponent(order.id) + '/status-card?revision=' + order.revision); }
    catch (error) { if (alive && epoch === capturedEpoch && signature() === expected) { invalidate(); say(error.message + ' The existing card and its observation time are unchanged.'); } return null; }
    if (!alive || epoch !== capturedEpoch || signature() !== expected) return null;
    if (view.orderId !== order.id || view.revision !== order.revision || view.runId !== c.session.runId || view.projectId !== c.project.id || view.fileKey !== c.fileKey) { invalidate(); say('Card context changed; refresh before trying again.'); return null; }
    const policyNotice = document.getElementById('card-current-policy');
    if (policyNotice) policyNotice.textContent = view.displayPolicy.showAmounts ? 'Amounts are enabled for this run. Manage monetary display from the designer page in your browser.' : 'Amounts are hidden. Manage monetary display from the designer page in your browser.';
    const outcome = await new Promise(resolve => {
      const timeout = setTimeout(() => { if (pending?.invocationId === invocationId) { invalidate(); say('Card update timed out. Refresh explicitly to inspect the saved card.'); } }, 20000);
      pending = {invocationId, epoch: capturedEpoch, orderId: order.id, signature: expected, resolve, timeout};
      post({type: 'upsert-status-card', invocationId, epoch: capturedEpoch, orderId: order.id, view});
    });
    if (!alive || epoch !== capturedEpoch || signature() !== expected || !outcome) return null;
    say(outcome.ok ? 'Cached status card updated. Provider observation: ' + (view.paymentObservedAt ?? 'unavailable') + '. Delivery is not recorded.' : outcome.message);
    return outcome;
  }
  function message(value) {
    const p = pending;
    if (!alive || !p || value.type !== 'status-card-result' || value.invocationId !== p.invocationId || value.epoch !== p.epoch || value.orderId !== p.orderId || signature() !== p.signature) return;
    clearTimeout(p.timeout); pending = null; p.resolve(value);
  }
  return {refresh, upsert, message, invalidate, destroy() { invalidate(); alive = false; panel.replaceChildren(); }};
}
