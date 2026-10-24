import {evidencePacketControls,bindEvidencePackets} from './evidence-packets.js';
import {deliveryControls,mountDelivery} from './delivery.js';
import {installmentControls,bindInstallments} from './milestones.js';
import {mountReviewedActions} from './reviewed-actions.js';
import { api, sessionApi, esc, money, label, notice, busy, itemRows, safeInvoice, canPay, financialLabel, financialNotice, scopeVersions, milestoneMarkup, balanceCaption } from './common.js';
import { proposalDefaults, selectedProposal } from './proposal.js';
import { isFigmaPluginMessage } from './figma-bridge.js';
import { mountAgent } from './agent.js';
import {mountInbox} from './inbox.js';
import {mountConnectors} from './connectors.js';
import {mountStatusCards} from './status-cards.js';
const $ = id => document.getElementById(id);
const inPlugin = window.parent !== window;
let session, project, comments = [], selected, assessment, editing, imageDataUrl, fileKey, designContext = '', selectionContext = '', preservedItems = [];
let deliveryUI,agentUI,inboxUI,reviewedUI,connectorUI,cardUI,reviewingRequest=null,operationId;
let evidenceEpoch=0,exportCounter=0,nativeGeneration=0,pendingExport=null,evidenceDraft=null,evidenceSnapshot=null;
function clearEvidence(){deliveryUI?.invalidate();cardUI?.invalidate();evidenceEpoch++;pendingExport=null;evidenceDraft=null;evidenceSnapshot=null;imageDataUrl=undefined;designContext='';$('frame').hidden=true;$('frame').src='';$('remove-frame').hidden=true;$('evidence-review').hidden=true;$('evidence-status').textContent='';$('evidence-relevance').checked=false;$('evidence-reason').value='';}
function evidenceTrace(){const e=assessment?.designEvidence;return e?`<div class="notice"><strong>Design evidence</strong><p>File ${esc(e.fileKey)} · Nodes ${e.nodeIds.map(esc).join(', ')} · Request version ${e.sourceVersion}</p><p>Captured ${esc(new Date(e.capturedAt).toLocaleString())} · ${esc(e.freshness)} · Figma version ${esc(e.providerVersion??'unavailable')}</p><p>Node identity ${esc(e.verification)} at ${esc(e.verifiedAt)}. ${e.pixelProvenance==='client_supplied'?'Plugin pixels are client supplied; rendering and exact pixel version are not independently verified.':'Metadata only; no image supplied.'}</p>${e.relevance?`<p>Reviewer relevance: ${esc(e.relevance.reason)}</p>`:''}<p>Snapshot ${esc(e.id)}</p>${(assessment.result.designObservations??[]).map(observation=>`<p>${esc(observation)}</p>`).join('')}</div>`:'<p class="muted">No visual evidence selected. This assessment uses the authoritative request and agreement.</p>';}
function beginEvidence(type){if(!selected||!project)throw new Error('Select the request before capturing supporting evidence.');clearEvidence();const requestKey=evidenceEpoch+':'+selected,exportId=String(++exportCounter);pendingExport={exportId,requestKey,epoch:evidenceEpoch,commentId:selected,generation:nativeGeneration};post({type,expectedFileKey:project.figmaFileKey,exportId,requestKey,generation:nativeGeneration});}

