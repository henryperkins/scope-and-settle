import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pluginFixture, cardView} from './figma-card-fixture.mjs';

const success = result => { assert.equal(result?.type, 'status-card-result', 'The real plugin must handle the card command'); assert.equal(result.ok, true, result.message); return result.nodeId; };
const failure = result => { assert.equal(result?.type, 'status-card-result'); assert.equal(result.ok, false); return result; };
const money = {currency: 'USD', totalMinor: 25000, amountDueMinor: 0, paidMinor: 25000, refundedMinor: 0};

test('T12b repeated and concurrent commands update one scoped card without touching selection or unrelated children', async () => {
  const f = await pluginFixture(), selection = f.page.selection;
  const id = success(await f.upsert());
  const node = f.nodes.get(id); node.x = 73; node.y = 91;
  const unrelated = f.make('TEXT'); unrelated.characters = 'Designer notes'; node.appendChild(unrelated);
  const newer = cardView({revision: 2, projectionVersion: 101, paymentState: 'refunded'});
  const results = await Promise.all([f.upsert(newer), f.upsert(newer)]);
  assert.deepEqual(results.map(success), [id, id]); assert.equal(f.cards().length, 1);
  assert.equal(node.x, 73); assert.equal(node.y, 91); assert.equal(f.page.selection, selection);
  assert.equal(unrelated.characters, 'Designer notes'); assert.equal(unrelated.parent, node);
  assert.match(f.text(node), /refunded/i); assert.match(f.text(node), /Delivery: Not recorded/);
  assert.match(f.text(node), /Cached snapshot/); assert.match(f.text(node), /2026-10-24T10:00:00/);
  assert.match(f.text(node), /2026-10-24T11:00:00/);
  failure(await f.upsert(cardView())); assert.equal(f.cards().length, 1);
});

test('T12b default-off money is absent from native surfaces and disabling removes previously displayed amounts', async () => {
  const f = await pluginFixture(), id = success(await f.upsert()), node = f.nodes.get(id);
  assert.doesNotMatch(JSON.stringify([...f.data]), /USD|25000|250\.00/); assert.doesNotMatch(f.text(node), /USD|25000|250\.00/);
  success(await f.upsert(cardView({projectionVersion: 101, displayPolicy: {version: 1, showAmounts: true}, money})));
  assert.match(f.text(node), /250\.00 USD/);
  success(await f.upsert(cardView({projectionVersion: 102, displayPolicy: {version: 2, showAmounts: false}})));
  assert.doesNotMatch(f.text(node), /USD|25000|250\.00/); assert.doesNotMatch(JSON.stringify([...f.data]), /USD|25000|250\.00/);
  failure(await f.upsert(cardView({projectionVersion: 103, displayPolicy: {version: 1, showAmounts: true}, money})));
  assert.doesNotMatch(f.text(node), /USD|25000|250\.00/);
});

test('T12b wrong file, scope identity, URL and malformed/redaction-breaking projections cause zero document writes', async () => {
  for (const override of [
    {fileKey: 'another-file'}, {projectId: 'another-project'}, {runId: 'another-run'}, {schemaVersion: 2},
    {appUrl: 'https://attacker.test/designer?order=order-one&run=run-one'},
    {appUrl: 'https://fixture.test/review#secret'}, {appUrl: 'https://user:secret@fixture.test/designer'},
    {appUrl: 'https://fixture.test/designer?order=order-one&run=run-one#resume=secret'},
    {money}, {title: 'Gallery costs USD 250.00'}, {secret: 'SENTINEL'}, {deliveryState: 'delivered'},
  ]) {
    const f = await pluginFixture(); failure(await f.upsert(cardView(override))); assert.equal(f.writes, 0, JSON.stringify(override));
  }
  const unsaved = await pluginFixture({fileKey: undefined});
  unsaved.figma.fileKey = undefined; failure(await unsaved.upsert()); assert.equal(unsaved.writes, 0);
});

test('T12b deleted mappings are replaced, exact orphan markers recover and ambiguous or foreign mappings fail safely', async () => {
  const f = await pluginFixture(), oldId = success(await f.upsert()); f.nodes.get(oldId).remove();
  const replacement = success(await f.upsert(cardView({projectionVersion: 101}))); assert.notEqual(replacement, oldId);
  // Preserve native node markers while losing only the document's private mapping.
  for (const key of f.root.getPluginDataKeys()) f.root.setPluginData(key, '');
  assert.equal(success(await f.upsert(cardView({projectionVersion: 102}))), replacement);
  const canonical = f.nodes.get(replacement), duplicate = f.make('FRAME'); f.page.appendChild(duplicate);
  for (const key of canonical.getPluginDataKeys()) duplicate.setPluginData(key, canonical.getPluginData(key));
  for (const key of f.root.getPluginDataKeys()) f.root.setPluginData(key, '');
  failure(await f.upsert(cardView({projectionVersion: 103}))); assert.equal(f.cards().length, 2);
  duplicate.remove(); success(await f.upsert(cardView({projectionVersion: 104})));
  for (const key of canonical.getPluginDataKeys()) canonical.setPluginData(key, '');
  failure(await f.upsert(cardView({projectionVersion: 105}))); assert.equal(canonical.removed, false);
});

