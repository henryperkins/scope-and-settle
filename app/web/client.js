import {api,esc,money,label,notice,busy,itemRows,safeInvoice} from './common.js';
const $=id=>document.getElementById(id);
let credential=sessionStorage.getItem('scope-client-portal')||'',pendingKey=crypto.randomUUID(),lastMarkup='',loading=false;
const stateLabel=value=>({queued:'Request received',processing:'Assessing your request',quoted:'Quote ready',needs_clarification:'Your answer is needed',included:'Covered by the brief',exception:'Your designer is reviewing this',dismissed:'Your designer is handling this directly',paid:'Paid'}[value]||label(value));
function useAccess(raw){const fragment=raw.includes('#')?raw.split('#').pop():raw;credential=fragment.startsWith('access=')?fragment.slice(7):fragment;sessionStorage.setItem('scope-client-portal',credential);lastMarkup='';}
const request=(path,method,body)=>api(path,credential,method,body);
function renderQuote(r) {
 const o=r.order;if(!o)return '';
 const url=safeInvoice(o.invoiceUrl),needsApproval=o.status==='awaiting_client_approval'&&r.state!=='exception'&&r.state!=='dismissed';
 return `<div class="quote"><div class="row between"><h3>Your quote</h3><span class="badge">${esc(label(o.paymentStatus||o.status))}</span></div><small>Revision ${o.revision} · ${esc(o.scopeRevisionId)}</small><ul>${o.deliverables.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>${itemRows(o.lineItems,o.currency)}<p class="total">${money(o.totalMinor,o.currency)}</p><p><strong>Work begins after payment.</strong> Delivery timing requires agreement with your designer.</p>
 ${needsApproval?`<form data-approve="${esc(r.id)}" data-revision="${o.revision}"><label class="check consent"><input type="checkbox" required name="consent"><span>I approve the exact deliverables and ${money(o.totalMinor)} total in revision ${o.revision}, and agree that work begins after payment.</span></label><button type="submit">Approve revision ${o.revision} & prepare PayPal invoice</button></form>`:''}
 ${['approved','creating_invoice'].includes(o.status)?`<p class="notice">Your approval is saved. Invoice setup needs recovery.</p><button data-recover="${esc(r.id)}" data-revision="${o.revision}">Retry payment setup</button>`:''}
 ${url?`<div class="row"><a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">${o.status==='paid'?'View PayPal receipt':'Pay with PayPal sandbox'}</a><button class="secondary" data-payment="${esc(r.id)}">Refresh payment</button></div>`:''}
 ${o.status==='paid'?'<p class="notice">PayPal confirms payment for this approved revision.</p>':''}</div>`;
}
async function load(){
 if(!credential||loading)return;loading=true;
 try {
  const view=await request('/api/portal');$('client-connect').hidden=true;$('client-workspace').hidden=false;$('client-project').textContent=view.projectName;
  $('client-request-form').hidden=!view.acceptingRequests;$('client-paused').hidden=view.acceptingRequests;$('client-expiry').textContent='Private access ends '+new Date(view.expiresAt).toLocaleString()+'.';
  const markup=view.requests.map(r=>`<section><span class="badge ${r.state==='exception'?'warn':''}">${esc(stateLabel(r.state))}</span><h2>${esc(r.text)}</h2><div class="conversation">${r.messages.map(m=>`<div class="message ${m.actor==='client'?'from-client':''}"><small>${m.actor==='client'?'You':m.actor==='designer'?'Your designer':'Scope & Settle'}</small><p>${esc(m.body)}</p></div>`).join('')}</div>${renderQuote(r)}${r.state!=='dismissed'?`<details ${r.state==='needs_clarification'?'open':''}><summary>Reply or clarify this request</summary><form data-reply="${esc(r.id)}"><label for="reply-${esc(r.id)}">Your reply</label><textarea id="reply-${esc(r.id)}" maxlength="4000" required></textarea><button type="submit">Send reply</button><small>Changes after a quote go back to your designer; they do not silently change its price.</small></form></details>`:''}</section>`).join('')||'<p class="empty">Your requests and quotes will appear here.</p>';
  // Do not erase a client's text or checked consent during background polling.
  if(markup!==lastMarkup && !document.querySelector('#client-requests :focus')) {
   $('client-requests').innerHTML=markup;lastMarkup=markup;
   document.querySelectorAll('[data-reply]').forEach(form=>{let key=crypto.randomUUID();form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),async()=>{await request('/api/portal/requests/'+form.dataset.reply+'/reply','POST',{text:form.querySelector('textarea').value,key});key=crypto.randomUUID();form.querySelector('textarea').value='';document.activeElement?.blur();await loadAfterAction();notice('Reply received.');});};});
   document.querySelectorAll('[data-approve]').forEach(form=>form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),()=>approve(form.dataset.approve,Number(form.dataset.revision),form.querySelector('[name="consent"]').checked));});
   document.querySelectorAll('[data-recover]').forEach(b=>b.onclick=()=>busy(b,()=>approve(b.dataset.recover,Number(b.dataset.revision),true)));
   document.querySelectorAll('[data-payment]').forEach(b=>b.onclick=()=>busy(b,async()=>{await request('/api/portal/requests/'+b.dataset.payment+'/payment-status','POST',{});document.activeElement?.blur();await loadAfterAction();notice('Payment checked with PayPal.');}));
  }
 }catch(error){if(error.status===401){$('client-workspace').hidden=true;$('client-connect').hidden=false;}throw error;}finally{loading=false;}
}
async function loadAfterAction(){lastMarkup='';await load();}
async function approve(id,revision,consent){const result=await request('/api/portal/requests/'+id+'/approve','POST',{revision,consent});document.activeElement?.blur();await loadAfterAction();notice(result.invoiceError||'Approval saved. Open PayPal to complete the sandbox payment.',!!result.invoiceError);}
$('client-connect-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{useAccess($('client-access').value.trim());$('client-access').value='';await load();});};
$('client-request-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{await request('/api/portal/requests','POST',{text:$('client-request').value,key:pendingKey});pendingKey=crypto.randomUUID();$('client-request').value='';await load();notice('Request received. You can leave this page; your quote or clarification will be here when you return.');});};
$('client-refresh').onclick=e=>busy(e.currentTarget,load);
$('client-forget').onclick=()=>{credential='';sessionStorage.removeItem('scope-client-portal');$('client-workspace').hidden=true;$('client-connect').hidden=false;};
if(location.hash){useAccess(location.hash.slice(1));history.replaceState(null,'',location.pathname);}
if(credential)load().catch(e=>notice(e.message,true));
setInterval(()=>{if(credential&&!document.hidden)load().catch(e=>notice(e.message,true));},5000);
