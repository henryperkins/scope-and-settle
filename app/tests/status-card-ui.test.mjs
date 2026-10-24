import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {cardView} from './figma-card-fixture.mjs';

async function fixture(request) {
  const source = (await readFile(new URL('../web/status-cards.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('export function mountStatusCards', 'function mountStatusCards') + '\nglobalThis.create = mountStatusCards;';
  const elements = new Map(), posted = [];
  const element = id => elements.get(id) ?? elements.set(id, {textContent: '', innerHTML: '', append() {}, replaceChildren() {}}).get(id);
  const state = {session: {token: 'private-session-never-native', runId: 'run-one'}, project: {id: 'demo', figmaFileKey: 'test-file'}, fileKey: 'test-file', generation: 0, evidenceEpoch: 0};
  let onPost = () => {};
  const ctx = vm.createContext({document: {getElementById: element, createElement: () => ({append() {}})}, window: {SCOPE_SETTLE_API: 'https://fixture.test'}, location: {origin: 'https://fixture.test'}, URL, crypto: {randomUUID: () => 'opaque-invocation'}, setTimeout, clearTimeout, busy: async (_button, fn) => fn()});
  vm.runInContext(source, ctx);
  const ui = ctx.create({request, getContext: () => state, inPlugin: true, post: m => { posted.push(m); onPost(m); }});
  return {state, posted, ui, element, set onPost(fn) { onPost = fn; }};
}

test('T12b a held status read is discarded on session or selection invalidation without native writes or token disclosure', async () => {
  for (const changed of ['session', 'selection']) {
    let release; const f = await fixture(() => new Promise(r => release = r));
    try {
      const pending = f.ui.upsert({id: 'order-one', revision: 1});
      if (changed === 'session') f.state.session = {...f.state.session, token: 'replacement'};
      else f.state.generation++;
      f.ui.invalidate(); release(cardView()); assert.equal(await pending, null);
      assert.equal(f.posted.some(m => m.type === 'upsert-status-card'), false);
      assert.doesNotMatch(JSON.stringify(f.posted), /private-session|replacement/);
    } finally { f.ui.destroy(); }
  }
});

test('T12b stale native responses cannot complete a newer order invocation', async () => {
  const f = await fixture(async path => cardView(path.includes('order-two') ? {orderId: 'order-two', appUrl: 'https://fixture.test/designer?order=order-two&run=run-one'} : {}));
  try {
    const nextCommand = () => new Promise(resolve => { f.onPost = m => { if (m.type === 'upsert-status-card') resolve(m); }; });
    const onePosted = nextCommand(), one = f.ui.upsert({id: 'order-one', revision: 1}), command1 = await onePosted;
    const twoPosted = nextCommand(), two = f.ui.upsert({id: 'order-two', revision: 1}), command2 = await twoPosted;
    assert.equal(await one, null);
    f.ui.message({...command1, type: 'status-card-result', ok: true, nodeId: 'old-node'});
    f.ui.message({...command2, type: 'status-card-result', epoch: 'wrong-epoch', ok: true, nodeId: 'wrong-node'});
    f.ui.message({...command2, type: 'status-card-result', ok: true, nodeId: 'correct-node'});
    assert.equal((await two).nodeId, 'correct-node');
    assert.match(f.element('status-card-notice').textContent, /Cached status card updated/);
  } finally { f.ui.destroy(); }
});
