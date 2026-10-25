import {base,busy,notice,esc} from './common.js';

export function evidencePacketControls(order){
 return order.approvalStatus==='approved'
  ? `<details data-evidence-order="${esc(order.id)}" data-order-revision="${order.revision}"><summary>Factual evidence export</summary><p>Create a point-in-time packet for this order. Supplied statements, recorded decisions and provider observations retain their provenance. Metadata-only export is the default; pixel bytes and private links are omitted unless you preview and opt in to attach reviewed delivery images.</p><div class="row"><button type="button" data-build-packet="${esc(order.id)}">Build metadata packet</button><button type="button" class="secondary" data-review-packet-images="${esc(order.id)}">Review delivery images</button></div><div data-packet-images></div><div data-packet-preview></div></details>`
  : '';
}

function renderPacket(box,packet,request,getSession,current){
 box.replaceChildren();
 const heading=document.createElement('h4');
 heading.textContent='Evidence packet · Version '+packet.schemaVersion+' · Revision '+packet.revision;
 box.appendChild(heading);
 const imageNote=packet.schemaVersion===2&&Array.isArray(packet.attachedImages)
  ? packet.attachedImages.length+' reviewed delivery image(s) attached (client-supplied provenance; no automatic image redaction or independent verification). '
  : 'Pixel bytes omitted. ';
 const description=document.createElement('p');
 description.textContent='Created '+new Date(packet.createdAt).toLocaleString()+'. '+packet.gaps.length+' missing-evidence notices. Redaction '+(packet.redaction.applied?'applied':'policy checked')+'. '+imageNote+'Inspect the preview before sharing a downloaded copy.';
 box.appendChild(description);
 const preview=document.createElement('iframe');
 preview.title='Factual evidence packet preview';
 preview.setAttribute('sandbox','');
 preview.referrerPolicy='no-referrer';
 preview.style.cssText='width:100%;max-width:100%;height:560px;border:1px solid #a9bfbd;border-radius:6px;display:block';
 preview.srcdoc=packet.previewHtml;
 box.appendChild(preview);
 const list=document.createElement('ul');
 for(const entry of packet.manifest.files){
  const li=document.createElement('li');
  li.style.overflowWrap='anywhere';
  li.textContent=entry.name+' · '+entry.bytes+' bytes · SHA-256 '+entry.sha256;
  list.appendChild(li);
 }
 box.appendChild(list);
 const actions=document.createElement('div');
 actions.className='row';
 const downloads=[
  ['packet.json','Download evidence JSON'],
  ['packet.html','Download portable HTML'],
  ['manifest.json','Download digest manifest'],
  ...packet.manifest.files.filter(e=>e.mediaType==='image/png').map((e,index)=>[e.name,'Download image '+(index+1)+' (PNG)']),
 ];
 for(const [name,label] of downloads){
  const download=document.createElement('button');
  download.type='button';
  download.className='secondary';
  download.dataset.downloadPacketFile=name;
  download.textContent=label;
  download.onclick=()=>busy(download,async()=>{
   await request('/api/session');if(!current())return;
   const path='/api/evidence-packets/'+encodeURIComponent(packet.id)+'/files/'+name;
   const fetchFile=()=>fetch(base+path,{headers:{Authorization:'Bearer '+getSession().token}});
   let response=await fetchFile();
   if(response.status===401){await request('/api/session');if(!current())return;response=await fetchFile();}
   if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Evidence download failed ('+response.status+')');}
   const bytes=await response.arrayBuffer();if(!current())return;
   const expected=packet.manifest.files.find(e=>e.name===name);
   if(expected){
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==expected.sha256||bytes.byteLength!==expected.bytes)throw new Error('Evidence download differs from the displayed digest manifest');
   }
   if(!current())return;
   const mediaType=name.endsWith('.png')?'image/png':name.endsWith('.html')?'text/html':'application/json';
   const blob=new Blob([bytes],{type:mediaType}),url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='scope-settle-'+packet.id+'-'+name;link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   notice('Evidence download verified ('+name+'). This packet is a snapshot of stored facts.');
  });
  actions.appendChild(download);
 }
 box.appendChild(actions);
}

