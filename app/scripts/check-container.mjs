// Local Docker smoke test. Uses only disposable data and placeholder credentials.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

/** The lockfile's production closure: direct runtime dependencies and every package they reach. */
function productionClosure(text) {
  const lines = text.split(/\r?\n/), direct = new Map(), snapshots = new Map();
  let section = null, pending = null;
  for (let i = lines.indexOf('importers:') + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
    const line = lines[i];
    if (/^ {4}(?! )\S/.test(line)) { section = line.trim().replace(/:$/, ''); continue; }
    const name = line.match(/^ {6}(?! )'?([^':]+)'?:$/), version = line.match(/^ {8}version: (\S+)$/);
    if (section === 'dependencies' && name) pending = name[1];
    else if (section === 'dependencies' && version && pending) { direct.set(pending, version[1].replace(/\(.*$/, '')); pending = null; }
  }
  let key = null, inDependencies = false;
  for (let i = lines.indexOf('snapshots:') + 1; i < lines.length; i++) {
    const line = lines[i], entry = line.match(/^ {2}(?! )'?(.+?)'?:(?: \{\})?$/);
    if (entry) { key = entry[1].replace(/\(.*$/, ''); snapshots.set(key, []); inDependencies = false; continue; }
    if (/^ {4}(?! )\S/.test(line)) { inDependencies = /^ {4}(dependencies|optionalDependencies):$/.test(line); continue; }
    const dependency = line.match(/^ {6}(?! )'?([^':]+)'?: (\S+)$/);
    if (inDependencies && key && dependency) snapshots.get(key).push(dependency[1] + '@' + dependency[2].replace(/\(.*$/, ''));
  }
  const closure = new Set(), queue = [...direct].map(([name, version]) => name + '@' + version);
  while (queue.length) { const id = queue.pop(); if (closure.has(id)) continue; closure.add(id); queue.push(...(snapshots.get(id) ?? [])); }
  return { direct: [...direct.keys()].sort(), closure: [...closure].sort() };
}
const lock = productionClosure(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.deepEqual(lock.direct, Object.keys(manifest.dependencies ?? {}).sort(), 'Lockfile importer must match package.json dependencies');
// Inside the container: top-level links and every real package (name@version) in pnpm's virtual store.
const MODULES = `const fs=await import('node:fs'),path=await import('node:path');const root='./node_modules';
const names=dir=>fs.readdirSync(dir).flatMap(n=>n.startsWith('@')?fs.readdirSync(path.join(dir,n)).map(m=>n+'/'+m):[n]);
const top=fs.existsSync(root)?names(root).filter(n=>!n.startsWith('.')).sort():[];const installed=new Set();
const store=path.join(root,'.pnpm');if(fs.existsSync(store))for(const entry of fs.readdirSync(store)){const nm=path.join(store,entry,'node_modules');if(!fs.existsSync(nm))continue;
for(const n of names(nm)){const p=path.join(nm,n);if(fs.lstatSync(p).isSymbolicLink())continue;const pkg=JSON.parse(fs.readFileSync(path.join(p,'package.json'),'utf8'));installed.add(pkg.name+'@'+pkg.version);}}
console.log(JSON.stringify({top,installed:[...installed].sort()}));`;

const suffix = randomUUID().slice(0, 8);
const name = 'scope-settle-smoke-' + suffix;
const volume = name + '-data';
const image = process.argv[2] || 'scope-and-settle:local';
const checks = [];
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed');
  return result.stdout.trim();
}
function exec(code) { return docker(['exec', name, 'node', '--input-type=module', '-e', code]); }
async function start() {
  docker(['run', '--detach', '--name', name, '--publish', '127.0.0.1::8787', '--volume', volume + ':/var/data',
    '--env', 'PAYPAL_CLIENT_ID=test-only', '--env', 'PAYPAL_CLIENT_SECRET=test-only',
    '--env', 'FIGMA_PERSONAL_ACCESS_TOKEN=test-only', '--env', 'FIGMA_FILE_KEY=test-file', image]);
  const port = docker(['port', name, '8787/tcp']).split(':').pop();
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base + '/health')).ok) return base; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Container did not become reachable');
}
try {
  let base = await start();
  assert.equal((await fetch(base + '/api/project')).status, 401);
  checks.push('Anonymous access rejected');
  // The connector's SDK loaded at startup; the route stays absent while MCP_CONNECTOR_ENABLED is unset.
  assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 404);
  checks.push('Application starts with its runtime dependencies; the disabled /mcp connector answers 404');
  const session = JSON.parse(exec("const {createSession}=await import('./dist/backend/sessions.js');console.log(JSON.stringify(createSession({projectId:'demo',role:'designer'})))"));
  const headers = { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' };
  const response = await fetch(base + '/api/change-orders', { method: 'POST', headers, body: JSON.stringify({
    title: 'Container persistence check', currency: 'USD', deliverables: ['Synthetic mobile layout'],
    lineItems: [{ rateCardId: 'mobile_checkout', priceSource: 'rate_card', quantity: 1 }],
  }) });
  assert.equal(response.status, 201);
  const order = await response.json();
  exec("const {aiBudget}=await import('./dist/backend/aiBudget.js');aiBudget.reserve(100000).release(100000)");
  docker(['stop', name]);
  docker(['rm', name]);
  base = await start();
  const restored = await fetch(base + '/api/change-orders/' + order.id, { headers });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).totalMinor, 25000);
  checks.push('Session and order survive container replacement on the same volume');
  const budget = await (await fetch(base + '/api/ai-budget', { headers })).json();
  assert.equal(budget.spentMicroUsd, 100000);
  checks.push('AI budget ledger survives container replacement');
  const footprint = JSON.parse(exec("const fs=await import('node:fs');console.log(JSON.stringify({uid:process.getuid(),localEnv:fs.existsSync('../.env.local'),devData:fs.existsSync('./data')}))"));
  assert.notEqual(footprint.uid, 0);
  assert.equal(footprint.localEnv || footprint.devData, false);
  checks.push('Non-root runtime contains no local environment file or developer data');
  const modules = JSON.parse(exec(MODULES));
  assert.deepEqual(modules.top, lock.direct);
  assert.deepEqual(modules.installed, lock.closure);
  for (const name of Object.keys(manifest.devDependencies ?? {})) assert.ok(!modules.installed.some(id => id.startsWith(name + '@')), name);
  footprint.dependencies = modules.installed;
  checks.push(`Runtime node_modules is exactly the lockfile production closure (${lock.closure.length} packages), with no devDependencies`);
  const dir = resolve('../output/container');
  await mkdir(dir, { recursive: true });
  const report = { at: new Date().toISOString(), image, imageId: docker(['image', 'inspect', '--format', '{{.Id}}', image]),
    providerTraffic: 'none; placeholder credentials only', checks, footprint };
  await writeFile(resolve(dir, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  // Exact unique test resources only; never prune unrelated images/volumes.
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', windowsHide: true });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore', windowsHide: true });
}
