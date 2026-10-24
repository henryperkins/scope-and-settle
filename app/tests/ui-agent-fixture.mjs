// Local UI walkthrough only. Every provider request is intercepted; no real keys,
// real messages, provider invoices or production ledger are used.
import {isolatedApp,providerFixture} from './helpers.mjs';
import {writeFile} from 'node:fs/promises';
const output=process.argv[2];if(!output)throw new Error('Provide a private output path');
const app=await isolatedApp();
process.env.PORT='8879';process.env.HOST='127.0.0.1';process.env.PUBLIC_BASE_URL='http://127.0.0.1:8879';process.env.AGENT_WORKER_DISABLED='false';
const {getProject,db}=await app.load('db');
const {createJudgeAccess,startJudgeRun}=await app.load('judging');
const provider=providerFixture(),comments=[{id:'comment-1',message:'Can you add the mobile checkout?',user:{id:'client-fixture',handle:'Synthetic client'},created_at:'2026-10-01T12:00:00Z'}];
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url);
 if(u.hostname==='api.figma.com')return Response.json({comments});
 if(u.hostname==='inference.baseten.co') {
  const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content[0].text),p=getProject();
  const clarify=input.comment.message.toLowerCase().includes('logo');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({classification:clarify?'needs_clarification':'new_work',explanation:'Mobile is outside the desktop-only brief.',evidence:[{clauseId:p.scopeClauses[0].id,quote:p.scopeClauses[0].text}],deliverables:clarify?[]:[p.rateCard[0].description],rates:clarify?[]:[{rateCardId:p.rateCard[0].id,quantity:1}],questions:clarify?['The approved rate card does not cover a logo. What deliverables should your designer price?']:[],designObservations:[],...(input.automation===false?{}:{automation:{allRequestsCovered:!clarify,unpricedComponents:clarify?['Logo']:[],coverage:clarify?[]:[{requestQuote:input.comment.message,deliverableIndex:0,rateCardId:p.rateCard[0].id,quantity:1}]}})})}}],usage:{prompt_tokens:100,completion_tokens:100}});
 }
 return provider.fetch(url,init);
};
const access=createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()}),owner=startJudgeRun(access.credential);
await writeFile(output,JSON.stringify({designerUrl:'http://127.0.0.1:8879/designer#resume='+owner.renewalCredential,root:app.root}),{mode:0o600});
const {server}=await app.load('server');
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
console.log('Local fixture ready on 127.0.0.1:8879; credentials saved privately. All providers are fixtures.');
