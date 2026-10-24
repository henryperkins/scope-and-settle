import { api, sessionApi, esc, money, label, notice, busy, itemRows, safeInvoice, canPay, financialLabel, financialNotice, scopeVersions, milestoneMarkup } from './common.js';
let session, order;
const box = document.getElementById('review');
const persist = value => { session=value; sessionStorage.setItem('scope-client',JSON.stringify(value)); };
const request = sessionApi(() => session, persist, () => { persist(null); box.innerHTML=''; });
async function refresh(provider = false) {
  order = await request('/api/change-orders/' + session.changeOrderId + (provider ? '/payment-status' : ''));
  const url = safeInvoice(order.invoiceUrl);
  box.innerHTML = `<section><div class="row between"><h2>${esc(order.title)}</h2><span class="badge">${esc(financialLabel(order))}</span></div>${financialNotice(order)}<small>Proposal revision ${order.revision} · ${esc(order.scopeRevisionId)} · ${esc(scopeVersions(order.scopeContext))}</small><h3 style="margin-top:20px">What will be delivered</h3><ul>${order.deliverables.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${itemRows(order.lineItems,order.currency)}<div class="row between" style="margin-top:16px"><strong>Total</strong><span class="total">${money(order.totalMinor,order.currency)}</span></div>${milestoneMarkup(order)}<div class="notice"><strong>Work begins after the approved payment prerequisites.</strong><br>Approval confirms these deliverables and this price. Payment is a separate step.</div>${order.stale?'<div class="notice error">The brief changed after this proposal was sent. Ask the designer to review it and issue a new link.</div>':''}${order.status==='awaiting_client_approval'&&!order.stale?`<label><input id="consent" type="checkbox"> I approve revision ${order.revision}, its deliverables, ${money(order.totalMinor)} total, and the payment schedule and work-start prerequisites shown above.</label><button id="approve" class="full" disabled style="margin-top:14px">Approve change &amp; prepare invoice</button>`:''}${order.status==='approved'||order.status==='creating_invoice'?'<p>The change is approved. Your designer can prepare or retry the PayPal invoice.</p>':''}${canPay(order)?`<a class="button full" href="${esc(url)}" target="_blank" rel="noreferrer">Pay ${money(order.amountDueMinor ?? order.totalMinor)} in PayPal sandbox</a>`:''}${order.financialState?.paymentState==='paid'?'<div class="notice"><strong>Paid.</strong> Payment has been confirmed from PayPal invoice details.</div>':''}<button id="refresh" class="secondary" style="margin-top:12px">Refresh payment status</button>${order.lastCheckedAt?`<p><small>Last checked ${esc(new Date(order.lastCheckedAt).toLocaleString())}</small></p>`:''}</section><details><summary>Agreed brief (provided by designer)</summary>${(order.scopeSnapshot?.scopeClauses??[]).map(c=>`<blockquote>${esc(c.text)}</blockquote>`).join('')}<small>Original agreement supplied by the designer. Approval on this page applies to this change order.</small></details>`;
  const consent = document.getElementById('consent');
  if (consent) consent.onchange = () => document.getElementById('approve').disabled = !consent.checked;
  const approve = document.getElementById('approve');
  if (approve) approve.onclick = () => busy(approve, async()=> { const result=await request('/api/change-orders/'+order.id+'/approve','POST'); notice(result.invoiceError || 'Approval recorded.'); await refresh(); });
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
start().catch(error=> { box.innerHTML=''; notice(error.message,true); });
