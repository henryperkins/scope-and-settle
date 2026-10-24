import { api, sessionApi, esc, money, when, label, notice, busy, itemRows, safeInvoice, icon } from './common.js';
import { proposalDefaults } from './proposal.js';
import { isFigmaPluginMessage } from './figma-bridge.js';
import { mountAgent } from './agent.js';
const $ = id => document.getElementById(id);
const inPlugin = window.parent !== window;
let session, project, comments = [], selected, assessment, editing, imageDataUrl, fileKey, designContext = '', selectionContext = '', preservedItems = [];
let agentUI,reviewingRequest=null,orders=[],agentView=null,boardMarkup='';
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
  $('orders').innerHTML = ''; boardMarkup = ''; $('assessment').innerHTML = ''; $('share').hidden = true;
});
async function connect(invitation) {
  const token = invitation.includes('#') ? invitation.split('#').pop() : invitation;
  const value = token.startsWith('resume=') ? await api('/api/session/renew', null, 'POST', { credential: token.slice(7) }) :
    await api('/api/session/redeem', null, 'POST', { invitation: token });
  if (value.role !== 'designer') throw new Error('Open a designer invitation here. Client links belong on the review page.');
  saveSession(value); $('invitation').value = ''; await load();
}
// Toolbar buttons open one tool panel at a time; the panels share one details name.
const tools = [['tool-settings','agent-settings'],['tool-assess','manual-workflow'],['tool-brief','brief-details'],['tool-demo','demo-controls']];
function syncTools() { for (const [button, panel] of tools) $(button).setAttribute?.('aria-expanded', String(!!$(panel)?.open)); }
for (const [button, panel] of tools) $(button).onclick = () => { const el = $(panel); if (!el) return; el.open = !el.open; syncTools(); if (el.open) el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); };
for (const [, panel] of tools.slice(1)) $(panel).ontoggle = syncTools;
async function reviewException(r) {
  reviewingRequest=r.id;selected=r.source==='figma'?r.source_id:null;assessment=null;
  if(r.assessment_id){try{const a=await request('/api/assessments/'+r.assessment_id);if(a.result.classification==='new_work')assessment=a;}catch{}}
  let order=null;if(r.order_id){const o=await request('/api/change-orders/'+r.order_id);if(['draft','awaiting_client_approval','needs_re_review'].includes(o.status))order=o;else{reviewingRequest=null;notice('This request already has an approved or invoiced quote. Ask the client to send new work as a separate portal request so the existing invoice stays attached.',true);$('orders').scrollIntoView({block:'start'});return;}}
  $('manual-workflow').open=true;showProposal(order);
  if(!order&&!assessment){$('title').value='Reviewed client request';$('deliverables').value=r.text;$('price-mode').value='custom';$('amount').value='';pricing();}
  notice('Review this exception and confirm its exact terms. Your confirmed quote will appear in the existing client portal.');
}
async function load() {
  try {
    await request('/api/session');
    project = await request('/api/project');
    $('connect').hidden = true; $('workspace').hidden = false;
    $('brief').innerHTML = project.scopeClauses.map(c => `<figure class="evidence"><blockquote>${esc(c.text)}</blockquote><figcaption>Clause ${esc(c.id)}</figcaption></figure>`).join('') + `<p class="meta">${esc(project.scopeRevisionId)}</p>`;
    $('price-mode').innerHTML = project.rateCard.map(r => `<option value="${esc(r.id)}">${esc(r.description)} · ${money(r.unitAmountMinor)}</option>`).join('') + '<option value="custom">Designer-set price</option>';
    await Promise.all([loadComments().catch(()=>{$('comments').innerHTML=`<p class="notice attention">${icon('alert')}<span>Figma comments are unavailable. Portal requests still work; check Figma permissions or try Refresh later.</span></p>`;comments=[];}), loadOrders()]);
    agentUI?.destroy();
    agentUI=mountAgent({request,project,comments,onReview:reviewException,onView:view=>{agentView=view;renderBoard();}});
    $('agent-settings').ontoggle=syncTools;syncTools();
    await agentUI.refresh().catch(()=>notice('Agent status is unavailable. The existing proposal and payment controls remain available.',true));
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
  if (!matches) { imageDataUrl = undefined; designContext = ''; $('frame').hidden = true; $('frame').innerHTML = ''; $('remove-frame').hidden = true; }
}
async function loadComments() {
  const result = await request('/api/comments'); comments = result.comments;
  $('comments').innerHTML = comments.filter(c => !c.parentId).map(c => `<button class="comment ${c.id===selected?'selected':''}" data-comment="${esc(c.id)}" aria-pressed="${c.id===selected}"><strong>${esc(c.message)}</strong><small>${esc(c.userHandle || 'Comment author')} · ${comments.filter(r=>r.parentId===c.id).length} replies</small></button>`).join('') || '<div class="empty"><strong>No comments yet</strong><span>In the demo Figma file, add “Can you add the mobile checkout?”, then refresh.</span></div>';
  $('comments').querySelectorAll('[data-comment]').forEach(button => button.onclick = () => {
    reviewingRequest=null;
    selected = button.dataset.comment; assessment = null; $('assessment').innerHTML = ''; $('proposal').hidden = true;
    $('comments').querySelectorAll('button').forEach(b => { b.classList.toggle('selected', b===button); b.setAttribute?.('aria-pressed', String(b===button)); }); $('assess').disabled = false;
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
// The stage board: every request and order sits under the station it has reached on the settlement line.
const stations = [['request','Request','New requests while the agent assesses them, and requests closed without a quote.'],['quote','Quote','Exceptions, client questions and draft terms.'],['approval','Approval','Quotes waiting for the client’s explicit approval.'],['payment','Payment','Approved changes, invoices and payments.']];
const toneRank = { attention: 0, action: 1, working: 2, waiting: 3, quiet: 4, settled: 5 };
const requestLabel = value => ({queued:'Queued',processing:'Assessing',quoted:'Quote delivered',needs_clarification:'Waiting for client',included:'Included work',exception:'Needs your review',paid:'Paid',dismissed:'Handled directly'}[value] || label(value));
const requestTone = r => r.exception || r.delivery_exception ? 'attention' : ({queued:'working',processing:'working',included:'quiet',dismissed:'quiet',paid:'settled'}[r.state] || 'waiting');
const requestStation = r => r.exception || r.delivery_exception || ['needs_clarification','exception'].includes(r.state) ? 'quote' : r.state === 'quoted' ? 'approval' : r.state === 'paid' ? 'payment' : 'request';
const orderTone = o => o.paymentStatus === 'paid' || o.status === 'paid' ? 'settled' : o.stale || o.status === 'needs_re_review' || ['payment_review_required','partially_paid'].includes(o.paymentStatus) ? 'attention' : ['draft','approved','creating_invoice'].includes(o.status) ? 'action' : 'waiting';
const orderStation = o => ['draft','needs_re_review'].includes(o.status) || o.stale ? 'quote' : o.status === 'awaiting_client_approval' ? 'approval' : 'payment';
// The card's heading is the request text, so the conversation skips a first message that only repeats it.
const thread = r => { const said = r.messages.filter((m,i)=>!(i===0&&m.actor==='client'&&m.body.trim()===r.text.trim()));
  return said.length ? `<details><summary>Request conversation</summary><div class="thread">${said.map(m=>`<div class="msg${m.actor==='designer'?' from-you':''}"><p class="who">${m.actor==='client'?'Client':m.actor==='designer'?'You':'Scope &amp; Settle'}</p><p>${esc(m.body)}</p></div>`).join('')}</div></details>` : ''; };
function requestCard(r) {
  const tone = requestTone(r), problem = r.exception || r.delivery_exception, last = [...r.messages].reverse().find(m => m.actor !== 'client');
  const actions = (r.state === 'exception' ? `<button data-agent-review="${esc(r.id)}">Review exception</button>` : '') +
    (r.delivery_exception ? `<button class="secondary" data-agent-action="acknowledge" data-id="${esc(r.id)}">I have checked delivery</button>` : '') +
    (r.state === 'exception' && !r.order_id ? `<button class="secondary" data-agent-action="retry" data-id="${esc(r.id)}">Retry within policy</button>` : '') +
    (problem ? `<button class="quiet" data-agent-action="dismiss" data-id="${esc(r.id)}">I'll handle this directly</button>` : '');
  return `<article class="job" data-tone="${tone}"><div class="job-head"><span class="status" data-tone="${tone}">${esc(problem && r.state !== 'exception' ? 'Delivery needs a check' : requestLabel(r.state))}</span><h4>${esc(r.text)}</h4></div>
  ${problem ? `<p class="reason">${esc(r.exception || r.delivery_exception)}</p>${r.exception && r.delivery_exception ? `<p class="reason">${esc(r.delivery_exception)}</p>` : ''}` : last ? `<p class="meta">${esc(last.body)}</p>` : ''}
  ${r.quoted_minor ? `<p class="meta num">${money(r.quoted_minor)} committed · Quote revision ${r.quote_revision}</p>` : ''}${thread(r)}${actions ? `<div class="job-actions">${actions}</div>` : ''}</article>`;
}
function orderCard(o, r) {
  const url = safeInvoice(o.invoiceUrl), tone = orderTone(o);
  const actions = (['draft','needs_re_review','awaiting_client_approval'].includes(o.status) ? `<button class="secondary" data-edit="${esc(o.id)}">Review terms</button>` : '') +
    (session.grantId && o.scopeRevisionId && !o.stale ? `<button class="secondary" data-client="${esc(o.id)}">Client review link</button>` : '') +
    (['approved','creating_invoice'].includes(o.status) ? `<button data-invoice="${esc(o.id)}">Prepare PayPal invoice</button>` : '') +
    (url ? `<a class="button secondary" href="${esc(url)}" target="_blank" rel="noreferrer">PayPal invoice${icon('external')}</a>` : '') +
    (o.paypalInvoiceId ? `<button class="secondary" data-check="${esc(o.id)}">Check payment</button>` : '');
  return `<article class="job" data-tone="${tone}"><div class="job-head"><span class="status" data-tone="${tone}">${esc(label(o.paymentStatus || o.status))}</span><h4>${esc(r?.text || o.title)}</h4></div>
  <p class="meta">Revision ${o.revision}${o.scopeRevisionId?' · '+esc(o.scopeRevisionId):''}</p>${o.stale?`<p class="notice attention">${icon('alert')}<span>The brief changed. Review this proposal and issue a new link.</span></p>`:''}${itemRows(o.lineItems,o.currency)}
  <div class="job-total"><strong>${money(o.totalMinor,o.currency)}</strong>${o.amountDueMinor!=null?`<span class="meta">${money(o.amountDueMinor)} due</span>`:''}</div>
  ${actions?`<div class="job-actions">${actions}</div>`:''}${o.lastCheckedAt?`<p class="meta">Checked ${esc(when(o.lastCheckedAt))}</p>`:''}</article>`;
}
function renderBoard() {
  const requests = agentView?.requests ?? [], orderIds = new Set(orders.map(o => o.id)), byOrder = new Map(requests.filter(r => r.order_id).map(r => [r.order_id, r]));
  const lanes = { request: [], quote: [], approval: [], payment: [] };
  for (const r of requests) if (!r.order_id || !orderIds.has(r.order_id) || r.exception || r.delivery_exception) lanes[requestStation(r)].push([toneRank[requestTone(r)], requestCard(r)]);
  for (const o of orders) lanes[orderStation(o)].push([toneRank[orderTone(o)], orderCard(o, byOrder.get(o.id))]);
  const markup = stations.map(([key, name, hint]) => {
    const cards = lanes[key].sort((a, b) => a[0] - b[0]), state = cards.some(c => c[0] === 0) ? 'alert' : cards.length ? 'active' : 'empty';
    return `<section class="station" data-state="${state}" aria-labelledby="station-${key}"><header class="station-head"><span class="node" aria-hidden="true"></span><h3 id="station-${key}">${name}</h3><span class="count">${cards.length}</span></header><div class="station-cards">${cards.map(c => c[1]).join('') || `<p class="station-empty">${hint}</p>`}</div></section>`;
  }).join('');
  if (markup === boardMarkup) return;
  $('orders').innerHTML = boardMarkup = markup;
  const list = selector => $('orders').querySelectorAll(selector);
  list('[data-edit]').forEach(b => b.onclick = () => { reviewingRequest=null; assessment = null; showProposal(orders.find(o=>o.id===b.dataset.edit)); });
  list('[data-client]').forEach(b => b.onclick = () => busy(b, async()=> {
    const link = await request('/api/change-orders/'+b.dataset.client+'/client-access','POST');
    $('approval-link').value = link.approvalUrl; $('open-review').href = link.approvalUrl; $('share').hidden = false; $('manual-workflow').open = true; syncTools();
    $('share-expiry').textContent = 'Access ends '+when(link.approvalExpiresAt)+'. Editing or resetting invalidates it.';
    $('share').scrollIntoView({block:'start'});
  }));
  for (const [attribute,suffix,method] of [['invoice','invoice','POST'],['check','payment-status','GET']]) {
    list('[data-'+attribute+']').forEach(b => b.onclick = () => busy(b, async()=> { await request('/api/change-orders/'+b.dataset[attribute]+'/'+suffix,method); await loadOrders(); }));
  }
  list('[data-agent-review]').forEach(b => b.onclick = () => busy(b, () => reviewException(agentView.requests.find(r => r.id === b.dataset.agentReview))));
  list('[data-agent-action]').forEach(b => b.onclick = () => busy(b, async () => { await request('/api/agent/requests/'+b.dataset.id+'/'+b.dataset.agentAction,'POST',{}); await agentUI.refresh(); }));
}
async function loadOrders() { orders = await request('/api/change-orders'); renderBoard(); }
$('connect-button').onclick = e => busy(e.currentTarget, () => connect($('invitation').value.trim()));
$('refresh-comments').onclick = e => busy(e.currentTarget, loadComments);
$('refresh-orders').onclick = e => busy(e.currentTarget, async () => { await loadOrders(); await agentUI?.refresh(); });
$('assess').onclick = e => busy(e.currentTarget, async () => {
  reviewingRequest=null;
  notice('Reading the request against the agreed brief…');
  assessment = await request('/api/assessments', 'POST', { commentId: selected, clarification: $('clarification').value, designContext, imageDataUrl, figmaFileKey: fileKey });
  const r = assessment.result, tone = r.classification==='new_work'?'action':r.classification==='included'?'quiet':'attention';
  $('assessment').innerHTML = `<div class="assessment"><div><span class="status" data-tone="${tone}">${esc(label(r.classification))}</span></div><p>${esc(r.explanation)}</p>${r.evidence.map(x=>`<figure class="evidence"><blockquote>${esc(x.quote)}</blockquote><figcaption>Agreed brief · clause ${esc(x.clauseId)}</figcaption></figure>`).join('')}${r.designObservations.map(x=>`<p class="meta">${esc(x)}</p>`).join('')}${r.questions.length?`<div class="field"><label for="question">Clarification to post manually in Figma</label><textarea id="question" readonly>${esc(r.questions.join('\n'))}</textarea></div>`:''}<p class="meta">${(assessment.latencyMs/1000).toFixed(1)} seconds · ${esc(assessment.model)}</p></div>`;
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
  $('share-expiry').textContent = 'Access ends '+when(submitted.approvalExpiresAt)+'. Editing or resetting invalidates it.';
  $('share').hidden = false; $('proposal').hidden = true; editing = null; assessment = null;
  await loadOrders(); notice('The exact terms are ready for client review.');
});
$('copy-link').onclick = e => busy(e.currentTarget, async()=> { try { await navigator.clipboard.writeText($('approval-link').value); notice('Review link copied.'); } catch { $('approval-link').select(); notice('Select and copy the review link above.'); } });
$('manual').onclick = () => { assessment = null; reviewingRequest=null; showProposal(); };
$('reset').onclick = e => busy(e.currentTarget, async()=> {
  if (!confirm('Start a fresh demo run? Local evidence and orders in this run will be cleared. PayPal sandbox invoices remain.')) return;
  const result = await request('/api/demo/reset', 'POST'); saveSession(result.session);
  reviewingRequest=null;agentUI?.destroy();agentView=null;
  assessment = null; selected = null; editing = null; imageDataUrl = undefined; designContext = ''; selectionContext = ''; preservedItems = [];
  $('share').hidden = true; $('proposal').hidden = true; $('assessment').innerHTML = ''; $('frame').hidden = true; $('frame').innerHTML = ''; $('remove-frame').hidden = true;
  $('clarification').value = ''; $('assess').disabled = true; await load(); notice('Fresh demo ready.');
});
$('attach-frame').onclick = () => post({ type:'export-frame', expectedFileKey: project?.figmaFileKey });
$('remove-frame').onclick = () => { imageDataUrl = undefined; designContext = selectionContext; $('frame').hidden = true; $('frame').innerHTML = ''; $('remove-frame').hidden = true; };
window.addEventListener('message', async event => {
  if (!isFigmaPluginMessage(event)) return;
  const m = event.data?.pluginMessage; if (!m) return;
  if (m.type === 'session' && m.session) { session=m.session; await load(); }
  if (m.type === 'context' || m.type === 'selection') { fileKey=m.fileKey; selectionContext=JSON.stringify(m.selection); if(!imageDataUrl) designContext=selectionContext; checkFile(); }
  if (m.type === 'frame') {
    if (!project || m.fileKey !== project.figmaFileKey) { notice('That frame is from a different file. Open the designated judging file.',true); return; }
    fileKey=m.fileKey; imageDataUrl=m.dataUrl; designContext=JSON.stringify(m.context); $('frame').innerHTML=`<img class="frame-preview" src="${esc(imageDataUrl)}" alt="Attached Figma frame">`; $('frame').hidden=false; $('remove-frame').hidden=false; notice('Selected frame attached as supporting design evidence.');
  }
  if (m.type === 'error') notice(m.message,true);
});
if (inPlugin) { $('attach-frame').hidden=false; post({type:'get-session'}); post({type:'get-context'}); }
else {
  const invite=location.hash.slice(1); if(invite) { history.replaceState(null,'',location.pathname); connect(invite).catch(e=>notice(e.message,true)); }
  else { try { session=JSON.parse(sessionStorage.getItem('scope-designer')); if(session) load(); } catch {} }
}