const post = message => { if (inPlugin) parent.postMessage({ pluginMessage: message }, '*'); };
function saveSession(value) {
  if(session?.token!==value?.token||session?.runId!==value?.runId)cardUI?.invalidate();
  if(session?.runId!==value?.runId||!value)clearEvidence();
  session = value;
  if (inPlugin) post({ type: 'save-session', session: value });
  else {
    sessionStorage.setItem('scope-designer', JSON.stringify(value));
    if (value?.renewalCredential) localStorage.setItem('scope-judge', JSON.stringify(value));
  }
}
const request = sessionApi(() => session, saveSession, () => {
  deliveryUI?.destroy();agentUI?.destroy();inboxUI?.destroy();reviewedUI?.destroy();connectorUI?.destroy();cardUI?.destroy();
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
    const landing=new URL(location.href),landingOrder=landing.searchParams.get('order'),landingRun=landing.searchParams.get('run');
    if(landingOrder||landingRun){if(!landingOrder||landingRun!==session.runId)throw new Error('This card belongs to another run. Open it with that run’s own designer access.');await request('/api/change-orders/'+encodeURIComponent(landingOrder));}
    cardUI?.destroy();
    cardUI=mountStatusCards({request,inPlugin,post,getContext:()=>({session,project,fileKey,generation:nativeGeneration,evidenceEpoch})});
    await cardUI.refresh();
    deliveryUI?.destroy();deliveryUI=mountDelivery({request,inPlugin,post,getContext:()=>({session,project,fileKey,generation:nativeGeneration,evidenceEpoch})});
    $('connect').hidden = true; $('workspace').hidden = false;
    $('brief').innerHTML = project.scopeClauses.map(c => `<blockquote>${esc(c.text)}<br><small>${esc(c.id)}</small></blockquote>`).join('') + `<small>${esc(project.scopeRevisionId)}</small>`;
    await loadScope();
    $('price-mode').innerHTML = project.rateCard.map(r => `<option value="${esc(r.id)}">${esc(r.description)} · ${money(r.unitAmountMinor)}</option>`).join('') + '<option value="custom">Designer-set price</option>';
    await Promise.all([loadComments().catch(()=>{$('comments').innerHTML='<p class="notice">Figma comments are unavailable. Portal requests still work; check Figma permissions or try Refresh later.</p>';comments=[];}), loadOrders()]);
    agentUI?.destroy();inboxUI?.destroy();reviewedUI?.destroy();connectorUI?.destroy();
    agentUI=mountAgent({request,project,comments,onReview:async r=>{
      clearEvidence();reviewingRequest=r.id;selected=r.source==='figma'?r.source_id:null;assessment=null;
      if(r.assessment_id){try{const a=await request('/api/assessments/'+r.assessment_id);if(a.result.items?.length)assessment=a;}catch{}}
      let order=null;if(r.order_id&&!assessment?.result.items?.length){const o=await request('/api/change-orders/'+r.order_id);if(['draft','awaiting_client_approval','needs_re_review'].includes(o.status))order=o;else{reviewingRequest=null;notice('This request already has an approved or invoiced quote. Ask the client to send new work as a separate portal request so the existing invoice stays attached.',true);$('orders').scrollIntoView({block:'start'});return;}}
      $('manual-workflow').open=true;if(assessment?.result.items?.length)renderItemAssessment();showProposal(order);
      if(!order&&!assessment){$('price-mode').value='custom';$('amount').value='';$('submit-proposal').disabled=true;$('proposal').hidden=true;$('assessment').innerHTML='<button id="assess-stored-request" type="button">Assess this authoritative request</button>';$('assess-stored-request').onclick=e=>busy(e.currentTarget,async()=>{assessment=await request('/api/agent/requests/'+r.id+'/assess','POST',{});renderItemAssessment();showProposal();});}
      notice('Review this exception and confirm its exact terms. Your confirmed quote will appear in the existing client portal.');
    }});await agentUI.refresh().catch(()=>notice('Agent status is unavailable. The existing proposal and payment controls remain available.',true));
    reviewedUI=mountReviewedActions({request,onComplete:async()=>{await inboxUI.refresh();await loadOrders();}});
    inboxUI=mountInbox({request,onAction:thread=>reviewedUI.openThread(thread),onReview:async thread=>{
      clearEvidence();reviewingRequest=thread.id;selected=thread.sourceKind==='figma'?thread.rootId:null;assessment=null;operationId=undefined;
      const epoch=evidenceEpoch,requestId=reviewingRequest,commentId=selected;
      const current=()=>epoch===evidenceEpoch&&requestId===reviewingRequest&&commentId===selected;
      if(thread.assessmentId){const result=await request('/api/assessments/'+thread.assessmentId);if(!current())return;assessment=result;}
      $('manual-workflow').open=true;$('proposal').hidden=true;
      if(assessment?.result.items?.length){renderItemAssessment();showProposal();}
      else{$('assessment').innerHTML='<button id="assess-inbox-request" type="button">Assess this authoritative request</button>';$('assess-inbox-request').onclick=e=>busy(e.currentTarget,async()=>{const result=await request('/api/agent/requests/'+thread.id+'/assess','POST',{});if(!current())return;assessment=result;renderItemAssessment();showProposal();await inboxUI.refresh();});}
      $('assessment').scrollIntoView({block:'start'});
    }});await inboxUI.refresh().catch(()=>notice('Inbox is unavailable. Refresh the page to recover.',true));
    connectorUI=mountConnectors({request});await connectorUI.refresh().catch(()=>notice('Agent connector status is unavailable. Other designer controls remain available.',true));
    if (session.renewalCredential) { $('resume-access').hidden = false; $('designer-resume').value = 'resume=' + session.renewalCredential; }
    const actionId=new URL(location.href).searchParams.get('action');if(actionId)await reviewedUI.openAction(actionId);
    checkFile();
    const budget = await request('/api/ai-budget'); $('budget').textContent = `AI budget available: $${(budget.remainingMicroUsd/1e6).toFixed(2)} of $${(budget.capMicroUsd/1e6).toFixed(2)} (conservative accounting).`;
  } catch (error) { cardUI?.invalidate(); notice(error.message, true); $('connect').hidden = false; $('workspace').hidden = true; }
}
async function loadScope(){
 const c=await request('/api/scope'),s=c.scopeSnapshot,r=c.rateSnapshot,p=s.provenance;
 $('scope-ledger').innerHTML=`<p><strong>Scope v${s.version} · Rates v${r.version}</strong> · ${c.acknowledgement.state==='acknowledged'?'Client acknowledgement recorded':'Supplied, not acknowledged in this app'}</p><p>Source: ${esc(p.kind.replaceAll('_',' '))}. Captured ${esc(new Date(p.capturedAt).toLocaleString())}.${p.sourceTime?' Source recorded '+esc(p.sourceTime)+'.':' Original agreement date unknown.'}</p><button id="issue-scope-access" class="secondary">Create original-scope review link</button><div id="scope-link-box" hidden><label for="scope-link">Private original-scope review link</label><input id="scope-link" readonly><a id="scope-open" target="_blank" rel="noreferrer">Open scope review</a></div><h3>Approved additions</h3>${c.commitments.length?c.commitments.map(x=>`<p>${esc(x.terms?.title||'Historical approved change')} · Revision ${x.revision} · Work committed${x.financialState?' · Payment: '+esc(x.financialState.paymentState.replaceAll('_',' ')):''}</p>`).join(''):'<p>No approved additions recorded.</p>'}${session.canEditScope?`<details><summary>Edit supplied scope or rate card</summary><p>Changed terms require fresh automation approval and re-review of pending proposals. Approved changes retain their terms.</p>${s.clauses.map((cl,i)=>`<label for="scope-clause-${i}">${esc(cl.id)}</label><textarea id="scope-clause-${i}" maxlength="4000">${esc(cl.text)}</textarea>`).join('')}<button id="save-scope">Save new scope version</button>${r.entries.map((rate,i)=>`<label for="rate-description-${i}">${esc(rate.id)}</label><input id="rate-description-${i}" maxlength="1000" value="${esc(rate.description)}"><label for="rate-amount-${i}">Unit price (USD)</label><input id="rate-amount-${i}" type="number" min="0.01" step="0.01" value="${(rate.unitAmountMinor/100).toFixed(2)}">`).join('')}<button id="save-rates">Save new rate version</button></details>`:''}`;
 $('issue-scope-access').onclick=e=>busy(e.currentTarget,async()=>{const link=await request('/api/scope/snapshots/'+s.id+'/client-access','POST',{expectedVersion:s.version});$('scope-link').value=link.scopeUrl;$('scope-open').href=link.scopeUrl;$('scope-link-box').hidden=false;});
 if(session.canEditScope){$('save-scope').onclick=e=>busy(e.currentTarget,async()=>{await request('/api/project/scope','POST',{expectedContextVersion:c.contextVersion,clauses:s.clauses.map((cl,i)=>({id:cl.id,text:$('scope-clause-'+i).value}))});await load();notice('Scope saved. Changed terms need new automation approval and pending proposal review.');});$('save-rates').onclick=e=>busy(e.currentTarget,async()=>{await request('/api/project/rates','POST',{expectedContextVersion:c.contextVersion,entries:r.entries.map((rate,i)=>({id:rate.id,description:$('rate-description-'+i).value,unitAmountMinor:Math.round(Number($('rate-amount-'+i).value)*100)}))});await load();notice('Rates saved. Changed terms need new automation approval and pending proposal review.');});}
}
function checkFile() {
  if (!inPlugin || !project) return;
  const matches = fileKey === project.figmaFileKey;
  $('attach-frame').disabled = !matches;$('attach-metadata').disabled=!matches;
  $('figma-context').textContent = matches ? 'Connected to the designated Figma file.' : 'Open the designated judging file to attach a frame. The brief and comments below belong to that file.';
  if (!matches) clearEvidence();
}
async function loadComments() {
  const result = await request('/api/comments'); comments = result.comments;
  $('comments').innerHTML = comments.filter(c => !c.parentId).map(c => `<button class="comment ${c.id===selected?'selected':''}" data-comment="${esc(c.id)}"><strong>${esc(c.message)}</strong><small>${esc(c.userHandle || 'Comment author')} · ${comments.filter(r=>r.parentId===c.id).length} replies</small></button>`).join('') || '<div class="empty">No comments yet. In the demo Figma file, add “Can you add the mobile checkout?”, then refresh.</div>';
  $('comments').querySelectorAll('[data-comment]').forEach(button => button.onclick = () => {
    clearEvidence();reviewingRequest=null;
    selected = button.dataset.comment; assessment = null; $('assessment').innerHTML = ''; $('proposal').hidden = true;
    $('comments').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b===button)); $('assess').disabled = false;
  });
}
function selectedItems(){return Array.from($('assessment').querySelectorAll('[data-item]:checked'),input=>input.dataset.item);}
function renderItemAssessment(){
 const items=assessment.result.items;
 $('assessment').innerHTML=evidenceTrace()+`<fieldset><legend>Choose the additional work for this proposal</legend><button type="button" id="reassess-items">Reassess current request</button><p>Included, unresolved and reserved work stays out of the price. Each partial proposal needs separate client approval.</p>${items.map(i=>`<article class="card"><label class="check"><input type="checkbox" name="request-item" data-item="${esc(i.id)}" ${i.exactSourceDuplicate||i.exactCommitment||i.classification!=='new_work'||!i.lineItems.length||i.questions.length||i.reservationState||(i.reviewReferences??[]).some(ref=>ref.decision!=='distinct_work')?'disabled':''}><span>${esc(i.requestedDeliverable)} · ${esc(label(i.classification))} · ${money(i.proposedTotalMinor)}${i.designerPriced?' · Designer price':''}</span></label>${i.evidence.map(e=>`<blockquote>${esc(e.quote)}<br><small>${esc(e.kind==='scope_clause'?e.clauseId:e.resourceId+' revision '+e.revision)}</small></blockquote>`).join('')}${i.questions.map(q=>`<p>${esc(q)}</p>`).join('')}${i.reservationState?`<p>Already ${esc(i.reservationState)} in its original proposal.</p>`:''}${i.lineageItemIds.length?'<p>Changed decomposition overlaps reserved work. Resolve the original proposal first.</p>':''}${(i.reviewReferences??[]).map((ref,index)=>`<details><summary>Possible existing work · revision ${ref.revision}</summary><p>Original change order: ${esc(ref.resourceId)}. Compare its terms in Change orders. Decision: ${esc(ref.decision??'Unresolved')}.</p><label for="duplicate-reason-${esc(i.id)}-${index}">Decision reason</label><input id="duplicate-reason-${esc(i.id)}-${index}" maxlength="4000"><button type="button" data-duplicate="${esc(i.id)}" data-reference="${index}" data-decision="same_commitment">Same commitment</button><button type="button" data-duplicate="${esc(i.id)}" data-reference="${index}" data-decision="distinct_work">Distinct additional work</button></details>`).join('')}${i.classification==='new_work'&&!i.reservationState?`<details><summary>Set a designer price</summary><label for="item-price-${esc(i.id)}">Unit price (USD)</label><input id="item-price-${esc(i.id)}" type="number" min="0.01" step="0.01"><label for="item-price-reason-${esc(i.id)}">Price and review reason</label><input id="item-price-reason-${esc(i.id)}" maxlength="4000"><button type="button" data-item-price="${esc(i.id)}">Record designer price</button></details>`:''}</article>`).join('')}</fieldset>`;
 $('reassess-items').onclick=e=>busy(e.currentTarget,async()=>{const epoch=evidenceEpoch,requestId=reviewingRequest,commentId=selected;const result=requestId?await request('/api/agent/requests/'+requestId+'/assess','POST',{}):await request('/api/assessments','POST',{commentId,...(evidenceSnapshot?{evidenceSnapshotId:evidenceSnapshot.id}:{})});if(epoch!==evidenceEpoch||requestId!==reviewingRequest||commentId!==selected)return;assessment=result;operationId=undefined;renderItemAssessment();showProposal();});
 $('assessment').querySelectorAll('[data-item]').forEach(input=>input.onchange=()=>{operationId=undefined;showProposal();});
 $('assessment').querySelectorAll('[data-item-price]').forEach(button=>button.onclick=()=>busy(button,async()=>{const i=items.find(i=>i.id===button.dataset.itemPrice);await request('/api/request-items/'+i.id+'/designer-price','POST',{unitAmountMinor:Math.round(Number($('item-price-'+i.id).value)*100),quantity:1,description:i.requestedDeliverable,expected:i.review,reason:$('item-price-reason-'+i.id).value});assessment=await request('/api/assessments/'+assessment.id);renderItemAssessment();showProposal();notice('Designer price and review recorded. Automatic quoting remains limited to catalogue rates.');}));
 $('assessment').querySelectorAll('[data-duplicate]').forEach(button=>button.onclick=e=>busy(button,async()=>{const i=items.find(i=>i.id===button.dataset.duplicate),index=Number(button.dataset.reference),ref=i.reviewReferences[index];await request('/api/request-items/'+i.id+'/duplicate-decision','POST',{decision:button.dataset.decision,reason:$('duplicate-reason-'+i.id+'-'+index).value,commitmentId:ref.resourceId,commitmentRevision:ref.revision,expected:i.review});assessment=await request('/api/assessments/'+assessment.id);renderItemAssessment();showProposal();notice('Duplicate decision recorded for these exact terms.');}));
}
function pricing() {
 if(!editing&&assessment?.result.items?.length){const selected=selectedProposal(assessment,selectedItems());$('proposal-total').textContent=selected.itemIds.length?money(selected.totalMinor)+' · Selected items, server-resolved rates':'Choose eligible additional work above.';$('submit-proposal').disabled=!selected.itemIds.length;return selected.lineItems;}

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
  cardUI?.invalidate();
  $('manual-workflow').open=true;
  editing = order?.id ?? null;
  const itemMode=!order&&assessment?.result.items?.length;
  const chosen=itemMode?selectedProposal(assessment,selectedItems()):null;
  for(const id of ['title','deliverables','price-mode','quantity','amount'])$(id).disabled=!!itemMode;
  const draft = proposalDefaults(order, itemMode?{result:{deliverables:chosen.deliverables,lineItems:chosen.lineItems}}:assessment, project);
  $('title').value = draft.title; $('deliverables').value = draft.deliverables.join('\n');
  preservedItems = draft.preservedItems;
  $('price-mode').value = draft.priceMode;
  $('quantity').value = draft.quantity; $('amount').value = draft.amount;
  $('proposal').hidden = !!itemMode&&!chosen.itemIds.length; pricing(); $('proposal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadOrders() {
  const orders = await request('/api/change-orders');
  $('orders').innerHTML = orders.map(o => {
    const url = safeInvoice(o.invoiceUrl);
    return `<article class="card"><div class="row between"><h3>${esc(o.title)}</h3><span class="badge ${o.stale?'warn':''}">${esc(financialLabel(o))}</span></div>${financialNotice(o)}<small>Revision ${o.revision}${o.scopeRevisionId?' · '+esc(o.scopeRevisionId):''} · ${esc(scopeVersions(o.scopeContext))}</small>${o.stale?'<div class="notice">The brief changed. Review this proposal and issue a new link.</div>':''}${sourceNotice(o)}${itemRows(o.lineItems,o.currency)}<p><strong>${money(o.totalMinor,o.currency)}</strong>${balanceCaption(o)}</p>${milestoneMarkup(o)}${installmentControls(o)}${deliveryControls(o)}${evidencePacketControls(o)}<div class="row">${['draft','needs_re_review','awaiting_client_approval'].includes(o.status)?`<button class="secondary" data-edit="${esc(o.id)}">Review terms</button>`:''}${session.grantId&&o.scopeRevisionId&&!o.stale?`<button class="secondary" data-client="${esc(o.id)}">Client review link</button>`:''}${['approved','creating_invoice'].includes(o.status)&&!o.installments?.some(m=>!m.legacy)?`<button data-invoice="${esc(o.id)}">Prepare PayPal invoice</button>`:''}${url&&(canPay(o)||o.financialState?.paymentState==='paid')?`<a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">PayPal invoice</a>`:''}${o.paypalInvoiceId||o.installments?.some(m=>m.paypalInvoiceId)?`<button class="secondary" data-check="${esc(o.id)}">Check payment</button>`:''}${inPlugin?`<button class="secondary" data-status-card="${esc(o.id)}">Create / refresh Figma status card</button>`:''}</div>${o.lastCheckedAt?`<small>Checked ${esc(new Date(o.lastCheckedAt).toLocaleString())}</small>`:''}${abandonControl(o)}</article>`;
  }).join('') || '<p class="muted">Your approved changes and payment status will appear here.</p>';
  bindInstallments($('orders'),orders,request,loadOrders);deliveryUI?.bind($('orders'),orders);bindEvidencePackets($('orders'),request,()=>session);
  $('orders').querySelectorAll('[data-status-card]').forEach(b=>b.onclick=()=>busy(b,()=>cardUI.upsert(orders.find(o=>o.id===b.dataset.statusCard))));
  $('orders').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { reviewingRequest=null; assessment = null; showProposal(orders.find(o=>o.id===b.dataset.edit)); });
  $('orders').querySelectorAll('[data-client]').forEach(b => b.onclick = () => busy(b, async()=> {
    const link = await request('/api/change-orders/'+b.dataset.client+'/client-access','POST');
    $('approval-link').value = link.approvalUrl; $('open-review').href = link.approvalUrl; $('share').hidden = false;
    $('share-expiry').textContent = 'Access ends '+new Date(link.approvalExpiresAt).toLocaleString()+'. Editing or resetting invalidates it.';
    $('share').scrollIntoView({block:'start'});
  }));
  for (const [attribute,suffix,method] of [['invoice','invoice','POST'],['check','payment-status','GET']]) {
    $('orders').querySelectorAll('[data-'+attribute+']').forEach(b => b.onclick = () => busy(b, async()=> { await request('/api/change-orders/'+b.dataset[attribute]+'/'+suffix,method); await loadOrders(); }));
  }
  $('orders').querySelectorAll('[data-abandon]').forEach(form => form.onsubmit = e => { e.preventDefault(); busy(form.querySelector('button'), async()=> {
    const id=form.dataset.abandon, reason=form.querySelector('[name="reason"]').value.trim();
    if(!reason)throw new Error('Enter why you are abandoning this proposal.');
    if(!form.querySelector('[name="confirm"]').checked)throw new Error('Confirm that this unapproved proposal and its client link will be cancelled.');
    await request('/api/change-orders/'+id+'/abandon','POST',{reason});
    if(editing===id){editing=null;$('proposal').hidden=true;}
    $('share').hidden=true; await loadOrders(); await inboxUI?.refresh().catch(()=>{});
    notice('Proposal abandoned. Its reserved items were released and its client link no longer works. Once the thread is restored, refresh it in the inbox, reassess and create a new proposal.');
  }); });
}
// Pending reserved items whose authoritative source is unavailable or changed cannot be submitted or approved.
function sourceNotice(o) {
  if (o.itemSourceState==='unavailable') return '<div class="notice" data-source-state="unavailable"><strong>Figma thread unavailable.</strong> Submission and client approval are blocked. Abandon this unapproved proposal; after the thread is restored, refresh it in the inbox, reassess and create a new proposal.</div>';
  if (o.itemSourceState==='changed') return '<div class="notice" data-source-state="changed"><strong>Request changed.</strong> These reserved items no longer match the current thread, so submission and client approval are blocked. Abandon this proposal and reassess the current request.</div>';
  return '';
}
function abandonControl(o) {
  if (o.paypalInvoiceId || o.approvalStatus==='approved' || !['draft','awaiting_client_approval','needs_re_review'].includes(o.status)) return '';
  const id=esc(o.id);
  return `<details class="abandon"${o.itemSourceState&&o.itemSourceState!=='current'?' open':''}><summary>Abandon this unapproved proposal</summary><form data-abandon="${id}"><label for="abandon-reason-${id}">Reason (required)</label><input id="abandon-reason-${id}" name="reason" maxlength="500" required autocomplete="off"><label class="check"><input id="abandon-confirm-${id}" name="confirm" type="checkbox" required><span>Cancel revision ${esc(o.revision)}, release its reserved items and permanently disable its client approval link. Approved work and invoices are never affected.</span></label><button type="submit" class="secondary danger">Abandon proposal</button></form></details>`;
}
$('connect-button').onclick = e => busy(e.currentTarget, () => connect($('invitation').value.trim()));
$('refresh-comments').onclick = e => busy(e.currentTarget, loadComments);
$('refresh-orders').onclick = e => busy(e.currentTarget, loadOrders);
$('assess').onclick = e => busy(e.currentTarget, async () => {
  reviewingRequest=null;
  notice('Reading the request against the agreed brief…');
  const epoch=evidenceEpoch,commentId=selected;
  const result=await request('/api/assessments', 'POST', {commentId,...(evidenceSnapshot?{evidenceSnapshotId:evidenceSnapshot.id}:{})});
  if(epoch!==evidenceEpoch||commentId!==selected)return;
  assessment=result;
  operationId=undefined;
  const r = assessment.result;
  if(r.items?.length){renderItemAssessment();showProposal();notice('Review each item and choose the additional work to propose.');return;}
  $('assessment').innerHTML = `<hr><span class="badge">${esc(label(r.classification))}</span><p>${esc(r.explanation)}</p>${r.evidence.map(x=>`<blockquote>${esc(x.quote)}<br><small>${esc(x.clauseId)}</small></blockquote>`).join('')}${r.designObservations.map(x=>`<p class="muted">${esc(x)}</p>`).join('')}${r.questions.length?`<label for="question">Clarification to post manually in Figma</label><textarea id="question" readonly>${esc(r.questions.join('\n'))}</textarea>`:''}<small>${(assessment.latencyMs/1000).toFixed(1)} seconds · ${esc(assessment.model)}</small>`;
  notice(r.classification==='new_work'?'Review the proposed deliverables and price below.':r.classification==='included'?'This request is covered by the provided brief.':'Post the clarification question in Figma, then refresh the authoritative thread and reassess.');
  $('proposal').hidden=true;notice('Reassess this authoritative request to review persistent items before creating a proposal.');
});
for (const id of ['price-mode','quantity','amount']) $(id).oninput = pricing;
$('submit-proposal').onclick = async e => {await busy(e.currentTarget, async () => {
  if(!editing&&!assessment?.result.items?.length)throw new Error('Select or reassess an authoritative request and choose eligible items before creating a proposal');
  const body = { title:$('title').value, deliverables:$('deliverables').value.split('\n').map(x=>x.trim()).filter(Boolean), lineItems:pricing(), currency:'USD', commentId:selected || null, assessmentId:assessment?.id };
  if(!editing&&assessment?.result.items?.length){body.itemIds=selectedItems();body.operationId=operationId??(operationId=crypto.randomUUID());}
  const order = editing ? await request('/api/change-orders/'+editing, 'PATCH', body) : await request('/api/change-orders', 'POST', body);
  const submitted = await request('/api/change-orders/'+order.id+'/submit', 'POST');
  if(reviewingRequest){await request('/api/agent/requests/'+reviewingRequest+'/publish','POST',{orderId:submitted.order.id,revision:submitted.order.revision,consent:true});if(!assessment?.result.items?.length)reviewingRequest=null;await agentUI.refresh();}
  $('approval-link').value = submitted.approvalUrl; $('open-review').href = submitted.approvalUrl;
  $('share-expiry').textContent = 'Access ends '+new Date(submitted.approvalExpiresAt).toLocaleString()+'. Editing or resetting invalidates it.';
  $('share').hidden = false; $('proposal').hidden = true; editing = null;
  if(assessment?.result.items?.length){assessment=await request('/api/assessments/'+assessment.id);operationId=undefined;renderItemAssessment();showProposal();}else assessment=null;
  await loadOrders(); notice('The exact terms are ready for client review.');
});pricing();};
$('copy-link').onclick = e => busy(e.currentTarget, async()=> { try { await navigator.clipboard.writeText($('approval-link').value); notice('Review link copied.'); } catch { $('approval-link').select(); notice('Select and copy the review link above.'); } });
$('manual').onclick = () => { assessment=null;reviewingRequest=null;$('proposal').hidden=true;$('manual-workflow').open=true;$('comments').scrollIntoView({block:'start'});notice('Select an authoritative Figma request and assess it, or review and reassess a portal request, then choose eligible additional items.'); };
$('reset').onclick = e => busy(e.currentTarget, async()=> {
  if (!confirm('Start a fresh demo run? Local evidence and orders in this run will be cleared. PayPal sandbox invoices remain.')) return;
  const result = await request('/api/demo/reset', 'POST'); saveSession(result.session);
  reviewingRequest=null;agentUI?.destroy();inboxUI?.destroy();reviewedUI?.destroy();
  clearEvidence();assessment = null; selected = null; editing = null; imageDataUrl = undefined; designContext = ''; selectionContext = ''; preservedItems = [];
  $('share').hidden = true; $('proposal').hidden = true; $('assessment').innerHTML = ''; $('frame').hidden = true; $('remove-frame').hidden = true;
  $('assess').disabled = true; await load(); notice('Fresh demo ready.');
});
$('attach-frame').onclick=()=>{try{beginEvidence('export-frame');}catch(error){notice(error.message,true);}};
$('attach-metadata').onclick=()=>{try{beginEvidence('capture-selection');}catch(error){notice(error.message,true);}};
$('remove-frame').onclick=clearEvidence;
$('confirm-evidence').onclick=e=>busy(e.currentTarget,async()=>{
 if(!evidenceDraft||!selected)throw new Error('Capture the selection for this request first.');
 const epoch=evidenceEpoch,commentId=selected,body={...evidenceDraft,commentId};
 if(!$('evidence-relevance-row').hidden){if(!$('evidence-relevance').checked||!$('evidence-reason').value.trim())throw new Error('Confirm why this selection is relevant to this exact request.');body.relevance={confirmed:true,reason:$('evidence-reason').value.trim()};}
 const saved=await request('/api/design-evidence','POST',body);if(epoch!==evidenceEpoch||commentId!==selected)return;
 evidenceSnapshot=saved;$('evidence-status').textContent=saved.verification==='verified'?'Evidence selected for this request. Captured '+new Date(saved.capturedAt).toLocaleString()+'. Node identity verified; plugin pixels remain client supplied.':'Evidence unavailable: '+saved.unavailableReason;
 if(saved.verification!=='verified')evidenceSnapshot=null;
});
window.addEventListener('pagehide',()=>{cardUI?.invalidate();deliveryUI?.invalidate();});
window.addEventListener('message',async event=>{
 if(!isFigmaPluginMessage(event))return;const m=event.data?.pluginMessage;if(!m)return;
 if(m.type==='status-card-result'){cardUI?.message(m);return;}
 if(m.type==='delivery-result'){deliveryUI?.message(m);return;}
 if(m.type==='session'&&m.session){clearEvidence();session=m.session;await load();}
 if(m.type==='context'||m.type==='selection'){if(m.type==='selection'||fileKey!==m.fileKey)clearEvidence();fileKey=m.fileKey;nativeGeneration=Number.isSafeInteger(m.generation)?m.generation:0;selectionContext=JSON.stringify(m.selection);checkFile();}
 if(m.type==='frame'){
  const p=pendingExport;if(!p||p.epoch!==evidenceEpoch||p.commentId!==selected||m.exportId!==p.exportId||m.requestKey!==p.requestKey||m.generation!==p.generation||m.generation!==nativeGeneration||m.fileKey!==project?.figmaFileKey)return;
  pendingExport=null;if(!Array.isArray(m.context)||!m.context.length)return;
  evidenceDraft={fileKey:m.fileKey,nodeIds:m.context.map(n=>n.id),capturedAt:m.capturedAt,selection:m.context,...(m.dataUrl?{imageDataUrl:m.dataUrl}:{})};imageDataUrl=m.dataUrl;$('frame').src=imageDataUrl??'';$('frame').hidden=!imageDataUrl;$('remove-frame').hidden=false;$('evidence-review').hidden=false;
  const anchor=comments.find(c=>c.id===selected)?.nodeId??null;$('evidence-relevance-row').hidden=!!anchor&&evidenceDraft.nodeIds.includes(anchor);$('evidence-relationship').textContent='Comment anchor: '+(anchor??'unknown')+'. Selected nodes: '+evidenceDraft.nodeIds.join(', ')+'. '+(imageDataUrl?'Pixels are supplied by the plugin.':'Metadata only; no image selected.');$('evidence-status').textContent='Captured selection awaits verification and explicit use for this request.';
 }
 if(m.type==='error'&&pendingExport&&m.exportId===pendingExport.exportId&&m.requestKey===pendingExport.requestKey){pendingExport=null;notice(m.message,true);}
});
if (inPlugin) { $('attach-frame').hidden=false;$('attach-metadata').hidden=false; post({type:'get-session'}); post({type:'get-context'}); }
else {
  const invite=location.hash.slice(1); if(invite) { history.replaceState(null,'',location.pathname); connect(invite).catch(e=>notice(e.message,true)); }
  else { try { session=JSON.parse(sessionStorage.getItem('scope-designer')); if(session) load(); } catch {} }
}
