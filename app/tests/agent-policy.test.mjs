import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedApp } from './helpers.mjs';
const app = await isolatedApp();
const { db, getProject, updateScopeBaseline } = await app.load('db');
const { createSession } = await app.load('sessions');
const { saveAgentPolicy, getAgentPolicy, activeAgentPolicy, evaluateAutoQuote:evaluate } = await app.load('agentPolicy');
const requestText='Can you add the mobile checkout?';
const evaluateAutoQuote=(...args)=>evaluate(...args,requestText);
after(() => db.close());
const owner = createSession({ projectId:'demo', role:'designer' });
const project = getProject();
const input = { enabled:true, consent:true, allowedRateIds:['mobile_checkout'], maxQuoteMinor:25000,
  maxTotalMinor:50000, maxQuantity:1, figmaClientIds:['client-1'], figmaReplies:false, paypalReminders:false };
const result = () => ({ classification:'new_work', explanation:'Mobile is excluded.',
  evidence:[{clauseId:'desktop-1', quote:project.scopeClauses[0].text}],
  deliverables:[project.rateCard[0].description], rates:[{rateCardId:'mobile_checkout',quantity:1}],
  questions:[], designObservations:[], lineItems:[], proposedTotalMinor:1,
  automation:{allRequestsCovered:true,unpricedComponents:[],coverage:[{requestQuote:requestText,deliverableIndex:0,rateCardId:'mobile_checkout',quantity:1}]} });

test('automation requires explicit policy approval; rate card and cumulative limits determine price', () => {
  assert.equal(getAgentPolicy(owner.runId), null);
  assert.throws(()=>saveAgentPolicy(owner,{...input,consent:false}), /consent/i);
  assert.throws(()=>saveAgentPolicy({...owner,role:'client'},input), /designer/i);
  const p=saveAgentPolicy(owner,input);
  assert.equal(p.version,1);
  const q=evaluateAutoQuote(project,result(),p,0);
  assert.equal(q.allowed,true); assert.equal(q.totalMinor,25000);
  assert.equal(evaluateAutoQuote(project,result(),p,25000).allowed,true);
  assert.equal(evaluateAutoQuote(project,result(),p,25001).allowed,false);
  assert.equal(evaluateAutoQuote(project,result(),{...p,maxQuoteMinor:24999},0).allowed,false);
});

test('unpriced extra deliverables, questions, invented terms and duplicate rates are exceptions', () => {
  const p=getAgentPolicy(owner.runId);
  for (const changes of [
    {deliverables:[project.rateCard[0].description,'Also design a logo']},
    {deliverables:['Mobile checkout plus unlimited revisions']},
    {questions:['When is it due?']}, {rates:[]},
    {rates:[{rateCardId:'unknown',quantity:1}]},
    {rates:[{rateCardId:'mobile_checkout',quantity:2}]},
    {rates:[{rateCardId:'mobile_checkout',quantity:1},{rateCardId:'mobile_checkout',quantity:1}],deliverables:[project.rateCard[0].description,project.rateCard[0].description]},
    {evidence:[]}, {evidence:[{clauseId:'desktop-1',quote:'invented'}]},
    {automation:undefined},
    {automation:{...result().automation,unpricedComponents:['Also create a logo']}},
    {automation:{...result().automation,coverage:[{requestQuote:requestText,deliverableIndex:0,rateCardId:'additional_onboarding_screen',quantity:1}]}},
    {automation:{...result().automation,coverage:[{requestQuote:'invented request',deliverableIndex:0,rateCardId:'mobile_checkout',quantity:1}]}},
  ]) assert.equal(evaluateAutoQuote(project,{...result(),...changes},p,0).allowed,false,JSON.stringify(changes));
});
test('coverage cannot omit a client addition or delivery constraint outside its cited substring',()=>{
  const p=getAgentPolicy(owner.runId);
  assert.equal(evaluate(project,result(),p,0,requestText+' Also design an original logo and deliver everything tomorrow.').allowed,false);
});

test('policy bounds, pause, expiry and changed scope fail closed', () => {
  for (const changes of [{maxQuoteMinor:0},{maxTotalMinor:24999},{maxQuantity:0},{allowedRateIds:['bogus']},{maxQuoteMinor:1.5}])
    assert.throws(()=>saveAgentPolicy(owner,{...input,...changes}),/Invalid/i);
  const paused=saveAgentPolicy(owner,{enabled:false});
  assert.equal(paused.enabled,false); assert.equal(activeAgentPolicy(owner.runId),null);
  const current=saveAgentPolicy(owner,input);
  assert.ok(activeAgentPolicy(owner.runId));
  assert.equal(evaluateAutoQuote(project,result(),{...current,expiresAt:'2020-01-01T00:00:00Z'},0).allowed,false);
  updateScopeBaseline([{id:'new',text:'Different agreement'}]);
  assert.equal(activeAgentPolicy(owner.runId),null);
});
