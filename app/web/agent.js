import {esc,money,when,busy,notice,icon} from './common.js';
const $=id=>document.getElementById(id);

// The agent's status strip and its settings panel. Requests and exceptions render on the designer's board via onView.
export function mountAgent({request,project,comments,onView=()=>{}}) {
  let current,hydrated=false,refreshing=false,alive=true;
  $('agent-panel').innerHTML=`<div class="agent-line"><h2>Your client agent</h2><span id="agent-state" class="status" data-tone="quiet">Not configured</span><p id="agent-summary" class="meta num"></p>
  <div class="row"><button id="agent-pause" type="button" class="secondary">${icon('pause')}Pause automation</button><button id="agent-refresh" type="button" class="quiet">${icon('refresh')}Refresh agent</button></div></div>
  <div id="agent-health" role="status"></div><div id="agent-deliveries" class="stack tight"></div>`;
  $('agent-config').innerHTML=`<details id="agent-settings" class="tool-panel" name="tools"><summary>Rates, limits and client access</summary><div class="panel-body">
  <div class="stack tight"><h2>Rates, limits and client access</h2><p class="muted">Set the boundaries once. Matching requests get a quote in the private client portal; exceptions come back to you. Client approval is always required before PayPal invoicing.</p></div>
  <div class="settings-grid"><form id="agent-policy-form" class="card stack">
  <fieldset><legend>Rates I approve for automatic quotes</legend><div id="agent-rates" class="stack tight">${project.rateCard.map(r=>`<label class="check"><input type="checkbox" name="agent-rate" value="${esc(r.id)}"><span>${esc(r.description)} · <span class="num">${money(r.unitAmountMinor)}</span> per unit</span></label>`).join('')}</div></fieldset>
  <div class="grid"><div class="field"><label for="agent-max-quote">Maximum per quote (USD)</label><input id="agent-max-quote" type="number" min="0.01" max="100000" step="0.01" value="250.00" required></div><div class="field"><label for="agent-max-total">Cumulative quote allowance (USD)</label><input id="agent-max-total" type="number" min="0.01" max="100000" step="0.01" value="500.00" required></div></div>
  <div class="field"><label for="agent-max-quantity">Maximum quantity per rate in one quote</label><input id="agent-max-quantity" type="number" min="1" max="100" value="1" required><p class="hint">These are synthetic demo examples until you approve them. Delivered quotes consume the cumulative allowance, even while unpaid. Editing a policy does not reset that allowance.</p></div>
  <fieldset><legend>Optional: watch this client's Figma comments</legend><p class="muted">Select the actual client authors. Only new threads after enabling are picked up. Portal requests work without a Figma account.</p><div id="agent-authors" class="stack tight"></div>
  <div class="field"><label for="agent-client-ids">Additional verified Figma user IDs, comma separated</label><input id="agent-client-ids" autocomplete="off" placeholder="Optional exact user IDs"><p class="hint">Use stable user IDs, not names or email addresses. Each author can belong to one active run.</p></div></fieldset>
  <label class="check"><input id="agent-figma-replies" type="checkbox"><span>Post quotes, clarification questions and Paid updates in their Figma thread. Anyone with file access can read these messages.</span></label>
  <label class="check"><input id="agent-reminders" type="checkbox"><span>Send PayPal sandbox invoice reminders after 24 hours unpaid, at most two reminders, at least 24 hours apart.</span></label>
  <label class="check consent"><input id="agent-consent" type="checkbox" required><span>I authorize automatic quotes using only these rates and limits, and the optional messages selected above. Anything outside them needs my review.</span></label>
  <div><button id="agent-save" type="submit">Approve &amp; enable agent</button></div></form>
  <section class="card stack"><h3>One private portal for your client</h3><p class="muted">Share this link privately once. Clients can request changes, answer questions, approve quotes and open PayPal checkout here.</p>
  <div><button id="agent-portal" class="secondary">Create private client link</button></div><div id="agent-portal-share" class="stack tight" hidden><div class="field"><label for="agent-portal-link">Private client portal link</label><div class="link-field"><input id="agent-portal-link" type="password" readonly autocomplete="off"><button id="agent-copy" class="secondary">${icon('copy')}Copy link</button></div></div><a id="agent-open" target="_blank" rel="noreferrer">Open client portal</a><small id="agent-portal-expiry"></small></div>
  <p class="meta">The agent runs on the server while Figma is closed. Figma comments are checked about once a minute, subject to provider limits. Automatic assessment uses the brief and request text; selected-frame assessment stays available under Assess a request.</p></section></div></div></details>`;

  const authors=[...new Map(comments.filter(c=>c.userId).map(c=>[c.userId,{id:c.userId,name:c.userHandle||c.userId}])).values()];
  $('agent-authors').innerHTML=authors.map(a=>`<label class="check"><input type="checkbox" name="agent-author" value="${esc(a.id)}"><span>${esc(a.name)} <small>(${esc(a.id)})</small></span></label>`).join('')||'<p class="meta">No comment authors loaded. Use the portal or enter a verified client ID.</p>';
  async function refresh() {
    if(refreshing || !alive)return;refreshing=true;
    try {
      const view=await request('/api/agent');if(!alive)return;current=view;
      const p=view.policy,enabled=p?.enabled && view.authorityValid;
      $('agent-state').textContent=enabled?'Running':p?.enabled?'Needs renewed approval':p?'Paused':'Not configured';
      $('agent-state').dataset.tone=enabled?'action':p?.enabled||!p?'attention':'quiet';
      $('agent-health').innerHTML=view.error?`<p class="notice error">${icon('error')}<span>${esc(view.error)}</span></p>`:'';
      $('agent-summary').textContent=p?`${money(view.quotedMinor)} quoted of ${money(p.maxTotalMinor)} authorized · Access ends ${when(p.expiresAt)}${view.portalReady?'':' · Share a client portal link to complete setup'}`:'Automation starts only after you approve a policy and share client access.';
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
      $('agent-deliveries').innerHTML=view.deliveries.filter(d=>!['sent','cancelled','handled'].includes(d.state)).map(d=>`<p class="meta">${esc(d.kind)} delivery: ${esc(d.state)}${d.error?' · '+esc(d.error):''}</p>`).join('');
      onView(view);
    } finally {refreshing=false;}
  }
  async function share() {
    if(current?.portalReady&&!confirm('Create replacement client access? The previously shared portal link will stop working.'))return;
    const link=await request('/api/agent/portal-access','POST',{});
    $('agent-portal-link').value=link.portalUrl;$('agent-open').href=link.portalUrl;$('agent-portal-expiry').textContent='Access ends '+when(link.expiresAt)+'. Keep this link private.';$('agent-portal-share').hidden=false;
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
