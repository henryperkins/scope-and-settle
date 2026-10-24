export const base = window.SCOPE_SETTLE_API || location.origin;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[x]));
export const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
export const when = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export const label = value => ({ draft: 'Draft', awaiting_client_approval: 'Awaiting client approval', needs_re_review: 'Designer re-review needed', approved: 'Approved (unpaid)', creating_invoice: 'Preparing invoice', payment_due: 'Payment due', paid: 'Paid', included: 'Already included', new_work: 'New work', needs_clarification: 'Needs clarification', partially_paid: 'Partially paid', payment_pending: 'Payment pending', payment_review_required: 'Payment needs review' }[value] || String(value || '').replaceAll('_', ' '));
// One stroke icon set (24 px grid, 1.75 stroke); decorative, so hidden from assistive technology.
const glyphs = {
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
  alert: '<path d="M10.3 4.9 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0Z"/><path d="M12 10v4M12 17.2h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  brief: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  beaker: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  frame: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${glyphs[name] || ''}</svg>`;
// The settlement track. step is the current stage (1-4); done marks every stage complete.
const stages = ['Request', 'Quote', 'Approval', 'Payment'];
export function track(step, { done = false, tone = '', final = false, mini = false } = {}) {
  const items = stages.map((name, i) => {
    const state = done || i + 1 < step ? 'done' : i + 1 === step ? ['current', tone, final ? 'final' : ''].filter(Boolean).join(' ') : '';
    return `<li${state ? ` class="${state}"` : ''}>${name}</li>`;
  }).join('');
  const where = done ? 'complete' : `stage ${step} of 4, ${stages[step - 1]}`;
  return `<ol class="track${mini ? ' mini' : ''}" aria-label="Progress: ${where}">${items}</ol>`;
}
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
// The page's live status, shown as a toast; confirmations fade, errors stay until dismissed.
let noticeTimer;
export function notice(text, error = false) {
  const el = document.querySelector('#notice'); clearTimeout(noticeTimer);
  el.className = 'toast notice' + (error ? ' error' : '');
  el.innerHTML = `${icon(error ? 'error' : 'info')}<span>${esc(text)}</span><button type="button" class="dismiss" aria-label="Dismiss message">${icon('close')}</button>`;
  el.querySelector('.dismiss').onclick = () => { el.innerHTML = ''; };
  if (!error) noticeTimer = setTimeout(() => { el.innerHTML = ''; }, Math.max(6000, String(text).length * 60));
}
export async function busy(button, action) {
  const html = button.innerHTML; button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Working…';
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = html; }
}
export function itemRows(items, currency) {
  return '<div class="lines">' + items.map(x => `<div class="line"><div><strong>${esc(x.description)}</strong><small>${x.quantity} × ${money(x.unitAmountMinor, currency)} · <span class="source${x.priceSource === 'rate_card' ? '' : ' designer'}">${x.priceSource === 'rate_card' ? 'Rate-card price' : 'Designer-set price'}</span></small></div><strong>${money(x.quantity*x.unitAmountMinor,currency)}</strong></div>`).join('') + '</div>';
}
export function safeInvoice(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'www.sandbox.paypal.com' && u.pathname.startsWith('/invoice/') ? u.href : null; } catch { return null; }
}
