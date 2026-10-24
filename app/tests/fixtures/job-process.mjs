import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {once} from 'node:events';
const [app,mode,invoiceFile,eventId]=process.argv.slice(2);
const invoice=JSON.parse(await readFile(invoiceFile,'utf8'));
process.env.AGENT_WORKER_DISABLED='true';process.env.JOB_WORKER_DISABLED=mode==='accept' || mode==='claim'?'true':'false';
process.env.SCOPE_SETTLE_DATA_DIR=join(app,'data');process.env.PORT='0';process.env.HOST='127.0.0.1';
let reads=0,forbidden=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url);if(u.hostname==='127.0.0.1')return realFetch(url,init);
 if(u.hostname!=='api-m.sandbox.paypal.com'){forbidden++;throw new Error('Unexpected provider');}
 if(u.pathname==='/v1/oauth2/token')return Response.json({access_token:'fixture-token',expires_in:3600});
 if(u.pathname.includes('verify-webhook-signature'))return Response.json({verification_status:'SUCCESS'});
 if(u.pathname===`/v2/invoicing/invoices/${invoice.id}` && (!init.method || init.method==='GET')){
   reads++;if(mode==='claim'){process.send({barrier:'claimed',reads,forbidden});await new Promise(()=>{});}
   return Response.json(invoice);
 }
 forbidden++;throw new Error('Forbidden invoice/AI side effect');
};
const load=name=>import(pathToFileURL(join(app,'dist/backend',name+'.js')).href);
const {server}=await load('server');if(!server.listening)await once(server,'listening');
const {db}=await load('db');
if(mode==='accept' || mode==='claim'){
 const response=await fetch(`http://127.0.0.1:${server.address().port}/webhooks/paypal`,{method:'POST',headers:{'Content-Type':'application/json','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/test','paypal-transmission-id':'restart','paypal-transmission-sig':'fixture','paypal-transmission-time':new Date().toISOString()},body:JSON.stringify({id:eventId,event_type:'INVOICING.INVOICE.PAID',resource:{invoice:{id:invoice.id}}})});
 const state=await response.json();
 if(mode==='accept')process.send({barrier:'accepted',state,reads,forbidden});
 else void (await load('jobs')).runDueJobs(new Date());
}else{
 const start=Date.now();const timer=setInterval(()=>{
  const r=db.prepare('SELECT state FROM webhook_receipts WHERE id=?').get(eventId);
  if(r?.state==='reconciled' || Date.now()-start>2500){clearInterval(timer);process.send({barrier:'restarted',state:r?.state,reads,forbidden});server.close(()=>{db.close();process.disconnect();});}
 },20);
}