test('T12b held font and mapped-node awaits reject context, selection and page changes before mutation', async () => {
  for (const change of ['context', 'selection', 'page']) {
    const f = await pluginFixture(); let release, entered;
    const started = new Promise(r => entered = r);
    f.fontHook = () => { entered(); return new Promise(r => release = r); };
    const pending = f.upsert();
    // The baseline has no command; make its failure a behavior assertion rather than a hanging fixture.
    await Promise.race([started, pending]); assert.equal(typeof release, 'function', 'Card font loading must be awaited');
    if (change === 'context') await f.figma.ui.onmessage({type: 'status-card-context', context: null});
    if (change === 'selection') { f.page.selection = [f.make('TEXT')]; f.events.selectionchange(); }
    if (change === 'page') { const page = f.make('PAGE', 'page-two'); page.selection = []; f.figma.currentPage = page; f.events.currentpagechange(); }
    release(); failure(await pending); assert.equal(f.writes, 0); assert.equal(f.cards().length, 0);
  }
  const f = await pluginFixture(), id = success(await f.upsert()); let release, entered;
  const started = new Promise(r => entered = r); f.nodeHook = () => { entered(); return new Promise(r => release = r); };
  const pending = f.upsert(cardView({projectionVersion: 101})); await started;
  await f.figma.ui.onmessage({type: 'status-card-context', context: {...f.ctx, epoch: 'replacement-session'}});
  release(); failure(await pending); assert.equal(f.cards().length, 1); assert.equal(f.nodes.get(id).removed, false);
});

test('T12b failed font or mapping writes produce no false success and preserve an existing card', async () => {
  const f = await pluginFixture(); f.fontFailure = true; failure(await f.upsert()); assert.equal(f.cards().length, 0);
  f.fontFailure = false; f.failMapping = true; failure(await f.upsert()); assert.equal(f.cards().length, 0);
  const id = success(await f.upsert()), original = f.text(f.nodes.get(id));
  f.failMapping = true;
  failure(await f.upsert(cardView({projectionVersion: 101, paymentState: 'refunded'})));
  assert.equal(f.nodes.get(id).removed, false); assert.equal(f.text(f.nodes.get(id)), original);
  assert.equal(success(await f.upsert(cardView({projectionVersion: 102}))), id);
});

test('T12b native card updates do not select nodes or disturb a held evidence export', async () => {
  const f = await pluginFixture(); let release;
  const frame = f.make('FRAME', 'design-frame'); frame.exportAsync = () => new Promise(r => release = r);
  f.page.selection = [frame];
  const pending = f.figma.ui.onmessage({type: 'export-frame', expectedFileKey: 'test-file', exportId: 'export-one', requestKey: 'request-one', generation: 0});
  success(await f.upsert()); assert.equal(f.page.selection[0], frame);
  release(Buffer.from('synthetic-image')); await pending;
  const exported = f.messages.find(m => m.type === 'frame'); assert.equal(exported?.exportId, 'export-one'); assert.equal(exported.requestKey, 'request-one');
});

test('T12b independent order mappings survive an overlapping lookup, another page and reopening', async () => {
  const f = await pluginFixture(), firstId = success(await f.upsert());
  let release, entered; const started = new Promise(r => entered = r);
  f.nodeHook = () => { entered(); return new Promise(r => release = r); };
  const held = f.upsert(cardView({projectionVersion: 101})); await started; f.nodeHook = null;
  const second = cardView({orderId: 'order-two', appUrl: 'https://fixture.test/designer?order=order-two&run=run-one'});
  const secondId = success(await f.upsert(second));
  const otherPage = f.make('PAGE', 'other-page'); otherPage.selection = []; otherPage.loadAsync = async () => {};
  f.root.appendChild(otherPage); otherPage.appendChild(f.nodes.get(secondId));
  release(); assert.equal(success(await held), firstId);
  assert.equal(success(await f.upsert({...second, projectionVersion: 102})), secondId, 'Another card update must not lose this cross-page mapping');
  await f.reopen();
  assert.equal(success(await f.upsert({...second, projectionVersion: 103})), secondId);
  assert.equal(f.cards().length, 2);
});

test('T12b equal order IDs in different project/run contexts stay distinct', async () => {
  const f = await pluginFixture(), first = success(await f.upsert());
  await f.figma.ui.onmessage({type: 'status-card-context', context: {...f.ctx, runId: 'run-two'}});
  const second = success(await f.upsert(cardView({runId: 'run-two', appUrl: 'https://fixture.test/designer?order=order-one&run=run-two'})));
  assert.notEqual(second, first);
  await f.figma.ui.onmessage({type: 'status-card-context', context: f.ctx});
  assert.equal(success(await f.upsert(cardView({projectionVersion: 101}))), first);
});

test('T12b a new card is placed outside the selected design frame without changing its parent or selection', async () => {
  const f = await pluginFixture(), design = f.make('FRAME', 'selected-design');
  design.x = 100; design.y = 40; design.width = 500; f.page.appendChild(design); f.page.selection = [design];
  const selected = f.page.selection, id = success(await f.upsert()), card = f.nodes.get(id);
  assert.ok(card.x >= 640, 'A new card must be placed beyond the selected design bounds');
  assert.equal(card.parent, f.page); assert.equal(f.page.selection, selected); assert.equal(design.x, 100); assert.equal(design.y, 40);
});

test('T12b monetary draft cards label the total as proposed rather than approved', async () => {
  const f = await pluginFixture();
  const view = cardView({approvalState: 'draft', invoiceState: 'none', paymentState: 'not_invoiced', paymentObservedAt: null, scope: {...cardView().scope, approved: false}, displayPolicy: {version: 1, showAmounts: true}, money: {...money, amountDueMinor: null, paidMinor: null, refundedMinor: null}});
  const id = success(await f.upsert(view)), content = f.text(f.nodes.get(id));
  assert.match(content, /Unapproved proposal/); assert.match(content, /Proposed total: 250\.00 USD/); assert.doesNotMatch(content, /Approved total:/);
});
