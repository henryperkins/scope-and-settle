export const base = window.SCOPE_SETTLE_API || location.origin;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[x]));
export const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
export const label = value => ({ draft: 'Draft', awaiting_client_approval: 'Awaiting client approval', needs_re_review: 'Designer re-review needed', approved: 'Approved (unpaid)', creating_invoice: 'Preparing invoice', payment_due: 'Payment due', paid: 'Paid', included: 'Already included', new_work: 'New work', needs_clarification: 'Needs clarification', partially_paid: 'Partially paid', payment_pending: 'Payment pending', payment_review_required: 'Payment needs review' }[value] || String(value || '').replaceAll('_', ' '));
export async function api(path, token, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error || 'Request failed (' + response.status + ')'); error.status = response.status; throw error; }
  return result;
}
// One renewal for concurrent expired requests; never repeat a non-401 action.
export function sessionApi(getSession, persist, onInvalid = () => {}) {
  let renewing;
  return async (path, method = 'GET', body) => {
    const initial = getSession();
    try {
      try { return await api(path, initial?.token, method, body); }
      catch (error) {
        if (error.status !== 401 || !initial?.renewalCredential) throw error;
        if (getSession()?.token === initial.token) {
          if (!renewing) renewing = api('/api/session/renew', null, 'POST', { credential: initial.renewalCredential })
            .then(value => persist({ ...value, renewalCredential: initial.renewalCredential }))
            .finally(() => { renewing = null; });
          await renewing;
        }
        return await api(path, getSession()?.token, method, body);
      }
    } catch (error) { if (error.status === 401) onInvalid(); throw error; }
  };
}
export function notice(text, error = false) {
  const el = document.querySelector('#notice'); el.textContent = text; el.className = 'notice' + (error ? ' error' : '');
}
export async function busy(button, action) {
  const text = button.textContent; button.disabled = true; button.textContent = 'Working…';
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; button.textContent = text; }
}
export function itemRows(items, currency) {
  return items.map(x => `<div class="line"><div><strong>${esc(x.description)}</strong><br><small>${x.quantity} × ${money(x.unitAmountMinor, currency)} · ${x.priceSource === 'rate_card' ? 'Rate-card price' : 'Designer-set price'}</small></div><strong>${money(x.quantity*x.unitAmountMinor,currency)}</strong></div>`).join('');
}
export function safeInvoice(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'www.sandbox.paypal.com' && u.pathname.startsWith('/invoice/') ? u.href : null; } catch { return null; }
}
