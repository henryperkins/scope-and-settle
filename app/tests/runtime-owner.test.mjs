import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedApp} from './helpers.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createProductionEvaluator} from '../scripts/eval-assessments.mjs';

test('T13 server and evaluator cannot own the same database concurrently, and closing releases ownership', async () => {
  const app = await isolatedApp(), module = await app.load('runtimeOwner').catch(error => {if(error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;});
  assert.equal(typeof module.acquireRuntimeOwner, 'function', 'T13 requires a shared server/CLI runtime owner');
  const directory = await mkdtemp(join(tmpdir(), 'scope-runtime-')), path = join(directory, 'database.sqlite'); await writeFile(path, '');
  const first = await module.acquireRuntimeOwner(path);
  try {await assert.rejects(module.acquireRuntimeOwner(path), /runtime|owner|already/i);} finally {await first.release();}
  const second = await module.acquireRuntimeOwner(path); await second.release();
});

test('T13 OS ownership survives a second process and is released after owner process termination', async () => {
  const app=await isolatedApp(), module=await app.load('runtimeOwner'), path=join(app.root,'owned.sqlite');await writeFile(path,'');
  const url=pathToFileURL(join(app.app,'dist/backend/runtimeOwner.js')).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {acquireRuntimeOwner} from ${JSON.stringify(url)};await acquireRuntimeOwner(${JSON.stringify(path)});console.log('OWNED');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  try {
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Fixture owner exited before acquiring');})]);
    await assert.rejects(module.acquireRuntimeOwner(path),/runtime|owner|already/i);
  }finally{const ended=once(child,'exit');child.kill();await ended;}
  const replacement=await module.acquireRuntimeOwner(path);await replacement.release();
});

test('T13 a listening HTTP server excludes the evaluator and closes before evaluation can acquire its database', async () => {
  const app=await isolatedApp(), {server}=await app.load('server');
  if(!server.listening)await once(server,'listening');
  try {await assert.rejects(createProductionEvaluator({load:app.load,evidenceMode:'synthetic_provider_fixture'}),/runtime|owner|already/i);}
  finally {await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));}
  const evaluator=await createProductionEvaluator({load:app.load,evidenceMode:'synthetic_provider_fixture'});await evaluator.close();evaluator.db.close();
});