export function bindEvidencePackets(root,request,getSession){
 root.querySelectorAll('[data-build-packet]').forEach(button=>{
  const details=button.closest('[data-evidence-order]');
  const orderId=button.dataset.buildPacket;
  const previewBox=details.querySelector('[data-packet-preview]');
  const imagesBox=details.querySelector('[data-packet-images]');
  const reviewBtn=details.querySelector('[data-review-packet-images]');
  const makeGuard=()=>{
   const initial=getSession(),owner=initial?.grantId??initial?.token,runId=initial?.runId;
   return ()=>{const s=getSession();return s?.runId===runId&&(s?.grantId??s?.token)===owner&&s?.role==='designer'&&button.isConnected;};
  };
  button.onclick=()=>busy(button,async()=>{
   const current=makeGuard();
   const packet=await request('/api/change-orders/'+encodeURIComponent(orderId)+'/evidence-packets','POST',{});
   if(!current())return;
   renderPacket(previewBox,packet,request,getSession,current);
   notice('Evidence packet created. Review its provenance, gaps and redactions before sharing.');
  });
  if(reviewBtn){
   const loadChoices=async()=>{
    const current=makeGuard();
    const view=await request('/api/change-orders/'+encodeURIComponent(orderId)+'/evidence-packets/image-choices');
    if(!current())return;
    imagesBox.replaceChildren();
    if(!view.choices.length){
     const empty=document.createElement('p');
     empty.textContent='No submitted or accepted delivery reviews are available to attach yet. Use Build metadata packet.';
     imagesBox.appendChild(empty);
     return;
    }
    const intro=document.createElement('p');
    intro.textContent='Preview each current delivery snapshot before selecting it (at most 4 images, 1.5 MB each, 16 MiB total export). Client-supplied images are not independently verified or automatically redacted.';
    imagesBox.appendChild(intro);
    const previewed=new Set(),selected=new Map();
    const ackLabel=document.createElement('label');
    ackLabel.style.cssText='display:block;margin:8px 0;overflow-wrap:anywhere';
    const ackBox=document.createElement('input');
    ackBox.type='checkbox';
    ackBox.disabled=true;
    ackBox.dataset.ackPacketImages=orderId;
    ackLabel.append(ackBox,' I reviewed the selected delivery images and understand they retain client-supplied provenance without independent verification or automatic redaction.');
    const buildImagesBtn=document.createElement('button');
    buildImagesBtn.type='button';
    buildImagesBtn.disabled=true;
    buildImagesBtn.dataset.buildImagePacket=orderId;
    buildImagesBtn.textContent='Build packet with selected images';
    const sync=()=>{
     if(!current()){imagesBox.replaceChildren();return;}
     const ok=selected.size>=1&&selected.size<=4;
     ackBox.disabled=!ok;
     if(!ok)ackBox.checked=false;
     buildImagesBtn.disabled=!(ok&&ackBox.checked);
    };
    for(const choice of view.choices){
     const card=document.createElement('article');
     card.dataset.imageChoice=choice.reviewId;
     card.style.cssText='border:1px solid #ccd8d6;border-radius:6px;padding:10px;margin:8px 0';
     const statusText=choice.accepted
      ? 'Accepted delivery (review revision '+choice.reviewRevision+')'
      : 'Unaccepted draft (review revision '+choice.reviewRevision+', '+choice.state+') — not accepted by client';
     const meta=document.createElement('p');
     meta.style.overflowWrap='anywhere';
     meta.textContent=choice.milestoneTitle+' · '+statusText+' · Snapshot '+choice.snapshotId+' · PNG SHA-256 '+choice.imageHash+' ('+choice.imageBytes+' bytes, '+choice.pixelProvenance+')';
     card.appendChild(meta);
     if(choice.imageState==='available'){
      const previewHolder=document.createElement('div');
      previewHolder.dataset.choicePreview=choice.reviewId;
      const row=document.createElement('div');
      row.className='row';
      const previewBtn=document.createElement('button');
      previewBtn.type='button';
      previewBtn.className='secondary';
      previewBtn.dataset.previewChoice=choice.reviewId;
      previewBtn.textContent='Preview delivery image';
      const selectLabel=document.createElement('label');
      selectLabel.style.overflowWrap='anywhere';
      const selectBox=document.createElement('input');
      selectBox.type='checkbox';
      selectBox.disabled=true;
      selectBox.dataset.selectChoice=choice.reviewId;
      selectLabel.append(selectBox,' Attach this reviewed image');
      previewBtn.onclick=()=>busy(previewBtn,async()=>{
       if(!current()){imagesBox.replaceChildren();return;}
       const snap=await request(choice.previewPath);
       if(!current())return;
       if(snap.id!==choice.snapshotId||snap.hash!==choice.snapshotHash||snap.imageHash!==choice.imageHash||typeof snap.imageDataUrl!=='string'){
        await loadChoices();
        throw new Error('Delivery snapshot changed; preview the current delivery review again.');
       }
       previewHolder.replaceChildren();
       const img=document.createElement('img');
       img.src=snap.imageDataUrl;
       img.alt=choice.milestoneTitle+' snapshot '+choice.snapshotId;
       img.style.cssText='max-width:100%;height:auto;display:block;border:1px solid #a9bfbd;border-radius:6px;margin:8px 0';
       previewHolder.appendChild(img);
       previewed.add(choice.reviewId);
       selectBox.disabled=false;
       ackBox.checked=false;
       sync();
      });
      selectBox.onchange=()=>{
       if(!current()){imagesBox.replaceChildren();return;}
       if(selectBox.checked){
        if(!previewed.has(choice.reviewId)||selected.size>=4){
         selectBox.checked=false;
         if(selected.size>=4)notice('At most four reviewed delivery images may be attached.',true);
         return;
        }
        selected.set(choice.reviewId,{reviewId:choice.reviewId,reviewRevision:choice.reviewRevision,snapshotId:choice.snapshotId,snapshotHash:choice.snapshotHash});
       }else{
        selected.delete(choice.reviewId);
       }
       ackBox.checked=false;
       sync();
      };
      row.append(previewBtn,selectLabel);
      card.append(row,previewHolder);
     }else{
      const unavail=document.createElement('p');
      unavail.textContent='Image bytes unavailable; use metadata-only export.';
      card.appendChild(unavail);
     }
     imagesBox.appendChild(card);
    }
    ackBox.onchange=()=>sync();
    buildImagesBtn.onclick=()=>busy(buildImagesBtn,async()=>{
     if(!current()){imagesBox.replaceChildren();return;}
     try{
      const packet=await request('/api/change-orders/'+encodeURIComponent(orderId)+'/evidence-packets','POST',{
       expectedRevision:view.orderRevision,
       images:[...selected.values()],
       imagesReviewed:true,
      });
      if(!current())return;
      renderPacket(previewBox,packet,request,getSession,current);
      notice('Evidence packet with reviewed delivery images created. Review its provenance, gaps and redactions before sharing.');
     }catch(error){
      if(/stale|replaced|revision changed|does not match/i.test(error?.message??'')){
       await loadChoices().catch(()=>{});
      }
      throw error;
     }
    });
    imagesBox.append(ackLabel,buildImagesBtn);
   };
   reviewBtn.onclick=()=>busy(reviewBtn,loadChoices);
  }
 });
}
