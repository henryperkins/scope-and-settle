import {esc,money,label,busy,notice} from './common.js';
const $=id=>document.getElementById(id);
const stateLabel=value=>({queued:'Queued',processing:'Assessing',quoted:'Quote delivered',needs_clarification:'Waiting for client',included:'Included work',exception:'Needs your review',paid:'Paid',dismissed:'Handled directly'}[value]||label(value));

export function mountAgent({request,project,comments,onReview}) {
  let current,hydrated=false,refreshing=false,alive=true;
  $('agent-panel').innerHTML=`<div class="row between"><div><div class="eyebrow">Your client agent</div><h2>Approved rates. Automatic quotes.</h2></div><span id="agent-state" class="badge">Not configured</span></div>
  <p class="muted">Set the boundaries once. Matching requests get a quote in the private client portal; exceptions come back to you. Client approval is always required before PayPal invoicing.</p>
  <div id="agent-health" role="status"></div><div id="agent-summary" class="agent-summary"></div>
  <details id="agent-settings"><summary>Rates, limits and client access</summary><form id="agent-policy-form">
  <fieldset><legend>Rates I approve for automatic quotes</legend><div id="agent-rates">${project.rateCard.map(r=>`<label class="check"><input type="checkbox" name="agent-rate" value="${esc(r.id)}"> <span>${esc(r.description)} · ${money(r.unitAmountMinor)} per unit</span></label>`).join('')}</div></fieldset>
  <div class="grid"><div><label for="agent-max-quote">Maximum per quote (USD)</label><input id="agent-max-quote" type="number" min="0.01" max="100000" step="0.01" value="250.00" required></div><div><label for="agent-max-total">Cumulative quote allowance (USD)</label><input id="agent-max-total" type="number" min="0.01" max="100000" step="0.01" value="500.00" required></div></div>
  <label for="agent-max-quantity">Maximum quantity per rate in one quote</label><input id="agent-max-quantity" type="number" min="1" max="100" value="1" required>
  <p class="muted">These are synthetic demo examples until you approve them. Delivered quotes consume the cumulative allowance, even while unpaid. Editing a policy does not reset that allowance.</p>
  <fieldset><legend>Optional: watch this client's Figma comments</legend><p class="muted">Select the actual client authors. Only new threads after enabling are picked up. Portal requests work without a Figma account.</p><div id="agent-authors"></div>
  <label for="agent-client-ids">Additional verified Figma user IDs, comma separated</label><input id="agent-client-ids" autocomplete="off" placeholder="Optional exact user IDs"><small>Use stable user IDs, not names or email addresses. Each author can belong to one active run.</small></fieldset>
  <label class="check"><input id="agent-figma-replies" type="checkbox"><span>Post quotes, clarification questions and Paid updates in their Figma thread. Anyone with file access can read these messages.</span></label>
  <label class="check"><input id="agent-reminders" type="checkbox"><span>Send PayPal sandbox invoice reminders after 24 hours unpaid, at most two reminders, at least 24 hours apart.</span></label>
  <label class="check consent"><input id="agent-consent" type="checkbox" required><span>I authorize automatic quotes using only these rates and limits, and the optional messages selected above. Anything outside them needs my review.</span></label>
  <div class="row"><button id="agent-save" type="submit">Approve & enable agent</button><button id="agent-pause" type="button" class="secondary">Pause automation</button></div></form>
  <hr><h3>One private portal for your client</h3><p class="muted">Share this link privately once. Clients can request changes, answer questions, approve quotes and open PayPal checkout here.</p>
  <button id="agent-portal" class="secondary">Create private client link</button><div id="agent-portal-share" hidden><label for="agent-portal-link">Private client portal link</label><input id="agent-portal-link" type="password" readonly autocomplete="off"><div class="row"><button id="agent-copy" class="secondary">Copy link</button><a id="agent-open" target="_blank" rel="noreferrer">Open client portal</a></div><small id="agent-portal-expiry"></small></div>
  <p class="muted">The agent runs on the server while Figma is closed. Figma comments are checked about once a minute, subject to provider limits. Automatic assessment uses the brief and request text; selected-frame assessment remains available below.</p></details>
  <div class="row between"><h3>Only exceptions need you</h3><button id="agent-refresh" class="secondary">Refresh agent</button></div><div id="agent-exceptions"></div>
  <details><summary id="agent-activity-title">Client activity</summary><div id="agent-activity"></div><div id="agent-deliveries"></div></details>`;

  const authors=[...new Map(comments.filter(c=>c.userId).map(c=>[c.userId,{id:c.userId,name:c.userHandle||c.userId}])).values()];
  $('agent-authors').innerHTML=authors.map(a=>`<label class="check"><input type="checkbox" name="agent-author" value="${esc(a.id)}"><span>${esc(a.name)} <small>(${esc(a.id)})</small></span></label>`).join('')||'<p class="muted">No comment authors loaded. Use the portal or enter a verified client ID.</p>';
  async function refresh() {
    if(refreshing || !alive)return;refreshing=true;
    try {
      const view=await request('/api/agent');if(!alive)return;current=view;
      const p=view.policy,enabled=p?.enabled && view.authorityValid;
      $('agent-state').textContent=enabled?'Running':p?.enabled?'Needs renewed approval':p?'Paused':'Not configured';
      $('agent-state').className='badge'+(p?.enabled&&!view.authorityValid?' warn':'');
      $('agent-health').innerHTML=view.error?`<p class="notice error">${esc(view.error)}</p>`:'';
      $('agent-summary').textContent=p?`${money(view.quotedMinor)} quoted of ${money(p.maxTotalMinor)} authorized · Access ends ${new Date(p.expiresAt).toLocaleString()}${view.portalReady?'':' · Share a client portal link to complete setup'}`:'Automation starts only after you approve a policy and share client access.';
      if(!hydrated) {
        if(p) {
          document.querySelectorAll('[name="agent-rate"]').forEach(el=>el.checked=p.allowedRateIds.includes(el.value));
          $('agent-max-quote').value=(p.maxQuoteMinor/100).toFixed(2);$('agent-max-total').value=(p.maxTotalMinor/100).toFixed(2);$('agent-max-quantity').value=p.maxQuantity;
          document.querySelectorAll('[name="agent-author"]').forEach(el=>el.checked=p.figmaClientIds.includes(el.value));
          $('agent-client-ids').value=p.figmaClientIds.filter(id=>!authors.some(a=>a.id===id)).join(', ');
          $('agent-figma-replies').checked=p.figmaReplies;$('agent-reminders').checked=p.paypalReminders;
        } else {document.querySelector('[name="agent-rate"]')?.setAttribute('checked','');$('agent-settings').open=true;}
        hydrated=true;
      }
      $('agent-pause').disabled=!enabled;$('agent-portal').disabled=!p||!view.authorityValid;
      const exceptions=view.requests.filter(r=>r.state==='exception');
      $('agent-exceptions').innerHTML=exceptions.map(r=>`<article class="card exception"><h3>${esc(r.text)}</h3><p>${esc(r.exception)}</p><details><summary>Request conversation</summary>${r.messages.map(m=>`<p><strong>${esc(m.actor)}:</strong> ${esc(m.body)}</p>`).join('')}</details><div class="row"><button data-agent-review="${esc(r.id)}">Review exception</button>${!r.order_id?`<button class="secondary" data-agent-action="retry" data-id="${esc(r.id)}">Retry within policy</button>`:''}<button class="secondary" data-agent-action="dismiss" data-id="${esc(r.id)}">I'll handle this directly</button></div></article>`).join('')||'<p class="empty">No exceptions waiting for you.</p>';
      $('agent-activity-title').textContent=`Client activity (${view.requests.length})`;
      $('agent-activity').innerHTML=view.requests.filter(r=>r.state!=='exception').map(r=>`<article class="card"><span class="badge">${esc(stateLabel(r.state))}</span><p>${esc(r.text)}</p>${r.quoted_minor?`<small>${money(r.quoted_minor)} committed · Quote revision ${r.quote_revision}</small>`:''}${r.messages.filter(m=>m.actor!=='client').slice(-1).map(m=>`<p class="muted">${esc(m.body)}</p>`).join('')}</article>`).join('')||'<p class="muted">New client requests will appear here.</p>';
      $('agent-deliveries').innerHTML=view.deliveries.filter(d=>!['sent','cancelled'].includes(d.state)).map(d=>`<p class="muted">${esc(d.kind)} delivery: ${esc(d.state)}${d.error?' · '+esc(d.error):''}</p>`).join('');
      document.querySelectorAll('[data-agent-review]').forEach(b=>b.onclick=()=>busy(b,()=>onReview(view.requests.find(r=>r.id===b.dataset.agentReview))));
      document.querySelectorAll('[data-agent-action]').forEach(b=>b.onclick=()=>busy(b,async()=>{await request('/api/agent/requests/'+b.dataset.id+'/'+b.dataset.agentAction,'POST',{});await refresh();}));
    } finally {refreshing=false;}
  }
  async function share() {
    if(current?.portalReady&&!confirm('Create replacement client access? The previously shared portal link will stop working.'))return;
    const link=await request('/api/agent/portal-access','POST',{});
    $('agent-portal-link').value=link.portalUrl;$('agent-open').href=link.portalUrl;$('agent-portal-expiry').textContent='Access ends '+new Date(link.expiresAt).toLocaleString()+'. Keep this link private.';$('agent-portal-share').hidden=false;
    await refresh();
  }
  $('agent-policy-form').onsubmit=e=>{e.preventDefault();void busy($('agent-save'),async()=>{
    const checked=name=>Array.from(document.querySelectorAll(`[name="${name}"]:checked`),el=>el.value);
    await request('/api/agent/policy','POST',{enabled:true,consent:$('agent-consent').checked,allowedRateIds:checked('agent-rate'),
      maxQuoteMinor:Math.round(Number($('agent-max-quote').value)*100),maxTotalMinor:Math.round(Number($('agent-max-total').value)*100),maxQuantity:Number($('agent-max-quantity').value),
      figmaClientIds:[...new Set([...checked('agent-author'),...$('agent-client-ids').value.split(',').map(s=>s.trim()).filter(Boolean)])],figmaReplies:$('agent-figma-replies').checked,paypalReminders:$('agent-reminders').checked});
    $('agent-consent').checked=false;await refresh();if(!current.portalReady)await share();notice('Agent enabled. Share the private portal link once; matching requests will receive quotes automatically.');
  });};
  $('agent-pause').onclick=e=>busy(e.currentTarget,async()=>{await request('/api/agent/policy','POST',{enabled:false});await refresh();notice('Automation paused. Published quotes remain available for client review.');});
  $('agent-portal').onclick=e=>busy(e.currentTarget,share);
  $('agent-copy').onclick=e=>busy(e.currentTarget,async()=>{try{await navigator.clipboard.writeText($('agent-portal-link').value);notice('Private portal link copied.');}catch{$('agent-portal-link').type='text';$('agent-portal-link').select();notice('Select and copy the private portal link.');}});
  $('agent-refresh').onclick=e=>busy(e.currentTarget,refresh);
  const timer=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},10000);
  return {refresh,destroy(){alive=false;clearInterval(timer);}};
}
