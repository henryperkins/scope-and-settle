import { test, after } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { isolatedApp, providerFixture, draftInput } from './helpers.mjs';

const app = await isolatedApp();
const { db } = await app.load('db');
const orders = await app.load('orders');
const sessions = await app.load('sessions');
const originalFetch = globalThis.fetch;
const provider = providerFixture();
globalThis.fetch = (url, init) => new URL(url).hostname === '127.0.0.1' ? originalFetch(url, init) : provider.fetch(url, init);
const { server } = await app.load('server');
if (!server.listening) await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
after(async () => { await new Promise(r => server.close(r)); globalThis.fetch = originalFetch; db.close(); });

async function request(path, method = 'GET', token, body) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('the browser designer can load its Figma bridge module without a session', async () => {
  const response = await request('/assets/figma-bridge.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const module = await import('data:text/javascript;base64,' + Buffer.from(await response.text()).toString('base64'));
  assert.equal(typeof module.isFigmaPluginMessage, 'function');
});

test('anonymous callers cannot read private data or perform designer actions', async () => {
  for (const [path, method, body] of [
    ['/api/project', 'GET'], ['/api/comments', 'GET'], ['/api/change-orders', 'GET'], ['/api/ai-budget', 'GET'],
    ['/api/change-orders', 'POST', draftInput()], ['/api/project/scope', 'POST', { clauses: [{ id: 'x', text: 'x' }] }],
    ['/api/sessions', 'POST', { role: 'designer' }], ['/api/demo/reset', 'POST'],
  ]) assert.equal((await request(path, method, undefined, body)).status, 401, method + ' ' + path);
});

test('a client can read and approve only the linked revision and cannot mint designer sessions', async () => {
  const order = orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
  const other = orders.createChangeOrder(draftInput());
  const client = sessions.createSession({ projectId: 'demo', role: 'client', changeOrderId: order.id, changeOrderRevision: order.revision });
  assert.equal((await request('/api/change-orders/' + order.id, 'GET', client.token)).status, 200);
  assert.equal((await request('/api/change-orders/' + other.id, 'GET', client.token)).status, 403);
  assert.equal((await request('/api/sessions', 'POST', client.token, { role: 'designer' })).status, 403);
  assert.equal((await request('/api/demo/reset', 'POST', client.token)).status, 403);
  assert.equal((await request('/api/change-orders/' + order.id + '/approve', 'POST', client.token)).status, 200);
});

test('a designer can prepare a proposal but cannot impersonate client approval', async () => {
  const designer = sessions.createSession({ projectId: 'demo', role: 'designer' });
  const created = await request('/api/change-orders', 'POST', designer.token, draftInput());
  assert.equal(created.status, 201);
  const order = await created.json();
  assert.equal((await request('/api/change-orders/' + order.id + '/submit', 'POST', designer.token)).status, 200);
  assert.equal((await request('/api/change-orders/' + order.id + '/approve', 'POST', designer.token)).status, 403);
});

test('revoked and foreign-project sessions cannot read demo data', async () => {
  const revoked = sessions.createSession({ projectId: 'demo', role: 'designer' });
  sessions.revokeSession(revoked.token);
  assert.equal((await request('/api/project', 'GET', revoked.token)).status, 401);
  const foreign = sessions.createSession({ projectId: 'other-project', role: 'designer' });
  assert.equal((await request('/api/project', 'GET', foreign.token)).status, 403);
});

test('an invitation is redeemed once and yields a scoped session', async () => {
  const designer = sessions.createSession({ projectId: 'demo', role: 'designer' });
  const order = orders.createChangeOrder(draftInput());
  const submitted = await (await request('/api/change-orders/' + order.id + '/submit', 'POST', designer.token)).json();
  const invitation = new URL(submitted.approvalUrl).hash.slice(1);
  const redeemed = await request('/api/session/redeem', 'POST', undefined, { invitation });
  assert.equal(redeemed.status, 200);
  const session = await redeemed.json();
  assert.equal(session.role, 'client');
  assert.equal((await request('/api/change-orders/' + order.id, 'GET', session.token)).status, 200);
  assert.equal((await request('/api/session/redeem', 'POST', undefined, { invitation })).status, 401);
});

test('reset revokes old-run access and preserves provider invoice references', async () => {
  const designer = sessions.createSession({ projectId: 'demo', role: 'designer' });
  const order = orders.submitForApproval(orders.createChangeOrder(draftInput()).id);
  const client = sessions.createSession({ projectId: 'demo', role: 'client', changeOrderId: order.id, changeOrderRevision: order.revision });
  orders.approveChangeOrder(order.id, client);
  const invoiced = await orders.ensureInvoice(order.id);
  const reset = await request('/api/demo/reset', 'POST', designer.token);
  assert.equal(reset.status, 200);
  assert.equal((await request('/api/project', 'GET', designer.token)).status, 401);
  assert.equal((await request('/api/change-orders/' + order.id, 'GET', client.token)).status, 401);
  assert.equal(orders.isTombstonedInvoice(invoiced.paypalInvoiceId), true);
});

test('separate demo runs cannot list or mutate one another’s orders', async () => {
  const first = sessions.createSession({ projectId:'demo', role:'designer', runId:'first-run' });
  const second = sessions.createSession({ projectId:'demo', role:'designer', runId:'second-run' });
  const created = await (await request('/api/change-orders','POST',first.token,draftInput())).json();
  assert.equal(created.runId,'first-run');
  await request('/api/change-orders/'+created.id+'/submit','POST',first.token);
  const client = await (await request('/api/sessions','POST',first.token,{role:'client',changeOrderId:created.id})).json();
  assert.equal(client.runId,'first-run');
  assert.equal((await request('/api/change-orders/'+created.id,'GET',client.token)).status,200);
  assert.equal((await request('/api/change-orders/'+created.id,'PATCH',second.token,{title:'Changed'})).status,403);
  assert.equal((await (await request('/api/change-orders','GET',second.token)).json()).length,0);
  await request('/api/demo/reset','POST',second.token);
  const remaining = await (await request('/api/change-orders','GET',first.token)).json();
  assert.equal(remaining.length,1);
  assert.equal(remaining[0].id,created.id);
});
