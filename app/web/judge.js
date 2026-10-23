import {api, busy, notice} from './common.js';
const $=id=>document.getElementById(id);
let saved;
function syncSaved() {
  let current;
  try { current=JSON.parse(localStorage.getItem('scope-judge')||'null'); } catch {}
  if (current?.renewalCredential !== saved?.renewalCredential) {
    $('access').hidden=true; $('designer-access').value=''; $('browser-designer').removeAttribute('href');
  }
  saved=current;
  $('resume').hidden=!saved?.renewalCredential;
  $('saved-run').textContent=saved?.renewalCredential?'Only the run saved in this browser can be resumed here.':'';
}
syncSaved();
window.addEventListener('storage',event=>{if(event.key==='scope-judge'||event.key===null)syncSaved();});
window.addEventListener('focus',syncSaved);
async function show(session) {
  if(session.role!=='designer')throw new Error('This access does not grant the designer role.');
  saved=session;localStorage.setItem('scope-judge',JSON.stringify(session));
  const access='resume='+session.renewalCredential;
  $('designer-access').value=access;$('browser-designer').href='/designer#'+access;
  $('expiry').textContent='Access remains valid until '+new Date(session.accessExpiresAt).toLocaleString()+'. Ordinary sessions last up to one hour. Reset replaces this access.';
  $('access').hidden=false;$('resume').hidden=false;$('entry-code').value='';
  notice('Your demo is ready. Copy designer access to connect the plugin.');
  $('access').scrollIntoView({block:'start'});
}
$('entry-form').onsubmit=e=>{e.preventDefault();busy($('start'),async()=>show(await api('/api/judge/start',null,'POST',{credential:$('entry-code').value.trim()})));};
$('resume').onclick=e=>busy(e.currentTarget,async()=>{
  syncSaved();
  try{await show(await api('/api/session/renew',null,'POST',{credential:saved?.renewalCredential}));}
  catch(error){$('access').hidden=true;throw error;}
});
$('copy').onclick=e=>busy(e.currentTarget,async()=>{
  syncSaved();
  if($('access').hidden)throw new Error('Resume your current demo before copying its access.');
  try{await navigator.clipboard.writeText($('designer-access').value);notice('Private designer access copied.');}
  catch{$('designer-access').select();notice('Copy the selected private designer access.');}
});
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access')){$('entry-code').value=fragment.get('access');history.replaceState(null,'',location.pathname);}
api('/api/demo-info').then(info=>{
  $('figma-file').href=info.figmaUrl;
  $('artifact').textContent=info.plugin?'Plugin '+info.plugin.version+' · source '+info.plugin.sourceCommit.slice(0,12)+' · SHA-256 '+info.plugin.sha256:'The plugin package is not available on this deployment.';
  if(!info.plugin){$('download').removeAttribute('href');}
}).catch(error=>{$('artifact').textContent=error.message;});
