export const base = window.SCOPE_SETTLE_API || location.origin;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[x]));
export const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
export const canPay = order => order.financialState?.invoiceState === 'payable' && ['due','partial'].includes(order.financialState.paymentState) && order.financialState.amountDueMinor > 0 && !!safeInvoice(order.invoiceUrl);
export function financialLabel(order) {
  if(order.installments?.some(m=>m.state==='review_required'))return 'Payment needs review';
  if(order.installments?.some(m=>!m.legacy)&&order.installmentSummary){const s=order.installmentSummary;return s.unknownRecordIds.length?'Payment needs review':s.allObligationsPaid?'Paid':s.workStartSatisfied?'Deposit paid · Balance outstanding':order.approvalStatus==='approved'?'Installment payment due':label(order.status);}
  const f=order.financialState;
  if(!f)return order.paypalInvoiceId?'Payment needs review':label(order.status);
  if(f.paymentState==='review_required')return 'Payment needs review';
  if(f.invoiceState==='cancelled')return 'Invoice cancelled'+(f.paymentState==='refunded'?' · Refunded':f.paymentState==='partially_refunded'?' · Partially refunded':'');
  if(f.invoiceState==='scheduled')return 'Invoice scheduled';
  if(f.invoiceState==='draft')return 'Invoice draft';
  return ({due:'Payment due',partial:'Partially paid',paid:'Paid',pending:'Payment pending',refunded:'Refunded',partially_refunded:'Partially refunded',not_started:'Payment not started'}[f.paymentState]||'Payment needs review');
}
export function milestoneMarkup(order){
 if(!order.milestoneSchedule)return '';
 const s=order.milestoneSchedule,summary=order.installmentSummary;
 const amount=n=>n===null||n===undefined?'Needs review':money(n,order.currency);
 return `<div class="milestones"><h3>Approved payment schedule</h3>${s.milestones.map(t=>{
  const m=order.installments?.find(x=>x.localId===t.id),url=safeInvoice(m?.invoiceUrl),f=m?.financialState;
  return `<section><strong>${esc(t.title)} · ${amount(t.amountMinor)}</strong><p>Due on ${t.dueTrigger==='proposal_approval'?'proposal approval':'delivery acceptance'}${s.workStartPaymentMilestoneIds.includes(t.id)?' · Work-start payment prerequisite':''}.</p><ul>${t.acceptanceCriteria.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>${m?`<p>${esc(f?financialLabel(m):'Not invoiced')}${f?.observedAt?' · Checked '+esc(new Date(f.observedAt).toLocaleString()):''}</p>`:''}${url&&(canPay(m)||f?.paymentState==='paid')?`<a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">${f?.paymentState==='paid'?'View receipt for':'Pay'} ${esc(t.title)}</a>`:''}</section>`;
 }).join('')}<p>Work begins after the listed work-start payment prerequisites are confirmed. Delivery acceptance releases only its agreed installment.</p>${summary&&order.approvalStatus==='approved'?`<p>Paid (net): ${amount(summary.netPaidMinor)} · Payable now: ${amount(summary.payableDueMinor)} · Not yet invoiced: ${amount(summary.futureUnbilledMinor)} · Refunded: ${amount(summary.refundedMinor)}</p>`:''}</div>`;
}
export function balanceCaption(order){
 if(order.installments?.some(m=>!m.legacy))return '';
 if(order.amountDueMinor===null||order.amountDueMinor===undefined)return '';
 return ' · '+money(order.amountDueMinor,order.currency)+(order.financialState?.invoiceState==='payable'?' payable now':' retained provider balance');
}
export const financialNotice = order => order.approvalStatus==='approved' ? `<p class="notice">Approval for revision ${esc(order.revision)} is saved. Current financial status: ${esc(financialLabel(order))}.${order.financialState?.paymentState==='review_required'||order.financialState?.paymentState==='unknown'?' Ask your designer to review the existing invoice.':''}</p>` : '';
export const label = value => ({ draft: 'Draft', awaiting_client_approval: 'Awaiting client approval', needs_re_review: 'Designer re-review needed', approved: 'Approved (unpaid)', creating_invoice: 'Preparing invoice', payment_due: 'Payment due', paid: 'Paid', included: 'Already included', new_work: 'New work', needs_clarification: 'Needs clarification', partially_paid: 'Partially paid', payment_pending: 'Payment pending', payment_review_required: 'Payment needs review', submit_for_client_approval: 'Submit for client approval', issue_approved_invoice: 'Issue approved invoice' }[value] || String(value || '').replaceAll('_', ' '));
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

export const scopeVersions = ref => ref?.scopeVersion && ref?.rateVersion ? `Scope v${ref.scopeVersion} · Rates v${ref.rateVersion}` : "Historical scope/rate context unknown";
