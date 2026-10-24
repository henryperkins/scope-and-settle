import {esc,busy,notice} from './common.js';
export function deliveryControls(order){
 if(order.approvalStatus!=='approved'||!order.installments?.length)return '';
 const targets=order.installments.filter(m=>m.dueTrigger==='delivery_acceptance'),milestones=targets.length?targets:[order.installments[0]];
 return `<details data-delivery-order="${esc(order.id)}"><summary>Approved work and delivery</summary><p>Starting refreshes the agreed payment prerequisites. A delivery balance is due after its approved acceptance trigger.</p>${milestones.map(m=>`<form data-start-work="${esc(m.id)}"><label><input name="consent" type="checkbox" required> I authorize starting the approved work for ${esc(m.title)} in a dedicated draft area.</label><button type="submit">Start approved work</button></form>`).join('')}<button type="button" class="secondary" data-load-delivery="${esc(order.id)}">Show existing delivery briefs</button><div data-delivery-results></div></details>`;
}
export function mountDelivery({request,inPlugin,post,getContext,onChanged}){
 let alive=true,epoch=null,pending=null;
 const signature=()=>{const c=getContext();return JSON.stringify([c.session?.token,c.session?.runId,c.project?.id,c.fileKey,c.generation,c.evidenceEpoch]);};
 function invalidate(){post({type:'delivery-context',context:null});epoch=null;if(pending){clearTimeout(pending.timeout);pending.resolve(null);pending=null;}}
 function destroy(){invalidate();alive=false;}
 function message(msg){if(msg.type!=='delivery-result'||!pending||msg.invocationId!==pending.id||msg.epoch!==epoch||msg.runId!==pending.run.id||pending.signature!==signature())return;const p=pending;pending=null;clearTimeout(p.timeout);p.resolve(msg);}
 async function show(box,run){
  if(!alive)return;const b=run.brief;
  box.innerHTML=`<section data-delivery-run="${esc(run.id)}"><h4>Draft work brief · Revision ${run.revision}</h4>${run.financialReviewRequired?'<p class="notice error">Payment condition needs financial review. Existing draft history is retained.</p>':''}<p>${esc(b.title)}</p><ul>${b.deliverables.map(d=>`<li>${esc(d)}</li>`).join('')}</ul><h4>Acceptance checklist</h4><ul>${b.acceptanceCriteria.map(d=>`<li>${esc(d)}</li>`).join('')}</ul><p>Allowed file: ${esc(b.allowedArea.fileKey)} · Dedicated page: ${esc(b.allowedArea.pageName)}</p><p>Paid condition checked: ${b.paymentCondition.observations.map(o=>esc(new Date(o.observedAt).toLocaleString())).join(', ')}</p><p>Draft scaffolds require designer refinement and review. Generation does not record client acceptance.</p>${inPlugin&&!run.financialReviewRequired?'<button type="button" data-generate-delivery>Create / read back draft in Figma</button>':'<p>Open this project in the connected Figma plugin to create or read back its standard draft area.</p>'}<p>Optional Specs, MCP generation, Code Layers and Code Connect are unavailable until actual access is verified.</p><div data-delivery-snapshot></div></section>`;
  if(run.latestSnapshot){const snapshot=await request('/api/delivery-snapshots/'+run.latestSnapshot.id);if(!alive||!box.isConnected)return;const target=box.querySelector('[data-delivery-snapshot]');if(target){target.innerHTML=`<h4>Draft review snapshot</h4><img alt="Draft output for designer review" style="max-width:100%;height:auto" src="${snapshot.imageDataUrl}"><p>Snapshot ${esc(snapshot.id)} · ${esc(snapshot.hash)}. Plugin node readback and pixels are client supplied; independent native verification is pending.</p>`;}}
  if(run.latestSnapshot){
   const target=box.querySelector('[data-delivery-snapshot]');
   target.insertAdjacentHTML('beforeend',run.deliveryReview?.state==='accepted'?'<p class="notice">This delivered version is accepted. Payment remains independent.</p>':`<form data-submit-delivery><label><input name="consent" type="checkbox" required> I reviewed this exact draft snapshot and checklist and authorize sharing it for client acceptance.</label><button type="submit">Submit delivery for client review</button></form>`);
   const submit=target.querySelector('[data-submit-delivery]');if(submit)submit.onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
    const result=await request('/api/milestones/'+run.milestoneId+'/submit-delivery','POST',{snapshotId:run.latestSnapshot.id,consent:submit.querySelector('[name="consent"]').checked});
    if(!alive||!box.isConnected)return;let share=target.querySelector('[data-delivery-share]');if(!share){share=document.createElement('div');share.dataset.deliveryShare='';target.appendChild(share);}
    share.innerHTML=`<p>Client review ${result.review.revision} · ${esc(result.review.snapshot.hash)}</p><label>Private delivery review link<input readonly value="${esc(result.deliveryUrl)}"></label><a href="${esc(result.deliveryUrl)}" target="_blank" rel="noreferrer">Open client delivery review</a>`;notice('Delivery snapshot submitted. Share this private link with the client.');
   });};
  }
  const generate=box.querySelector('[data-generate-delivery]');if(generate)generate.onclick=()=>busy(generate,()=>createDraft(box,run));
 }
 async function createDraft(box,run){
  invalidate();const c=getContext(),expected=signature();if(!inPlugin||c.fileKey!==run.brief.allowedArea.fileKey)throw new Error('Open the allowed Figma file before generating draft work.');
  epoch='draft-'+crypto.randomUUID();const id=epoch;post({type:'delivery-context',context:{epoch,fileKey:c.fileKey,projectId:c.project.id,runId:c.session.runId}});
  const current=await request('/api/milestones/'+run.milestoneId+'/start-work','POST',{consent:true});if(!alive||signature()!==expected||epoch!==id)return;
  const result=await new Promise(resolve=>{const timeout=setTimeout(()=>{if(pending?.id===id){invalidate();notice('Draft readback timed out. Inspect the dedicated page before trying again.',true);}},20000);pending={id,run:current,signature:expected,resolve,timeout};post({type:'generate-delivery',invocationId:id,epoch,run:current});});
  if(!alive||!result||signature()!==expected||epoch!==id)return;if(!result.ok)throw new Error(result.message);
  await request('/api/delivery-runs/'+current.id+'/output','POST',result.output);if(!alive||signature()!==expected)return;
  const updated=await request('/api/delivery-runs/'+current.id);if(!alive||signature()!==expected)return;await show(box,updated);notice('Draft output read back and saved for designer review. Client acceptance is still pending.');onChanged?.(updated);
 }
 function bind(root,orders){
  root.querySelectorAll('[data-start-work]').forEach(form=>form.onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{const before=signature(),run=await request('/api/milestones/'+form.dataset.startWork+'/start-work','POST',{consent:form.querySelector('[name="consent"]').checked});if(alive&&before===signature())await show(form.closest('details').querySelector('[data-delivery-results]'),run);});});
  root.querySelectorAll('[data-load-delivery]').forEach(b=>b.onclick=()=>busy(b,async()=>{const before=signature(),runs=await request('/api/change-orders/'+b.dataset.loadDelivery+'/deliveries'),box=b.closest('details').querySelector('[data-delivery-results]');if(!alive||before!==signature())return;box.innerHTML='';if(!runs.length)box.textContent='No work run has been started.';for(const run of runs){const section=document.createElement('div');box.appendChild(section);await show(section,run);}}));
 }
 return {bind,message,invalidate,destroy};
}
