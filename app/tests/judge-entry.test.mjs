import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function judgeHarness({initial,renewError}={}) {
  const source=(await readFile(new URL('../web/judge.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/,'');
  const elements=new Map(),listeners={},calls=[];
  const element=id=>elements.get(id)||elements.set(id,{hidden:false,value:'',textContent:'',removeAttribute(name){delete this[name];},scrollIntoView(){}}).get(id);
  let stored=initial??JSON.stringify({role:'designer',token:'old',renewalCredential:'old-grant'});
  const context=vm.createContext({document:{getElementById:element},localStorage:{getItem:()=>stored,setItem:(key,value)=>stored=value},
    location:{hash:'',pathname:'/judge'},history:{replaceState(){}},URLSearchParams,Date,JSON,window:{addEventListener:(name,fn)=>listeners[name]=fn},
    api:async(path,token,method,body)=>{if(path==='/api/demo-info')return{figmaUrl:'https://www.figma.com/test',plugin:null};calls.push(body.credential);if(renewError)throw renewError;return{role:'designer',token:'new',renewalCredential:body.credential,accessExpiresAt:'2026-12-16T16:00:00Z'};},
    busy:async(button,action)=>action(),notice(){}
  });
  vm.runInContext(source,context);
  return {element,listeners,calls,setStored(value){stored=value;}};
}

test('judge entry resumes replacement access after reset in another tab and clears revoked access',async()=>{
  const {element,listeners,calls,setStored}=await judgeHarness();
  setStored(JSON.stringify({role:'designer',token:'new',renewalCredential:'replacement-grant'}));
  await element('resume').onclick({currentTarget:element('resume')});
  assert.deepEqual(calls,['replacement-grant']);assert.equal(element('designer-access').value,'resume=replacement-grant');
  setStored('null');listeners.storage({key:'scope-judge'});
  assert.equal(element('resume').hidden,true);assert.equal(element('access').hidden,true);assert.equal(element('designer-access').value,'');
});

test('judge entry offers resume only for saved access and follows cross-tab changes',async()=>{
  const {element,listeners,setStored}=await judgeHarness({initial:'null'});
  assert.equal(element('resume').hidden,true);
  assert.equal(element('saved-run').hidden,true);
  assert.equal(element('start').className,'');
  setStored(JSON.stringify({renewalCredential:'saved-grant'}));
  listeners.storage({key:'scope-judge'});
  assert.equal(element('resume').hidden,false);
  assert.equal(element('saved-run').hidden,false);
  assert.equal(element('start').className,'secondary');
  setStored('invalid JSON');listeners.focus();
  assert.equal(element('resume').hidden,true);
  assert.equal(element('start').className,'');
});

test('failed resume removes stale designer links and copied access',async()=>{
  const {element}=await judgeHarness({renewError:new Error('Access expired')});
  element('access').hidden=false;
  element('designer-access').value='resume=stale-grant';
  element('browser-designer').href='/designer#resume=stale-grant';
  await assert.rejects(element('resume').onclick({currentTarget:element('resume')}),/Access expired/);
  assert.equal(element('access').hidden,true);
  assert.equal(element('designer-access').value,'');
  assert.equal(element('browser-designer').href,undefined);
});
