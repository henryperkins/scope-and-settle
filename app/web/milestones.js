import {esc,money,busy,notice} from './common.js';
function row(term,index,required){return `<fieldset data-term="${esc(term.id)}"><legend>Installment ${index+1}</legend><label>Title<input name="title" maxlength="200" required value="${esc(term.title)}"></label><label>Amount (USD)<input name="amount" type="number" step="0.01" min="0.01" required value="${(term.amountMinor/100).toFixed(2)}"></label><label>Due trigger<select name="trigger"><option value="proposal_approval" ${term.dueTrigger==='proposal_approval'?'selected':''}>Proposal approval</option><option value="delivery_acceptance" ${term.dueTrigger==='delivery_acceptance'?'selected':''}>Delivery acceptance</option></select></label><label>Acceptance criteria (one per line)<textarea name="criteria" required maxlength="20000">${esc(term.acceptanceCriteria.join('\n'))}</textarea></label><label><input type="checkbox" name="prerequisite" ${required?'checked':''}> Payment required before work starts</label><button type="button" class="secondary" data-remove>Remove installment</button></fieldset>`;}
export function installmentControls(o){
 if(['draft','awaiting_client_approval','needs_re_review'].includes(o.status))return `<details><summary>Edit payment schedule</summary><form data-schedule="${esc(o.id)}"><p>Amounts must total ${money(o.totalMinor,o.currency)}. Saving creates a new proposal revision and invalidates earlier approval links.</p><div data-terms>${o.milestoneSchedule.milestones.map((t,i)=>row(t,i,o.milestoneSchedule.workStartPaymentMilestoneIds.includes(t.id))).join('')}</div><button type="button" class="secondary" data-add>Add installment</button><button type="submit">Save payment schedule</button></form></details>`;
 if(!o.installments?.some(m=>!m.legacy))return '';
 return `<div>${o.installments.map(m=>`<div class="row"><strong>${esc(m.title)} · ${money(m.amountMinor,o.currency)}</strong>${!m.paypalInvoiceId?`<button data-milestone="${esc(m.id)}" data-kind="issue_approved_invoice" data-order="${esc(o.id)}">Review invoice for ${esc(m.title)}</button>`:m.financialState?.invoiceState==='payable'&&m.financialState.paymentState==='due'?`<button data-milestone="${esc(m.id)}" data-kind="remind_invoice" data-order="${esc(o.id)}">Review reminder</button><button class="secondary" data-milestone="${esc(m.id)}" data-kind="cancel_invoice" data-order="${esc(o.id)}">Review cancellation</button>`:''}</div>`).join('')}<div data-installment-review></div></div>`;
}
export function bindInstallments(root,orders,request,reload){
 root.querySelectorAll('[data-schedule]').forEach(form=>{
  const order=orders.find(o=>o.id===form.dataset.schedule),terms=form.querySelector('[data-terms]');
  const bindRemove=()=>terms.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>b.closest('fieldset').remove());bindRemove();
  form.querySelector('[data-add]').onclick=()=>{const n=terms.children.length;if(n>=12)throw new Error('At most 12 installments');terms.insertAdjacentHTML('beforeend',row({id:'stage_'+crypto.randomUUID().slice(0,8),title:'Delivery balance',amountMinor:15000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['Review the approved deliverables']},n,false));bindRemove();};
  form.onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
   const milestones=[],workStartPaymentMilestoneIds=[];
   for(const field of terms.querySelectorAll('fieldset')){const value=field.querySelector('[name="amount"]').value;if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error('Enter exact USD cents');const amountMinor=Math.round(Number(value)*100),id=field.dataset.term;
    milestones.push({id,title:field.querySelector('[name="title"]').value.trim(),amountMinor,dueTrigger:field.querySelector('[name="trigger"]').value,acceptanceCriteria:field.querySelector('[name="criteria"]').value.split('\n').map(s=>s.trim()).filter(Boolean)});if(field.querySelector('[name="prerequisite"]').checked)workStartPaymentMilestoneIds.push(id);
   }
   await request('/api/change-orders/'+order.id+'/milestone-schedule','POST',{expectedRevision:order.revision,schedule:{milestones,workStartPaymentMilestoneIds}});await reload();notice('Payment schedule saved as a new revision. Review its terms and submit it to the client.');
  });};
 });
 root.querySelectorAll('[data-milestone]').forEach(b=>b.onclick=()=>busy(b,async()=>{
  const order=orders.find(o=>o.id===b.dataset.order),p=await request('/api/installment-actions','POST',{kind:b.dataset.kind,milestoneId:b.dataset.milestone,expectedRevision:order.revision}),box=b.closest('article').querySelector('[data-installment-review]');
  box.innerHTML=`<form data-confirm-installment><h4>${esc(p.title)} · ${money(p.amountMinor,p.currency)}</h4><p>${esc(p.wording)}</p><p>Recipients: ${p.recipients.primary.concat(p.recipients.cc).map(esc).join(', ')}</p><label><input type="checkbox" required> I confirm this exact installment action.</label><button type="submit">Confirm installment action</button><p role="status"></p></form>`;
  box.querySelector('form').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
   const result=await request('/api/installment-actions/'+p.id+'/confirm','POST',{previewHash:p.previewHash,consent:box.querySelector('input').checked});notice(result.message,result.state!=='succeeded');
   if(result.state==='uncertain'){box.innerHTML='<p role="status">Outcome uncertain. Checking only; this action will not be resent.</p><button type="button">Check provider outcome</button>';box.querySelector('button').onclick=e=>busy(e.currentTarget,async()=>{const read=await request('/api/installment-actions/'+p.id+'/confirm','POST',{previewHash:p.previewHash,consent:true});notice(read.message);});}else await reload();
  });};
 }));
}
