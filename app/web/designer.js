import { api, esc, money, label, notice, busy, itemRows, safeInvoice } from './common.js';
import { proposalDefaults } from './proposal.js';
const $ = id => document.getElementById(id);
const inPlugin = window.parent !== window;
let session, project, comments = [], selected, assessment, editing, imageDataUrl, designContext = '', selectionContext = '', preservedItems = [];
const post = message => { if (inPlugin) parent.postMessage({ pluginMessage: message }, '*'); };
function saveSession(value) {
  session = value;
  if (inPlugin) post({ type: 'save-session', session: value });
  else sessionStorage.setItem('scope-designer', JSON.stringify(value));
}
async function connect(invitation) {
  const token = invitation.includes('#') ? invitation.split('#').pop() : invitation;
  const value = await api('/api/session/redeem', null, 'POST', { invitation: token });
  if (value.role !== 'designer') throw new Error('Open a designer invitation here. Client links belong on the review page.');
  saveSession(value); $('invitation').value = ''; await load();
}
async function load() {
  try {
    await api('/api/session', session.token);
    project = await api('/api/project', session.token);
    $('connect').hidden = true; $('workspace').hidden = false;
    $('brief').innerHTML = project.scopeClauses.map(c => `<blockquote>${esc(c.text)}<br><small>${esc(c.id)}</small></blockquote>`).join('') + `<small>${esc(project.scopeRevisionId)}</small>`;
    $('price-mode').innerHTML = project.rateCard.map(r => `<option value="${esc(r.id)}">${esc(r.description)} · ${money(r.unitAmountMinor)}</option>`).join('') + '<option value="custom">Designer-set price</option>';
    await Promise.all([loadComments(), loadOrders()]);
    const budget = await api('/api/ai-budget', session.token); $('budget').textContent = `AI budget available: $${(budget.remainingMicroUsd/1e6).toFixed(2)} of $${(budget.capMicroUsd/1e6).toFixed(2)} (conservative accounting).`;
  } catch (error) { notice(error.message, true); $('connect').hidden = false; }
}
async function loadComments() {
  const result = await api('/api/comments', session.token); comments = result.comments;
  $('comments').innerHTML = comments.filter(c => !c.parentId).map(c => `<button class="comment ${c.id===selected?'selected':''}" data-comment="${esc(c.id)}"><strong>${esc(c.message)}</strong><small>${esc(c.userHandle || 'Comment author')} · ${comments.filter(r=>r.parentId===c.id).length} replies</small></button>`).join('') || '<div class="empty">No comments yet. In the demo Figma file, add “Can you add the mobile checkout?”, then refresh.</div>';
  $('comments').querySelectorAll('[data-comment]').forEach(button => button.onclick = () => {
    selected = button.dataset.comment; assessment = null; $('assessment').innerHTML = ''; $('proposal').hidden = true;
    $('comments').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b===button)); $('assess').disabled = false;
  });
}
function pricing() {
  const rate = project.rateCard.find(r => r.id === $('price-mode').value);
  const amount = rate ? rate.unitAmountMinor : Math.round(Number($('amount').value) * 100);
  const quantity = Number($('quantity').value);
  $('custom-price').hidden = !!rate;
  const valid = Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100;
  $('submit-proposal').disabled = !valid;
  $('proposal-total').textContent = !valid ? 'Enter a valid designer-set price and quantity before sending this proposal.' : `${money(amount*quantity + preservedItems.reduce((s,x)=>s+x.unitAmountMinor*x.quantity,0))} · ${rate?'Rate-card price':'Designer-set price'}${preservedItems.length?' · Additional existing line items preserved':''}`;
  return [{ rateCardId: rate?.id ?? null, priceSource: rate ? 'rate_card' : 'designer', description: rate?.description ?? $('title').value, quantity, unitAmountMinor: amount }, ...preservedItems];
}
function showProposal(order) {
  editing = order?.id ?? null;
  const draft = proposalDefaults(order, assessment, project);
  $('title').value = draft.title; $('deliverables').value = draft.deliverables.join('\n');
  preservedItems = draft.preservedItems;
  $('price-mode').value = draft.priceMode;
  $('quantity').value = draft.quantity; $('amount').value = draft.amount;
  $('proposal').hidden = false; pricing(); $('proposal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadOrders() {
  const orders = await api('/api/change-orders', session.token);
  $('orders').innerHTML = orders.map(o => {
    const url = safeInvoice(o.invoiceUrl);
    return `<article class="card"><div class="row between"><h3>${esc(o.title)}</h3><span class="badge ${o.stale?'warn':''}">${esc(label(o.paymentStatus || o.status))}</span></div><small>Revision ${o.revision}${o.scopeRevisionId?' · '+esc(o.scopeRevisionId):''}</small>${o.stale?'<div class="notice">The brief changed. Review this proposal and issue a new link.</div>':''}${itemRows(o.lineItems,o.currency)}<p><strong>${money(o.totalMinor,o.currency)}</strong>${o.amountDueMinor!==null?' · '+money(o.amountDueMinor)+' due':''}</p><div class="row">${['draft','needs_re_review','awaiting_client_approval'].includes(o.status)?`<button class="secondary" data-edit="${esc(o.id)}">Review terms</button>`:''}${['approved','creating_invoice'].includes(o.status)?`<button data-invoice="${esc(o.id)}">Prepare PayPal invoice</button>`:''}${url?`<a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">PayPal invoice</a>`:''}${o.paypalInvoiceId?`<button class="secondary" data-check="${esc(o.id)}">Check payment</button>`:''}</div>${o.lastCheckedAt?`<small>Checked ${esc(new Date(o.lastCheckedAt).toLocaleString())}</small>`:''}</article>`;
  }).join('') || '<p class="muted">Your approved changes and payment status will appear here.</p>';
  $('orders').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { assessment = null; showProposal(orders.find(o=>o.id===b.dataset.edit)); });
  for (const [attribute,suffix,method] of [['invoice','invoice','POST'],['check','payment-status','GET']]) {
    $('orders').querySelectorAll('[data-'+attribute+']').forEach(b => b.onclick = () => busy(b, async()=> { await api('/api/change-orders/'+b.dataset[attribute]+'/'+suffix,session.token,method); await loadOrders(); }));
  }
}
$('connect-button').onclick = e => busy(e.currentTarget, () => connect($('invitation').value.trim()));
$('refresh-comments').onclick = e => busy(e.currentTarget, loadComments);
$('refresh-orders').onclick = e => busy(e.currentTarget, loadOrders);
$('assess').onclick = e => busy(e.currentTarget, async () => {
  notice('Reading the request against the agreed brief…');
  assessment = await api('/api/assessments', session.token, 'POST', { commentId: selected, clarification: $('clarification').value, designContext, imageDataUrl });
  const r = assessment.result;
  $('assessment').innerHTML = `<hr><span class="badge">${esc(label(r.classification))}</span><p>${esc(r.explanation)}</p>${r.evidence.map(x=>`<blockquote>${esc(x.quote)}<br><small>${esc(x.clauseId)}</small></blockquote>`).join('')}${r.designObservations.map(x=>`<p class="muted">${esc(x)}</p>`).join('')}${r.questions.length?`<label for="question">Clarification to post manually in Figma</label><textarea id="question" readonly>${esc(r.questions.join('\n'))}</textarea>`:''}<small>${(assessment.latencyMs/1000).toFixed(1)} seconds · ${esc(assessment.model)}</small>`;
  notice(r.classification==='new_work'?'Review the proposed deliverables and price below.':r.classification==='included'?'This request is covered by the provided brief.':'Post the clarification question, then paste or select the reply and reassess.');
  if (r.classification === 'new_work') showProposal();
});
for (const id of ['price-mode','quantity','amount']) $(id).oninput = pricing;
$('submit-proposal').onclick = e => busy(e.currentTarget, async () => {
  const body = { title:$('title').value, deliverables:$('deliverables').value.split('\n').map(x=>x.trim()).filter(Boolean), lineItems:pricing(), currency:'USD', commentId:selected || null, assessmentId:assessment?.id };
  const order = editing ? await api('/api/change-orders/'+editing, session.token, 'PATCH', body) : await api('/api/change-orders', session.token, 'POST', body);
  const submitted = await api('/api/change-orders/'+order.id+'/submit', session.token, 'POST');
  $('approval-link').value = submitted.approvalUrl; $('open-review').href = submitted.approvalUrl;
  $('share').hidden = false; $('proposal').hidden = true; editing = null; assessment = null;
  await loadOrders(); notice('The exact terms are ready for client review.');
});
$('copy-link').onclick = e => busy(e.currentTarget, async()=> { try { await navigator.clipboard.writeText($('approval-link').value); notice('Review link copied.'); } catch { $('approval-link').select(); notice('Select and copy the review link above.'); } });
$('manual').onclick = () => { assessment = null; showProposal(); };
$('reset').onclick = e => busy(e.currentTarget, async()=> {
  if (!confirm('Start a fresh demo run? Local evidence and orders in this run will be cleared. PayPal sandbox invoices remain.')) return;
  const result = await api('/api/demo/reset', session.token, 'POST'); saveSession(result.session);
  assessment = null; selected = null; editing = null; $('share').hidden = true; $('proposal').hidden = true; $('assessment').innerHTML = ''; await load(); notice('Fresh demo ready.');
});
$('attach-frame').onclick = () => post({ type:'export-frame' });
$('remove-frame').onclick = () => { imageDataUrl = undefined; designContext = selectionContext; $('frame').hidden = true; $('remove-frame').hidden = true; };
window.addEventListener('message', async event => {
  const m = event.data?.pluginMessage; if (!m) return;
  if (m.type === 'session' && m.session) { session=m.session; await load(); }
  if (m.type === 'context' || m.type === 'selection') { selectionContext=JSON.stringify(m.selection); if(!imageDataUrl) designContext=selectionContext; $('figma-context').textContent=(m.selection?.length ?? 0)+' selected in Figma'; }
  if (m.type === 'frame') { imageDataUrl=m.dataUrl; designContext=JSON.stringify(m.context); $('frame').src=imageDataUrl; $('frame').hidden=false; $('remove-frame').hidden=false; notice('Selected frame attached as supporting design evidence.'); }
  if (m.type === 'error') notice(m.message,true);
});
if (inPlugin) { $('attach-frame').hidden=false; post({type:'get-session'}); post({type:'get-context'}); }
else {
  const invite=location.hash.slice(1); if(invite) { history.replaceState(null,'',location.pathname); connect(invite).catch(e=>notice(e.message,true)); }
  else { try { session=JSON.parse(sessionStorage.getItem('scope-designer')); if(session) load(); } catch {} }
}
