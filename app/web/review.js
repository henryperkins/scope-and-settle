import { api, sessionApi, esc, money, when, label, notice, busy, itemRows, safeInvoice, icon, track } from './common.js';
let session, order;
const box = document.getElementById('review');
const persist = value => { session=value; sessionStorage.setItem('scope-client',JSON.stringify(value)); };
const request = sessionApi(() => session, persist, () => { persist(null); box.innerHTML=''; });
const stageOf = o => o.paymentStatus === 'paid' || o.status === 'paid' ? { step: 4, done: true, tone: 'settled' } :
  o.status === 'awaiting_client_approval' ? { step: 3, tone: o.stale ? 'attention' : 'action' } :
  ['approved', 'creating_invoice', 'payment_due'].includes(o.status) || o.paymentStatus ? { step: 4, tone: 'action' } : { step: 2, tone: 'waiting' };
async function refresh(provider = false) {
  order = await request('/api/change-orders/' + session.changeOrderId + (provider ? '/payment-status' : ''));
  const url = safeInvoice(order.invoiceUrl), s = stageOf(order);
  let actions = '';
  if (order.stale) actions += `<p class="notice error">${icon('error')}<span>The brief changed after this proposal was sent. Ask the designer to review it and issue a new link.</span></p>`;
  if (order.status === 'awaiting_client_approval' && !order.stale) actions += `<label class="check consent"><input id="consent" type="checkbox"><span>I approve revision ${order.revision}, its deliverables, ${money(order.totalMinor)} total, and payment-before-work term.</span></label><button id="approve" class="full" disabled>Approve change &amp; prepare invoice</button>`;
  if (order.status === 'approved' || order.status === 'creating_invoice') actions += `<p class="notice">${icon('info')}<span>The change is approved. Your designer can prepare or retry the PayPal invoice.</span></p>`;
  if (url && order.paymentStatus !== 'paid') actions += `<a class="button full" href="${esc(url)}" target="_blank" rel="noreferrer">Pay ${money(order.amountDueMinor ?? order.totalMinor)} in PayPal sandbox${icon('external')}<span class="visually-hidden">(opens in a new tab)</span></a>`;
  if (order.paymentStatus === 'paid') actions += `<p class="notice">${icon('check')}<span><strong>Paid.</strong> Payment has been confirmed from PayPal invoice details.</span></p>`;
  actions += `<div class="stack tight"><button id="refresh" class="secondary full">${icon('refresh')}Refresh payment status</button>${order.lastCheckedAt ? `<p class="meta">Last checked ${esc(when(order.lastCheckedAt))}</p>` : ''}</div>`;
  box.innerHTML = `<div class="review-head"><div class="review-title"><div class="stack tight"><h2>${esc(order.title)}</h2><p class="meta">Proposal revision ${order.revision} · ${esc(order.scopeRevisionId)}</p></div><span class="status" data-tone="${s.tone}">${esc(label(order.paymentStatus || order.status))}</span></div>${track(s.step, { done: s.done, tone: s.tone === 'attention' ? 'attention' : '' })}</div>
  <div class="review-body"><section class="card stack" aria-labelledby="deliver-title"><h3 id="deliver-title">What will be delivered</h3><ul class="deliverables">${order.deliverables.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${itemRows(order.lineItems,order.currency)}
  <details><summary>Agreed brief (provided by designer)</summary><div class="stack tight">${(order.scopeSnapshot?.scopeClauses??[]).map(c=>`<figure class="evidence"><blockquote>${esc(c.text)}</blockquote></figure>`).join('')}<p class="meta">Original agreement supplied by the designer. Approval on this page applies to this change order.</p></div></details></section>
  <aside class="decision" aria-label="Approval and payment"><div class="total-row"><span class="label">Total</span><span class="amount">${money(order.totalMinor,order.currency)}</span></div><p class="notice">${icon('info')}<span><strong>Work begins after payment.</strong> Approval confirms these deliverables and this price. Payment is a separate step.</span></p>${actions}</aside></div>`;
  const consent = document.getElementById('consent');
  if (consent) consent.onchange = () => document.getElementById('approve').disabled = !consent.checked;
  const approve = document.getElementById('approve');
  if (approve) approve.onclick = () => busy(approve, async()=> { const result=await request('/api/change-orders/'+order.id+'/approve','POST'); notice(result.invoiceError || 'Approval recorded.', !!result.invoiceError); await refresh(); });
  document.getElementById('refresh').onclick = e => busy(e.currentTarget, ()=>refresh(true));
}
async function start() {
  const invite = location.hash.slice(1);
  if(invite) {
    history.replaceState(null,'',location.pathname);
    persist(invite.startsWith('resume=') ? await api('/api/session/renew',null,'POST',{credential:invite.slice(7)}) :
      await api('/api/session/redeem',null,'POST',{invitation:invite}));
  } else session = JSON.parse(sessionStorage.getItem('scope-client') || 'null');
  if (!session || session.role !== 'client') throw new Error('Open the client review link supplied by your designer.');
  await refresh();
}
start().catch(error=> { box.innerHTML=`<p class="notice error">${icon('error')}<span>${esc(error.message)}</span></p>`; });
