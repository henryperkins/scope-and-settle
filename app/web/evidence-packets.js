import {base,busy,notice,esc} from './common.js';
export function evidencePacketControls(order){return order.approvalStatus==='approved'?`<details data-evidence-order="${esc(order.id)}"><summary>Factual evidence export</summary><p>Create a point-in-time packet for this order. Supplied statements, recorded decisions and provider observations retain their provenance. Pixel bytes and private links are omitted.</p><button type="button" data-build-packet="${esc(order.id)}">Build evidence packet</button><div data-packet-preview></div></details>`:'';}
export function bindEvidencePackets(root,request,getSession){
 root.querySelectorAll('[data-build-packet]').forEach(button=>button.onclick=()=>busy(button,async()=>{
  const initial=getSession(),owner=initial?.grantId??initial?.token,runId=initial?.runId;
  const current=()=>{const s=getSession();return s?.runId===runId&&(s?.grantId??s?.token)===owner&&s?.role==='designer'&&button.isConnected;};
  const packet=await request('/api/change-orders/'+encodeURIComponent(button.dataset.buildPacket)+'/evidence-packets','POST',{});if(!current())return;
  const box=button.parentElement.querySelector('[data-packet-preview]');box.replaceChildren();
  const heading=document.createElement('h4');heading.textContent='Evidence packet · Revision '+packet.revision;box.appendChild(heading);
  const description=document.createElement('p');description.textContent='Created '+new Date(packet.createdAt).toLocaleString()+'. '+packet.gaps.length+' missing-evidence notices. Redaction '+(packet.redaction.applied?'applied':'policy checked')+'. Inspect the preview before sharing a downloaded copy.';box.appendChild(description);
  const preview=document.createElement('iframe');preview.title='Factual evidence packet preview';preview.setAttribute('sandbox','');preview.referrerPolicy='no-referrer';preview.style.cssText='width:100%;height:560px;border:1px solid #a9bfbd;border-radius:6px';preview.srcdoc=packet.previewHtml;box.appendChild(preview);
  const list=document.createElement('ul');for(const entry of packet.manifest.files){const li=document.createElement('li');li.style.overflowWrap='anywhere';li.textContent=entry.name+' · SHA-256 '+entry.sha256;list.appendChild(li);}box.appendChild(list);
  const actions=document.createElement('div');actions.className='row';
  for(const [name,label] of [['packet.json','Download evidence JSON'],['packet.html','Download portable HTML'],['manifest.json','Download digest manifest']]){
   const download=document.createElement('button');download.type='button';download.className='secondary';download.textContent=label;
   download.onclick=()=>busy(download,async()=>{
    await request('/api/session');if(!current())return;
    const path='/api/evidence-packets/'+encodeURIComponent(packet.id)+'/files/'+name;
    const fetchFile=()=>fetch(base+path,{headers:{Authorization:'Bearer '+getSession().token}});
    let response=await fetchFile();if(response.status===401){await request('/api/session');if(!current())return;response=await fetchFile();}
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Evidence download failed ('+response.status+')');}
    const bytes=await response.arrayBuffer();if(!current())return;
    const expected=packet.manifest.files.find(e=>e.name===name);if(expected){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==expected.sha256||bytes.byteLength!==expected.bytes)throw new Error('Evidence download differs from the displayed digest manifest');}
    if(!current())return;const blob=new Blob([bytes],{type:name.endsWith('.html')?'text/html':'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='scope-settle-'+packet.id+'-'+name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Evidence download verified. This packet is a snapshot of stored facts.');
   });actions.appendChild(download);
  }
  box.appendChild(actions);notice('Evidence packet created. Review its provenance, gaps and redactions before sharing.');
 }));
}
