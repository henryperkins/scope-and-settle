import {esc,busy,notice} from './common.js';
const $=id=>document.getElementById(id);
const OPERATIONS={get_project_scope:'Read project scope, rates and approved changes',assess_change_request:'Run paid assessments of Figma comments',draft_change_order:'Draft change orders from reviewed items',get_payment_status:'Read approval and payment status',submit_for_client_approval:'Prepare proposal submission for designer review (opt-in)',issue_approved_invoice:'Prepare approved invoice issuance for designer review (opt-in)'};
const DEFAULT_OPERATIONS=new Set(['get_project_scope','assess_change_request','draft_change_order','get_payment_status']);
const STATUS={active:'Active',expired:'Expired',revoked:'Revoked',inactive:'Inactive (server disabled or access ended)'};
const usd=micro=>'$'+(micro/1e6).toFixed(2);
/** Designer-only connector credentials: issue (secret shown once), list status and usage, revoke. */
export function mountConnectors({request}){
 let alive=true;
 const inPlugin=!!window.SCOPE_SETTLE_API;
 $('connector-panel').innerHTML=`<h2>Figma agent connector</h2><p>Let Figma's agent read this run's scope and payment status, run paid assessments and draft change orders within limits you set. It can never submit, approve, invoice or send anything; you review every draft.</p>
 <div id="connector-state" role="status" aria-live="polite"></div>
 <form id="connector-form" method="post" action="/api/connectors" hidden><fieldset><legend>Issue a connector credential</legend>
 ${Object.entries(OPERATIONS).map(([op,text])=>`<label class="check"><input type="checkbox" name="operations" value="${esc(op)}"${DEFAULT_OPERATIONS.has(op)?' checked':''}><span>${esc(text)}</span></label>`).join('')}
 <label for="connector-expiry">Expires after (minutes, at most 60)</label><input id="connector-expiry" name="expiresInMinutes" type="number" min="1" max="60" step="1" value="60" required>
 <label for="connector-assessments">Maximum paid assessments</label><input id="connector-assessments" name="maxAssessments" type="number" min="0" max="20" step="1" value="2" required>
 <label for="connector-spend">Maximum model spend (USD)</label><input id="connector-spend" name="maxCost" type="number" min="0" max="25" step="0.01" value="1.50" required><small id="connector-estimate"></small>
 <label class="check consent"><input id="connector-consent" type="checkbox" required><span>I authorize only the operations and limits selected here for this run. Revoking or resetting ends it.</span></label>
 <button id="connector-issue" type="submit">Issue connector credential</button></fieldset></form>
 <div id="connector-secret" hidden></div><div id="connector-list"></div>`;
 function showSecret(secret,connector){
  const box=$('connector-secret');box.hidden=false;
  box.innerHTML=`<div class="notice" role="alert"><p><strong>Copy this credential now. It is shown only once and cannot be recovered.</strong> Paste it only into Figma's private connector header setting; never share it in comments, files or chat. It expires ${esc(new Date(connector.expiresAt).toLocaleString())}. Revoke it if it is exposed.</p>
  <label for="connector-secret-value">Connector credential</label><input id="connector-secret-value" class="link-value" readonly autocomplete="off" spellcheck="false">
  <div class="row"><button id="connector-copy" type="button" class="secondary">Copy credential</button><button id="connector-hide" type="button" class="secondary">I saved it, hide</button></div></div>`;
  $('connector-secret-value').value=secret;
  $('connector-copy').onclick=e=>busy(e.currentTarget,async()=>{await navigator.clipboard.writeText(secret);notice('Connector credential copied. It will not be shown again.');});
  $('connector-hide').onclick=()=>{box.hidden=true;box.innerHTML='';};
  $('connector-secret-value').focus();
 }
 async function refresh(){
  const view=await request('/api/connectors');if(!alive)return;
  $('connector-state').innerHTML=!view.enabled?'<p class="notice" data-connector-disabled>The Figma agent connector is disabled on this server. No credential can be issued or used until the operator sets MCP_CONNECTOR_ENABLED=true.</p>':
   inPlugin?'<p class="notice">Issue connector credentials from the designer page in your browser, not inside the plugin.</p>':'';
  $('connector-form').hidden=!view.enabled||inPlugin;
  $('connector-estimate').textContent=`Each paid assessment reserves up to ${usd(view.assessmentReservationMicroUsd)} until its actual usage is known. The global $25 development cap still applies.`;
  $('connector-list').innerHTML=view.connectors.length?'<h3>Issued connector credentials</h3>'+view.connectors.map(c=>`<article class="card" data-connector="${esc(c.id)}"><p><strong data-connector-status>${esc(STATUS[c.status]??c.status)}</strong> &middot; Credential ${esc(c.id.slice(0,8))} &middot; ${c.status==='revoked'?'revoked '+esc(new Date(c.revokedAt).toLocaleString()):'expires '+esc(new Date(c.expiresAt).toLocaleString())}</p><p>${c.operations.map(op=>esc(OPERATIONS[op]??op)).join(' &middot; ')}</p><p>Paid assessments ${c.assessmentsUsed} of ${c.maxAssessments} &middot; Spend ${usd(c.costSettledMicroUsd)} settled, ${usd(c.costHeldMicroUsd)} held, limit ${usd(c.maxCostMicroUsd)}</p>${c.status==='active'||c.status==='inactive'?`<button type="button" class="secondary danger" data-connector-revoke="${esc(c.id)}">Revoke credential</button>`:''}</article>`).join(''):'<p class="muted">No connector credentials issued for this run.</p>';
  $('connector-list').querySelectorAll('[data-connector-revoke]').forEach(button=>button.onclick=()=>busy(button,async()=>{await request('/api/connectors/'+encodeURIComponent(button.dataset.connectorRevoke)+'/revoke','POST',{consent:true});notice('Connector credential revoked. Any connector using it is now refused.');await refresh();}));
 }
 $('connector-form').onsubmit=e=>{e.preventDefault();busy($('connector-issue'),async()=>{
  const operations=Array.from($('connector-form').querySelectorAll('input[name=operations]:checked'),input=>input.value);
  const issued=await request('/api/connectors','POST',{consent:$('connector-consent').checked,operations,expiresInMinutes:Number($('connector-expiry').value),maxAssessments:Number($('connector-assessments').value),maxCostMicroUsd:Math.round(Number($('connector-spend').value)*1e6)});
  if(!alive)return;$('connector-consent').checked=false;showSecret(issued.secret,issued.connector);await refresh();
 });};
 return {refresh,destroy(){alive=false;}};
}
