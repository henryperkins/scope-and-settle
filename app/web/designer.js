import { api, sessionApi, esc, money, label, notice, busy, itemRows, safeInvoice } from './common.js';
import { proposalDefaults } from './proposal.js';
import { isFigmaPluginMessage } from './figma-bridge.js';
import { mountAgent } from './agent.js';
const $ = id => document.getElementById(id);
const inPlugin = window.parent !== window;
let session, project, comments = [], selected, assessment, editing, imageDataUrl, fileKey, designContext = '', selectionContext = '', preservedItems = [];
let agentUI,reviewingRequest=null;
const post = message => { if (inPlugin) parent.postMessage({ pluginMessage: message }, '*'); };
function saveSession(value) {
  session = value;
  if (inPlugin) post({ type: 'save-session', session: value });
  else {
    sessionStorage.setItem('scope-designer', JSON.stringify(value));
    if (value?.renewalCredential) localStorage.setItem('scope-judge', JSON.stringify(value));
  }
}
const request = sessionApi(() => session, saveSession, () => {
  agentUI?.destroy();
  saveSession(null); $('workspace').hidden = true; $('connect').hidden = false;
  $('orders').innerHTML = ''; $('assessment').innerHTML = ''; $('share').hidden = true;
});
async function connect(invitation) {
  const token = invitation.includes('#') ? invitation.split('#').pop() : invitation;
  const value = token.startsWith('resume=') ? await api('/api/session/renew', null, 'POST', { credential: token.slice(7) }) :
    await api('/api/session/redeem', null, 'POST', { invitation: token });
  if (value.role !== 'designer') throw new Error('Open a designer invitation here. Client links belong on the review page.');
  saveSession(value); $('invitation').value = ''; await load();
}
async function load() {
  try {
    await request('/api/session');
    project = await request('/api/project');
    $('connect').hidden = true; $('workspace').hidden = false;
    $('brief').innerHTML = project.scopeClauses.map(c => `<blockquote>${esc(c.text)}<br><small>${esc(c.id)}</small></blockquote>`).join('') + `<small>${esc(project.scopeRevisionId)}</small>`;
    $('price-mode').innerHTML = project.rateCard.map(r => `<option value="${esc(r.id)}">${esc(r.description)} · ${money(r.unitAmountMinor)}</option>`).join('') + '<option value="custom">Designer-set price</option>';
    await Promise.all([loadComments().catch(()=>{$('comments').innerHTML='<p class="notice">Figma comments are unavailable. Portal requests still work; check Figma permissions or try Refresh later.</p>';comments=[];}), loadOrders()]);
    agentUI?.destroy();
    agentUI=mountAgent({request,project,comments,onReview:async r=>{
      reviewingRequest=r.id;selected=r.source==='figma'?r.source_id:null;assessment=null;
      if(r.assessment_id){try{const a=await request('/api/assessments/'+r.assessment_id);if(a.result.classification==='new_work')assessment=a;}catch{}}
      let order=null;if(r.order_id){const o=await request('/api/change-orders/'+r.order_id);if(['draft','awaiting_client_approval','needs_re_review'].includes(o.status))order=o;}
      $('manual-workflow').open=true;showProposal(order);
      if(!order&&!assessment){$('title').value='Reviewed client request';$('deliverables').value=r.text;}
      notice('Review this exception and confirm its exact terms. Your confirmed quote will appear in the existing client portal.');
    }});await agentUI.refresh().catch(()=>notice('Agent status is unavailable. The existing proposal and payment controls remain available.',true));
    if (session.renewalCredential) { $('resume-access').hidden = false; $('designer-resume').value = 'resume=' + session.renewalCredential; }
    checkFile();
    const budget = await request('/api/ai-budget'); $('budget').textContent = `AI budget available: $${(budget.remainingMicroUsd/1e6).toFixed(2)} of $${(budget.capMicroUsd/1e6).toFixed(2)} (conservative accounting).`;
  } catch (error) { notice(error.message, true); $('connect').hidden = false; $('workspace').hidden = true; }
}
function checkFile() {
  if (!inPlugin || !project) return;
  const matches = fileKey === project.figmaFileKey;
  $('attach-frame').disabled = !matches;
  $('figma-context').textContent = matches ? 'Connected to the designated Figma file.' : 'Open the designated judging file to attach a frame. The brief and comments below belong to that file.';
  if (!matches) { imageDataUrl = undefined; designContext = ''; $('frame').hidden = true; $('remove-frame').hidden = true; }
}
async function loadComments() {
  const result = await request('/api/comments'); comments = result.comments;
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
  $('manual-workflow').open=true;
  editing = order?.id ?? null;
  const draft = proposalDefaults(order, assessment, project);
  $('title').value = draft.title; $('deliverables').value = draft.deliverables.join('\n');
  preservedItems = draft.preservedItems;
  $('price-mode').value = draft.priceMode;
  $('quantity').value = draft.quantity; $('amount').value = draft.amount;
  $('proposal').hidden = false; pricing(); $('proposal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadOrders() {
  const orders = await request('/api/change-orders');
  $('orders').innerHTML = orders.map(o => {
    const url = safeInvoice(o.invoiceUrl);
    return `<article class="card"><div class="row between"><h3>${esc(o.title)}</h3><span class="badge ${o.stale?'warn':''}">${esc(label(o.paymentStatus || o.status))}</span></div><small>Revision ${o.revision}${o.scopeRevisionId?' · '+esc(o.scopeRevisionId):''}</small>${o.stale?'<div class="notice">The brief changed. Review this proposal and issue a new link.</div>':''}${itemRows(o.lineItems,o.currency)}<p><strong>${money(o.totalMinor,o.currency)}</strong>${o.amountDueMinor!==null?' · '+money(o.amountDueMinor)+' due':''}</p><div class="row">${['draft','needs_re_review','awaiting_client_approval'].includes(o.status)?`<button class="secondary" data-edit="${esc(o.id)}">Review terms</button>`:''}${session.grantId&&o.scopeRevisionId&&!o.stale?`<button class="secondary" data-client="${esc(o.id)}">Client review link</button>`:''}${['approved','creating_invoice'].includes(o.status)?`<button data-invoice="${esc(o.id)}">Prepare PayPal invoice</button>`:''}${url?`<a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">PayPal invoice</a>`:''}${o.paypalInvoiceId?`<button class="secondary" data-check="${esc(o.id)}">Check payment</button>`:''}</div>${o.lastCheckedAt?`<small>Checked ${esc(new Date(o.lastCheckedAt).toLocaleString())}</small>`:''}</article>`;
  }).join('') || '<p class="muted">Your approved changes and payment status will appear here.</p>';
  $('orders').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { assessment = null; showProposal(orders.find(o=>o.id===b.dataset.edit)); });
  $('orders').querySelectorAll('[data-client]').forEach(b => b.onclick = () => busy(b, async()=> {
    const link = await request('/api/change-orders/'+b.dataset.client+'/client-access','POST');
    $('approval-link').value = link.approvalUrl; $('open-review').href = link.approvalUrl; $('share').hidden = false;
    $('share-expiry').textContent = 'Access ends '+new Date(link.approvalExpiresAt).toLocaleString()+'. Editing or resetting invalidates it.';
    $('share').scrollIntoView({block:'start'});
  }));
  for (const [attribute,suffix,method] of [['invoice','invoice','POST'],['check','payment-status','GET']]) {
    $('orders').querySelectorAll('[data-'+attribute+']').forEach(b => b.onclick = () => busy(b, async()=> { await request('/api/change-orders/'+b.dataset[attribute]+'/'+suffix,method); await loadOrders(); }));
  }
}
$('connect-button').onclick = e => busy(e.currentTarget, () => connect($('invitation').value.trim()));
$('refresh-comments').onclick = e => busy(e.currentTarget, loadComments);
$('refresh-orders').onclick = e => busy(e.currentTarget, loadOrders);
$('assess').onclick = e => busy(e.currentTarget, async () => {
  notice('Reading the request against the agreed brief…');
  assessment = await request('/api/assessments', 'POST', { commentId: selected, clarification: $('clarification').value, designContext, imageDataUrl, figmaFileKey: fileKey });
  const r = assessment.result;
  $('assessment').innerHTML = `<hr><span class="badge">${esc(label(r.classification))}</span><p>${esc(r.explanation)}</p>${r.evidence.map(x=>`<blockquote>${esc(x.quote)}<br><small>${esc(x.clauseId)}</small></blockquote>`).join('')}${r.designObservations.map(x=>`<p class="muted">${esc(x)}</p>`).join('')}${r.questions.length?`<label for="question">Clarification to post manually in Figma</label><textarea id="question" readonly>${esc(r.questions.join('\n'))}</textarea>`:''}<small>${(assessment.latencyMs/1000).toFixed(1)} seconds · ${esc(assessment.model)}</small>`;
  notice(r.classification==='new_work'?'Review the proposed deliverables and price below.':r.classification==='included'?'This request is covered by the provided brief.':'Post the clarification question, then paste or select the reply and reassess.');
  if (r.classification === 'new_work') showProposal();
});
for (const id of ['price-mode','quantity','amount']) $(id).oninput = pricing;
$('submit-proposal').onclick = e => busy(e.currentTarget, async () => {
  const body = { title:$('title').value, deliverables:$('deliverables').value.split('\n').map(x=>x.trim()).filter(Boolean), lineItems:pricing(), currency:'USD', commentId:selected || null, assessmentId:assessment?.id };
  const order = editing ? await request('/api/change-orders/'+editing, 'PATCH', body) : await request('/api/change-orders', 'POST', body);
  const submitted = await request('/api/change-orders/'+order.id+'/submit', 'POST');
  if(reviewingRequest){await request('/api/agent/requests/'+reviewingRequest+'/publish','POST',{orderId:submitted.order.id,revision:submitted.order.revision,consent:true});reviewingRequest=null;await agentUI.refresh();}
  $('approval-link').value = submitted.approvalUrl; $('open-review').href = submitted.approvalUrl;
  $('share-expiry').textContent = 'Access ends '+new Date(submitted.approvalExpiresAt).toLocaleString()+'. Editing or resetting invalidates it.';
  $('share').hidden = false; $('proposal').hidden = true; editing = null; assessment = null;
  await loadOrders(); notice('The exact terms are ready for client review.');
});
$('copy-link').onclick = e => busy(e.currentTarget, async()=> { try { await navigator.clipboard.writeText($('approval-link').value); notice('Review link copied.'); } catch { $('approval-link').select(); notice('Select and copy the review link above.'); } });
$('manual').onclick = () => { assessment = null; reviewingRequest=null; showProposal(); };
$('reset').onclick = e => busy(e.currentTarget, async()=> {
  if (!confirm('Start a fresh demo run? Local evidence and orders in this run will be cleared. PayPal sandbox invoices remain.')) return;
  const result = await request('/api/demo/reset', 'POST'); saveSession(result.session);
  reviewingRequest=null;agentUI?.destroy();
  assessment = null; selected = null; editing = null; imageDataUrl = undefined; designContext = ''; selectionContext = ''; preservedItems = [];
  $('share').hidden = true; $('proposal').hidden = true; $('assessment').innerHTML = ''; $('frame').hidden = true; $('remove-frame').hidden = true;
  $('clarification').value = ''; $('assess').disabled = true; await load(); notice('Fresh demo ready.');
});
$('attach-frame').onclick = () => post({ type:'export-frame', expectedFileKey: project?.figmaFileKey });
$('remove-frame').onclick = () => { imageDataUrl = undefined; designContext = selectionContext; $('frame').hidden = true; $('remove-frame').hidden = true; };
window.addEventListener('message', async event => {
  if (!isFigmaPluginMessage(event)) return;
  const m = event.data?.pluginMessage; if (!m) return;
  if (m.type === 'session' && m.session) { session=m.session; await load(); }
  if (m.type === 'context' || m.type === 'selection') { fileKey=m.fileKey; selectionContext=JSON.stringify(m.selection); if(!imageDataUrl) designContext=selectionContext; checkFile(); }
  if (m.type === 'frame') {
    if (!project || m.fileKey !== project.figmaFileKey) { notice('That frame is from a different file. Open the designated judging file.',true); return; }
    fileKey=m.fileKey; imageDataUrl=m.dataUrl; designContext=JSON.stringify(m.context); $('frame').src=imageDataUrl; $('frame').hidden=false; $('remove-frame').hidden=false; notice('Selected frame attached as supporting design evidence.');
  }
  if (m.type === 'error') notice(m.message,true);
});
if (inPlugin) { $('attach-frame').hidden=false; post({type:'get-session'}); post({type:'get-context'}); }
else {
  const invite=location.hash.slice(1); if(invite) { history.replaceState(null,'',location.pathname); connect(invite).catch(e=>notice(e.message,true)); }
  else { try { session=JSON.parse(sessionStorage.getItem('scope-designer')); if(session) load(); } catch {} }
}
