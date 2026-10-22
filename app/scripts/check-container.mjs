// Local Docker smoke test. Uses only disposable data and placeholder credentials.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

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
  const footprint = JSON.parse(exec("const fs=await import('node:fs');console.log(JSON.stringify({uid:process.getuid(),localEnv:fs.existsSync('../.env.local'),devData:fs.existsSync('./data'),dependencies:fs.existsSync('./node_modules')}))"));
  assert.notEqual(footprint.uid, 0);
  assert.equal(footprint.localEnv || footprint.devData || footprint.dependencies, false);
  checks.push('Non-root runtime contains no local environment file, developer data or node_modules');
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
