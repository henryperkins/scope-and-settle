import {api,esc,money,when,label,notice,busy,itemRows,safeInvoice,icon,track} from './common.js';
const $=id=>document.getElementById(id);
let credential=sessionStorage.getItem('scope-client-portal')||'',pendingKey=crypto.randomUUID(),lastMarkup='',loading=false,view=null,autoOpened=false;
// Statement state that must survive the 5-second poll: open rows, checked consent, and what changed since it was last seen.
const open=new Set(),consented=new Set(),updated=new Set(),acted=new Set();let seen=readSeen(),shown={},arrived=new Set();
const stateLabel=value=>({queued:'Request received',processing:'Assessing your request',quoted:'Quote ready',needs_clarification:'Your answer is needed',included:'Covered by the brief',exception:'Your designer is reviewing this',dismissed:'Your designer is handling this directly',paid:'Paid'}[value]||label(value));
function readSeen(){try{return JSON.parse(localStorage.getItem('scope-client-seen')||'null');}catch{return null;}}
function saveSeen(){try{localStorage.setItem('scope-client-seen',JSON.stringify({...(seen||{}),...shown}));}catch{}}
const signature=r=>[r.state,r.order?.status,r.order?.paymentStatus,r.order?.revision,r.messages.length].join('|');
function useAccess(raw){const fragment=raw.includes('#')?raw.split('#').pop():raw;credential=fragment.startsWith('access=')?fragment.slice(7):fragment;sessionStorage.setItem('scope-client-portal',credential);lastMarkup='';autoOpened=false;for(const s of [open,consented,updated])s.clear();shown={};}
const request=(path,method,body)=>api(path,credential,method,body);
function stage(r){
 const o=r.order,s=r.state;
 if(s==='paid'||o?.status==='paid')return {step:4,done:true,label:'Paid',tone:'settled'};
 if(o&&s!=='exception'&&s!=='dismissed'){
  if(o.status==='awaiting_client_approval')return {step:3,label:'Quote ready',tone:'action'};
  if(o.status==='approved')return {step:4,label:label(o.status),tone:'attention'};
  if(['payment_review_required','partially_paid'].includes(o.paymentStatus))return {step:4,label:label(o.paymentStatus),tone:'attention'};
  if(o.status==='creating_invoice'||o.paymentStatus==='payment_pending')return {step:4,label:label(o.paymentStatus||o.status),tone:'working'};
  return {step:4,label:label(o.paymentStatus||o.status),tone:'action'};
 }
 if(s==='needs_clarification')return {step:2,label:stateLabel(s),tone:'action'};
 if(s==='included'||s==='dismissed')return {step:2,label:stateLabel(s),tone:'quiet',final:true};
 return {step:2,label:stateLabel(s),tone:s==='exception'?'waiting':'working'};
}
// Money decisions first, then questions, then work in progress, then settled or closed requests.
const rank=r=>{const s=stage(r);return s.tone==='attention'||(s.tone==='action'&&s.step>=3)?0:s.tone==='action'?1:s.done||s.tone==='quiet'?3:2;};
const lastFrom=r=>[...r.messages].reverse().find(m=>m.actor!=='client')?.body||'';
// The request text is the row's heading; its first message would only repeat it.
const said=r=>r.messages.filter((m,i)=>!(i===0&&m.actor==='client'&&m.body.trim()===r.text.trim()));
const noAmount=r=>({included:'No charge',needs_clarification:'Not priced yet',dismissed:'Not priced'}[r.state]||'Pending');
function actionText(r,s){if(s.label==='Quote ready')return 'Review &amp; approve';if(r.state==='needs_clarification')return 'Answer';if(s.done)return 'Receipt';if(s.step===4&&safeInvoice(r.order?.invoiceUrl))return 'Pay';return 'Details';}
const and=list=>list.length<3?list.join(' and '):list.slice(0,-1).join(', ')+' and '+list.at(-1);
function summary(requests){
 const approve=requests.filter(r=>stage(r).label==='Quote ready'),answer=requests.filter(r=>r.state==='needs_clarification'),due=requests.filter(r=>r.order?.status==='payment_due'),paid=requests.filter(r=>stage(r).done);
 const sum=(list,key='totalMinor')=>money(list.reduce((t,r)=>t+(r.order[key]??r.order.totalMinor),0));
 const needs=[];
 if(approve.length)needs.push(`${approve.length===1?'one quote':approve.length+' quotes'} for ${sum(approve)} ${approve.length===1?'is':'are'} waiting for your approval`);
 if(answer.length)needs.push(`${answer.length===1?'one question needs':answer.length+' questions need'} your answer`);
 if(due.length)needs.push(`${sum(due,'amountDueMinor')} is due through PayPal`);
 const head=needs.length?`<b>${esc(and(needs).replace(/^./,c=>c.toUpperCase()))}.</b>`:requests.length?'Nothing needs you right now.':'Ask for a change and it is checked against your agreed brief before any price.';
 return head+(paid.length?` You have paid ${sum(paid)} so far.`:'');
}
function quote(r,extra=''){
 const o=r.order,url=safeInvoice(o.invoiceUrl),needsApproval=o.status==='awaiting_client_approval'&&r.state!=='exception'&&r.state!=='dismissed';
 let act='';
 if(needsApproval)act+=`<form data-approve="${esc(r.id)}" data-revision="${o.revision}" class="stack tight"><label class="check consent"><input type="checkbox" required name="consent"${consented.has(r.id)?' checked':''}><span>I approve the exact deliverables and ${money(o.totalMinor)} total in revision ${o.revision}, and agree that work begins after payment.</span></label><button type="submit" class="full">Approve revision ${o.revision} &amp; prepare PayPal invoice</button></form>`;
 if(['approved','creating_invoice'].includes(o.status))act+=`<p class="notice attention">${icon('alert')}<span>Your approval is saved. Invoice setup needs recovery.</span></p><button data-recover="${esc(r.id)}" data-revision="${o.revision}" class="full">Retry payment setup</button>`;
 if(url)act+=`<div class="stack tight"><a class="button full" href="${esc(url)}" target="_blank" rel="noreferrer">${o.status==='paid'?'View PayPal receipt':'Pay with PayPal sandbox'}${icon('external')}<span class="visually-hidden">(opens in a new tab)</span></a><button class="secondary full" data-payment="${esc(r.id)}">Refresh payment</button></div>`;
 if(o.status==='paid')act+=`<p class="notice">${icon('check')}<span>PayPal confirms payment for this approved revision.</span></p>`;
 return `<div class="quote-layout"><div class="quote-terms"><p class="label">What will be delivered</p><ul class="deliverables">${o.deliverables.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>${itemRows(o.lineItems,o.currency)}<p><strong>Work begins after payment.</strong> Delivery timing requires agreement with your designer.</p>${extra}</div>
 <div class="decision"><div class="total-row"><span class="label">Total, revision ${o.revision}</span><span class="amount">${money(o.totalMinor,o.currency)}</span></div>${act}</div></div>`;
}
function detail(r){
 const messages=said(r),thread=`<div class="thread">${messages.map(m=>`<div class="msg${m.actor==='client'?' from-you':''}"><p class="who">${m.actor==='client'?'You':m.actor==='designer'?'Your designer':'Scope &amp; Settle'}</p><p>${esc(m.body)}</p></div>`).join('')}</div>`;
 const reply=r.state==='dismissed'?'':`<form class="reply" data-reply="${esc(r.id)}"><label for="reply-${esc(r.id)}">Your reply</label><textarea id="reply-${esc(r.id)}" maxlength="4000" required></textarea><div><button type="submit">Send reply</button></div><p class="hint">Changes after a quote go back to your designer; they do not silently change its price.</p></form>`;
 const later=reply?`<details><summary>Reply or clarify this request</summary>${reply}</details>`:'';
 if(r.order)return quote(r,(messages.length?`<details><summary>Conversation (${messages.length})</summary>${thread}</details>`:'')+later);
 return r.state==='needs_clarification'?thread+reply:thread+later;
}
function entry(r){
 const s=stage(r),o=r.order,isOpen=open.has(r.id),fresh=updated.has(r.id);
 const sub=o?`Revision ${o.revision} · ${esc(o.scopeRevisionId)}`:r.state==='needs_clarification'?esc(lastFrom(r)):`Sent ${esc(when(r.createdAt))}`;
 return `<article class="entry${isOpen?' open':''}${fresh?' updated':''}${arrived.has(r.id)?' arrived':''}"><div class="entry-row">
 <div class="entry-main"><h3>${esc(r.text)}</h3><p class="meta${r.state==='needs_clarification'&&!o?' question':''}">${fresh?'<span class="fresh">Updated since your last visit</span> · ':''}${sub}</p></div>
 <div class="entry-stage">${track(s.step,{done:s.done,tone:['working','attention'].includes(s.tone)?s.tone:'',final:s.final,mini:true})}${s.done?`<span class="status" data-tone="settled">${esc(s.label)}</span>`:`<span class="stage-label" data-tone="${s.tone}">${esc(s.label)}</span>`}</div>
 <div class="entry-amount">${o?money(o.totalMinor,o.currency):`<span class="muted">${noAmount(r)}</span>`}</div>
 <div class="entry-action"><button type="button" class="secondary" data-toggle="${esc(r.id)}" aria-expanded="${isOpen}" aria-controls="detail-${esc(r.id)}">${isOpen?'Hide':actionText(r,s)}</button></div>
 </div><div class="entry-detail" id="detail-${esc(r.id)}"${isOpen?'':' hidden'}>${detail(r)}</div></article>`;
}
function render(force=false){
 const requests=[...view.requests].sort((a,b)=>rank(a)-rank(b)||String(b.createdAt).localeCompare(String(a.createdAt)));
 arrived=new Set();
 for(const r of requests){const sig=signature(r);if(!acted.has(r.id)&&(shown[r.id]?shown[r.id]!==sig:seen?.[r.id]&&seen[r.id]!==sig)){arrived.add(r.id);updated.add(r.id);}shown[r.id]=sig;}
 acted.clear();
 if(!autoOpened){autoOpened=true;const first=requests.find(r=>rank(r)<=1);if(first)open.add(first.id);}
 $('client-summary').innerHTML=summary(requests);
 const markup=requests.map(entry).join('')||'<div class="empty"><strong>No requests yet</strong><span>Your requests and quotes will appear here.</span></div>';
 // Do not erase a client's text or checked consent during background polling.
 if(markup===lastMarkup||(!force&&document.querySelector('#client-requests :focus')))return;
 const focused=document.activeElement?.dataset?.toggle,drafts=new Map(Array.from(document.querySelectorAll('[data-reply]'),form=>[form.dataset.reply,form.querySelector('textarea').value]));
 $('client-requests').innerHTML=markup;lastMarkup=markup;
 document.querySelectorAll('[data-reply]').forEach(form=>{form.querySelector('textarea').value=drafts.get(form.dataset.reply)||'';let key=crypto.randomUUID();form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),async()=>{await request('/api/portal/requests/'+form.dataset.reply+'/reply','POST',{text:form.querySelector('textarea').value,key});key=crypto.randomUUID();form.reset();acted.add(form.dataset.reply);document.activeElement?.blur();await loadAfterAction();notice('Reply received.');});};});
 document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const id=b.dataset.toggle;if(open.has(id))open.delete(id);else{open.add(id);updated.delete(id);}render(true);});
 document.querySelectorAll('[data-approve]').forEach(form=>{const box=form.querySelector('[name="consent"]');box.onchange=()=>box.checked?consented.add(form.dataset.approve):consented.delete(form.dataset.approve);form.onsubmit=e=>{e.preventDefault();void busy(form.querySelector('button'),()=>approve(form.dataset.approve,Number(form.dataset.revision),box.checked));};});
 document.querySelectorAll('[data-recover]').forEach(b=>b.onclick=()=>busy(b,()=>approve(b.dataset.recover,Number(b.dataset.revision),true)));
 document.querySelectorAll('[data-payment]').forEach(b=>b.onclick=()=>busy(b,async()=>{await request('/api/portal/requests/'+b.dataset.payment+'/payment-status','POST',{});acted.add(b.dataset.payment);document.activeElement?.blur();await loadAfterAction();notice('Payment checked with PayPal.');}));
 if(focused)document.querySelector(`[data-toggle="${CSS.escape(focused)}"]`)?.focus();
}
async function load(){
 if(!credential||loading)return;loading=true;
 const forCredential=credential;
 try {
  const next=await request('/api/portal');if(credential!==forCredential)return;view=next;$('client-connect').hidden=true;$('client-workspace').hidden=false;$('client-project').textContent=view.projectName;
  $('client-request-form').hidden=!view.acceptingRequests;$('client-paused').hidden=view.acceptingRequests;$('client-expiry').textContent='Private access ends '+when(view.expiresAt)+'.';
  render();
 }catch(error){if(credential!==forCredential)return;if(error.status===401){$('client-workspace').hidden=true;$('client-connect').hidden=false;}throw error;}finally{loading=false;}
}
async function loadAfterAction(){lastMarkup='';await load();}
async function approve(id,revision,consent){const result=await request('/api/portal/requests/'+id+'/approve','POST',{revision,consent});acted.add(id);consented.delete(id);document.activeElement?.blur();await loadAfterAction();notice(result.invoiceError||'Approval saved. Open PayPal to complete the sandbox payment.',!!result.invoiceError);}
$('client-connect-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{useAccess($('client-access').value.trim());$('client-connect-form').reset();await load();});};
$('client-request-form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{await request('/api/portal/requests','POST',{text:$('client-request').value,key:pendingKey});pendingKey=crypto.randomUUID();$('client-request-form').reset();await load();notice('Request received. You can leave this page; your quote or clarification will be here when you return.');});};
$('client-refresh').onclick=e=>busy(e.currentTarget,load);
$('client-forget').onclick=()=>{saveSeen();credential='';sessionStorage.removeItem('scope-client-portal');$('client-workspace').hidden=true;$('client-connect').hidden=false;};
addEventListener('pagehide',saveSeen);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveSeen();});
if(location.hash){useAccess(location.hash.slice(1));history.replaceState(null,'',location.pathname);}
if(credential)load().catch(e=>notice(e.message,true));
setInterval(()=>{if(credential&&!document.hidden)load().catch(e=>notice(e.message,true));},5000);
