// Browser-only integration fixture: real app + SQLite, synthetic Figma/PayPal responses.
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isolatedApp, providerFixture } from './helpers.mjs';
const fixture = await isolatedApp();
const provider = providerFixture();
globalThis.fetch = async (url, init) => {
  if (new URL(url).hostname === 'api.figma.com') return new Response(JSON.stringify({ comments:[
    { id:'fixture-comment', message:'Can you add the mobile checkout?', user:{handle:'Demo client'}, parent_id:'', created_at:new Date().toISOString() },
  ] }));
  return provider.fetch(url,init);
};
for (const name of ['designer.html','review.html']) {
  const path=join(fixture.app,'web',name);
  const html=await readFile(path,'utf8');
  await writeFile(path,html.replaceAll('SANDBOX DEMO','BROWSER TEST FIXTURE').replaceAll('CLIENT REVIEW · SANDBOX','CLIENT REVIEW · TEST FIXTURE'));
}
const { config } = await fixture.load('env');
const { server } = await fixture.load('server');
if (!server.listening) await once(server,'listening');
config.publicUrl='http://127.0.0.1:'+server.address().port;
const { createInvitation } = await fixture.load('sessions');
const { db } = await fixture.load('db');
const invite=createInvitation({projectId:'demo',role:'designer'});
console.log(JSON.stringify({fixtureUrl:config.publicUrl+'/designer#'+invite.token, isolation:fixture.root}));
process.stdin.setEncoding('utf8');
process.stdin.on('data',text=> {
  if (text.trim()==='paid') { for(const invoice of provider.invoices.values()){ invoice.status='PAID'; invoice.due_amount.value='0.00'; } console.log('Synthetic provider invoices marked paid for browser refresh verification.'); }
  if(text.trim()==='close') server.close(()=>{db.close();process.exit(0)});
});
setTimeout(()=>server.close(()=>{db.close();process.exit(0)}),30*60_000).unref();
