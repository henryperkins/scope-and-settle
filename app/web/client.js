import {api,esc,money,label,notice,busy,itemRows,safeInvoice,canPay,financialLabel,financialNotice,scopeVersions,milestoneMarkup} from './common.js';
const $=id=>document.getElementById(id);
let credential=sessionStorage.getItem('scope-client-portal')||'',pendingKey=crypto.randomUUID(),lastMarkup='',loading=false;
const stateLabel=value=>({queued:'Request received',processing:'Assessing your request',quoted:'Quote ready',needs_clarification:'Your answer is needed',included:'Covered by the brief',exception:'Your designer is reviewing this',dismissed:'Your designer is handling this directly',paid:'Paid'}[value]||label(value));
function useAccess(raw){const fragment=raw.includes('#')?raw.split('#').pop():raw;credential=fragment.startsWith('access=')?fragment.slice(7):fragment;sessionStorage.setItem('scope-client-portal',credential);lastMarkup='';}
const request=(path,method,body)=>api(path,credential,method,body);
function renderQuote(r,o=r.order) {
 if(!o)return '';
 const url=safeInvoice(o.invoiceUrl),needsApproval=o.status==='awaiting_client_approval'&&r.state!=='exception'&&r.state!=='dismissed';
 return `<div class="quote"><div class="row between"><h3>Your quote</h3><span class="badge">${esc(financialLabel(o))}</span></div><small>Revision ${o.revision} · ${esc(o.scopeRevisionId)} · ${esc(scopeVersions(o.scopeContext))}</small><ul>${o.deliverables.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>${itemRows(o.lineItems,o.currency)}<p class="total">${money(o.totalMinor,o.currency)}</p>${milestoneMarkup(o)}<p><strong>Work begins after the approved payment prerequisites.</strong> Delivery timing requires agreement with your designer.</p>
 ${needsApproval?`<form data-approve="${esc(r.id)}" data-order="${esc(o.id)}" data-revision="${o.revision}"><label class="check consent"><input type="checkbox" required name="consent"><span>I approve the exact deliverables and ${money(o.totalMinor)} total in revision ${o.revision}, including the exact payment schedule, acceptance criteria and work-start prerequisites above.</span></label><button type="submit">Approve revision ${o.revision} & prepare PayPal invoice</button></form>`:''}
 ${['approved','creating_invoice'].includes(o.status)?`<p class="notice">Your approval is saved. Invoice setup needs recovery.</p><button data-recover="${esc(r.id)}" data-order="${esc(o.id)}" data-revision="${o.revision}">Retry payment setup</button>`:''}
 ${url&&(canPay(o)||o.financialState?.paymentState==='paid')?`<div class="row"><a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">${o.financialState?.paymentState==='paid'?'View PayPal receipt':'Pay with PayPal sandbox'}</a></div>`:''}
 ${o.paypalInvoiceId||o.installments?.some(m=>m.paypalInvoiceId)?`<button class="secondary" data-payment="${esc(r.id)}" data-order="${esc(o.id)}" data-revision="${o.revision}">Refresh payment</button>`:''}${financialNotice(o)}${o.financialState?.paymentState==='paid'?'<p class="notice">PayPal confirms payment for this approved revision.</p>':''}</div>`;
}
async function load(){
 if(!credential||loading)return;loading=true;
 const forCredential=credential;
 try {
  const view=await request('/api/portal');if(credential!==forCredential)return;$('client-connect').hidden=true;$('client-workspace').hidden=false;$('client-project').textContent=view.projectName;
  $('client-request-form').hidden=!view.acceptingRequests;$('client-paused').hidden=view.acceptingRequests;$('client-expiry').textContent='Private access ends '+new Date(view.expiresAt).toLocaleString()+'.';
  if(view.scope){const s=view.scope.scopeSnapshot;$('client-scope').innerHTML=`<h2>Original scope · Version ${s.version}</h2><p>${view.scope.acknowledgement.state==='acknowledged'?'Acknowledgement recorded':'Supplied by designer · Not acknowledged in this app'}</p><p>Rates v${view.scope.rateSnapshot.version} · Source: ${esc(s.provenance.kind.replaceAll('_',' '))}</p><button id="review-scope" class="secondary">Review original scope</button>`;$('review-scope').onclick=e=>busy(e.currentTarget,async()=>{const link=await request('/api/portal/scope-access','POST',{});location.assign(link.scopeUrl);});}
  const markup=view.requests.map(r=>`<section><span class="badge ${r.state==='exception'?'warn':''}">${esc(r.order?.approvalStatus==='approved'?financialLabel(r.order):stateLabel(r.state))}</span><h2>${esc(r.text)}</h2><div class="conversation">${r.messages.map(m=>`<div class="message ${m.actor==='client'?'from-client':''}"><small>${m.actor==='client'?'You':m.actor==='designer'?'Your designer':'Scope & Settle'}</small><p>${esc(m.body)}</p>${m.body.startsWith('PayPal confirms payment')?`<small>Earlier payment update. Current status: ${esc(r.order?financialLabel(r.order):'Payment needs review')}.</small>`:''}</div>`).join('')}</div>${(r.orders??(r.order?[r.order]:[])).map(o=>renderQuote(r,o)).join('')}${r.state!=='dismissed'?`<details ${r.state==='needs_clarification'?'open':''}><summary>Reply or clarify this request</summary><form data-reply="${esc(r.id)}"><label for="reply-${esc(r.id)}">Your reply</label><textarea id="reply-${esc(r.id)}" maxlength="4000" required></textarea><button type="submit">Send reply</button><small>Changes after a quote go back to your designer; they do not silently change its price.</small></form></details>`:''}</section>`).join('')||'<p class="empty">Your requests and quotes will appear here.</p>';
  // Do not erase a client's text or checked consent during background polling.
  if(markup!==lastMarkup && !document.querySelector('#client-requests :focus')) {
   const drafts=new Map(Array.from(document.querySelectorAll('[data-reply]'),form=>[form.dataset.reply,form.querySelector('textarea').value]));
   $('client-requests').innerHTML=markup;lastMarkup=markup;
   document.querySelectorAll('[data-reply]').forEach(form=>{form.querySelector('textarea').value=drafts.get(form.dataset.reply)||'';});
   document.querySelectorAll('[data-reply]').forEach(form=>{let key=crypto.randomUUID();form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),async()=>{await request('/api/portal/requests/'+form.dataset.reply+'/reply','POST',{text:form.querySelector('textarea').value,key});key=crypto.randomUUID();form.querySelector('textarea').value='';document.activeElement?.blur();await loadAfterAction();notice('Reply received.');});};});
   document.querySelectorAll('[data-approve]').forEach(form=>form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),()=>approve(form.dataset.approve,Number(form.dataset.revision),form.querySelector('[name="consent"]').checked,form.dataset.order));});
   document.querySelectorAll('[data-recover]').forEach(b=>b.onclick=()=>busy(b,()=>approve(b.dataset.recover,Number(b.dataset.revision),true,b.dataset.order)));
   document.querySelectorAll('[data-payment]').forEach(b=>b.onclick=()=>busy(b,async()=>{await request('/api/portal/requests/'+b.dataset.payment+'/payment-status','POST',{orderId:b.dataset.order,revision:Number(b.dataset.revision)});document.activeElement?.blur();await loadAfterAction();notice('Payment checked with PayPal.');}));
  }
 }catch(error){if(credential!==forCredential)return;if(error.status===401){$('client-workspace').hidden=true;$('client-connect').hidden=false;}throw error;}finally{loading=false;}
}
async function loadAfterAction(){lastMarkup='';await load();}
async function approve(id,revision,consent,orderId){const result=await request('/api/portal/requests/'+id+'/approve','POST',{revision,consent,orderId});document.activeElement?.blur();await loadAfterAction();notice(result.invoiceError||'Approval saved. Open PayPal to complete the sandbox payment.',!!result.invoiceError);}
$('client-connect-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{useAccess($('client-access').value.trim());$('client-access').value='';await load();});};
$('client-request-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{await request('/api/portal/requests','POST',{text:$('client-request').value,key:pendingKey});pendingKey=crypto.randomUUID();$('client-request').value='';await load();notice('Request received. You can leave this page; your quote or clarification will be here when you return.');});};
$('client-refresh').onclick=e=>busy(e.currentTarget,load);
$('client-forget').onclick=()=>{credential='';sessionStorage.removeItem('scope-client-portal');$('client-workspace').hidden=true;$('client-connect').hidden=false;};
if(location.hash){useAccess(location.hash.slice(1));history.replaceState(null,'',location.pathname);}
if(credential)load().catch(e=>notice(e.message,true));
setInterval(()=>{if(credential&&!document.hidden)load().catch(e=>notice(e.message,true));},5000);
