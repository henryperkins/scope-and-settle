import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('judge entry resumes replacement access after reset in another tab and clears revoked access',async()=>{
  const source=(await readFile(new URL('../web/judge.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/,'');
  const elements=new Map(),listeners={},calls=[];
  const element=id=>elements.get(id)||elements.set(id,{hidden:false,value:'',textContent:'',removeAttribute(){},scrollIntoView(){}}).get(id);
  let stored=JSON.stringify({role:'designer',token:'old',renewalCredential:'old-grant'});
  const context=vm.createContext({document:{getElementById:element},localStorage:{getItem:()=>stored,setItem:(key,value)=>stored=value},
    location:{hash:'',pathname:'/judge'},history:{replaceState(){}},URLSearchParams,Date,JSON,window:{addEventListener:(name,fn)=>listeners[name]=fn},
    api:async(path,token,method,body)=>{if(path==='/api/demo-info')return{figmaUrl:'https://www.figma.com/test',plugin:null};calls.push(body.credential);return{role:'designer',token:'new',renewalCredential:body.credential,accessExpiresAt:'2026-12-16T16:00:00Z'};},
    busy:async(button,action)=>action(),notice(){}
  });
  vm.runInContext(source,context);
  stored=JSON.stringify({role:'designer',token:'new',renewalCredential:'replacement-grant'});
  await element('resume').onclick({currentTarget:element('resume')});
  assert.deepEqual(calls,['replacement-grant']);assert.equal(element('designer-access').value,'resume=replacement-grant');
  stored='null';listeners.storage({key:'scope-judge'});
  assert.equal(element('resume').hidden,true);assert.equal(element('access').hidden,true);assert.equal(element('designer-access').value,'');
});
