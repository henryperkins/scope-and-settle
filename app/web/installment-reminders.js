import {esc,money,busy,notice} from './common.js';

export function installmentReminderControls(order){
 if(order.approvalStatus!=='approved'||!order.installments?.some(m=>!m.legacy))return '';
 return `<div class="notice" data-reminder-policy="${esc(order.id)}"><p role="status">Loading installment reminder policy…</p></div>`;
}
const details=p=>`<p>Notify ${p.recipients.primary.map(esc).join(', ')} for merchant ${esc(p.recipients.merchant)}. Policy expires ${esc(new Date(p.expiresAt).toLocaleString())}.</p>
 <p>At least 24 hours after the later due trigger and known invoice issue, and between reminder attempts. At most two automatic reminders per invoice across all policy renewals. Delivery remains unverified.</p>
 <ul>${p.installments.map(m=>`<li><strong>${esc(m.title)} · ${money(m.amountMinor,m.currency)}</strong> — ${m.covered?'Included in this review':'No reminder authorized in this policy'}.
 <small style="display:block;overflow-wrap:anywhere">Installment ${esc(m.milestoneId)} · Record ${esc(m.invoiceRecordId)}</small>
 <small>${m.automaticAttempts} of 2 automatic attempts used.${m.earliestReminderAt?' Earliest reminder '+esc(new Date(m.earliestReminderAt).toLocaleString())+'.':''}${m.actionBlocked?' An invoice action is in progress, uncertain or awaiting provider backoff.':''}</small></li>`).join('')}</ul>`;

/** All consent stays in the scoped designer application; this module never sends a provider notification. */
export function bindInstallmentReminders(root,orders,request){
 for(const box of root.querySelectorAll('[data-reminder-policy]')){
  const order=orders.find(o=>o.id===box.dataset.reminderPolicy);let current=null;
  const alive=()=>box.isConnected;
  const focus=()=>box.querySelector('h4')?.focus();
  async function refresh(){const policy=await request('/api/change-orders/'+encodeURIComponent(order.id)+'/installment-reminder-policy');if(alive()){current=policy;render();}}
  function render(){
   if(!alive())return;
   box.innerHTML=`<h4 tabindex="-1">Automatic installment reminders</h4><p role="status">${current?'Policy '+esc(current.status)+', version '+current.version+'.':'Off. Manual reminders remain available.'}</p>
   ${current?details(current):''}${current?.lastResult?`<p role="status">${esc(current.lastResult.message)}<br><small style="overflow-wrap:anywhere">Policy version ${esc(current.lastResult.policyVersion)} · ${esc(current.lastResult.policyId)}<br>Record ${esc(current.lastResult.invoiceRecordId)}${current.lastResult.attemptedAt?' · '+esc(new Date(current.lastResult.attemptedAt).toLocaleString()):''}</small></p>`:''}
   <div class="row"><button type="button" class="secondary" data-reminder-review>Review automatic reminders</button><button type="button" class="secondary" data-reminder-refresh>Refresh reminder status</button>${current?.status==='active'?'<button type="button" class="secondary" data-reminder-pause>Pause automatic reminders</button>':''}</div>`;
   box.querySelector('[data-reminder-refresh]').onclick=e=>busy(e.currentTarget,refresh);
   const pause=box.querySelector('[data-reminder-pause]');if(pause)pause.onclick=e=>busy(e.currentTarget,async()=>{const value=await request('/api/installment-reminder-policies/'+encodeURIComponent(current.id)+'/pause','POST',{expectedVersion:current.version});if(alive()){current=value;render();focus();notice('Automatic installment reminders paused.');}});
   box.querySelector('[data-reminder-review]').onclick=e=>busy(e.currentTarget,async()=>{
    const p=await request('/api/change-orders/'+encodeURIComponent(order.id)+'/installment-reminder-policy/prepare','POST',{expectedRevision:order.revision});if(!alive())return;
    box.innerHTML=`<h4 tabindex="-1">Review automatic installment reminders</h4>${details(p)}<p>Only the included issued, fully unpaid invoices are authorized. New invoice associations require a fresh review. This review expires ${esc(new Date(p.reviewExpiresAt).toLocaleString())}.</p>
    <form data-reminder-consent-form><label class="check consent"><input type="checkbox" required data-reminder-consent><span>I reviewed the included installments, recipients, expiry and shared limits and authorize automatic reminders.</span></label><div class="row"><button type="submit">Allow automatic reminders</button><button type="button" class="secondary" data-reminder-cancel>Cancel reminder review</button></div></form>`;
    focus();box.querySelector('[data-reminder-cancel]').onclick=()=>{render();focus();};
    box.querySelector('form').onsubmit=event=>{event.preventDefault();const consent=box.querySelector('[data-reminder-consent]').checked;void busy(event.submitter,async()=>{
     const value=await request('/api/installment-reminder-policies/'+encodeURIComponent(p.id)+'/confirm','POST',{previewHash:p.previewHash,consent});if(alive()){current=value;render();focus();notice('Automatic reminders authorized only for the reviewed installment invoices.');}
    });};
   });
  }
  void refresh().catch(error=>{if(alive())box.innerHTML=`<p role="alert">${esc(error.message)}</p>`;});
 }
}
