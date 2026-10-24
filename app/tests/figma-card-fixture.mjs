import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {deliveryPng} from './delivery-fixture.mjs';

export const cardView = (overrides = {}) => ({
  schemaVersion: 1, fileKey: 'test-file', projectId: 'demo', runId: 'run-one', orderId: 'order-one', revision: 1,
  title: 'Gallery screen', deliverables: ['One responsive gallery screen'],
  scope: {revisionId: 'scope-rev-1', snapshotId: 'scope-one', version: 1, rateVersion: 1, approved: true},
  approvalState: 'approved', invoiceState: 'payable', paymentState: 'paid', deliveryState: 'not_recorded',
  paymentObservedAt: '2026-10-24T10:00:00.000Z', appReadAt: '2026-10-24T11:00:00.000Z', projectionVersion: 100,
  displayPolicy: {version: 0, showAmounts: false}, money: null,
  appUrl: 'https://fixture.test/designer?order=order-one&run=run-one', ...overrides,
});

/** Graph/storage/font/message mechanics only. The actual bundled plugin implements the card operation. */
export async function pluginFixture({saved, fileKey = 'test-file'} = {}) {
  const source = await readFile(new URL('../plugin/dist/code.js', import.meta.url), 'utf8');
  const nodes = new Map(), messages = [], events = {}, data = saved ?? new Map();
  let serial = 0, fontHook = null, nodeHook = null, failMapping = false, fontFailure = false, writes = 0;
  const storage = (key) => ({
    getPluginData: name => data.get(key + ':' + name) ?? '',
    setPluginData(name, value) {
      if (key === 'root' && failMapping) { failMapping = false; throw new Error('synthetic mapping failure'); }
      writes++; data.set(key + ':' + name, value);
    },
    getPluginDataKeys: () => [...data.keys()].filter(x => x.startsWith(key + ':')).map(x => x.slice(key.length + 1)),
  });
  function make(type, id = 'node-' + ++serial) {
    const node = {id, type, name: type, removed: false, parent: null, x: 0, y: 0, width: 440, height: 120,
      ...storage(id), resize(width, height) { this.width = width; this.height = height; },
      async exportAsync(){return Buffer.from(deliveryPng().slice(22),'base64');},
      remove() { this.removed = true; nodes.delete(this.id); if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); },
    };
    if (type !== 'TEXT') {
      node.children = [];
      node.appendChild = function(child) {
        if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child);
        this.children.push(child); child.parent = this;
      };
    } else Object.assign(node, {characters: '', fontName: {family: 'Inter', style: 'Regular'}, fontSize: 14, textAutoResize: 'HEIGHT', hyperlink: null});
    Object.defineProperty(node, 'absoluteBoundingBox', {get: () => ({x: node.x, y: node.y, width: node.width, height: node.height})});
    nodes.set(id, node); return node;
  }
  const root = make('DOCUMENT', 'root'), page = make('PAGE', 'page-one');
  root.appendChild(page); page.selection = []; page.loadAsync = async () => {};
  const raw = {fileKey, root, currentPage: page, viewport: {center: {x: 200, y: 300}},
    ui: {postMessage: m => messages.push(m), resize() {}}, showUI() {}, on: (name, fn) => { events[name] = fn; },
    clientStorage: {getAsync: async () => null, setAsync: async () => {}}, base64Encode: b => Buffer.from(b).toString('base64'),
    async loadFontAsync() { if (fontHook) await fontHook(); if (fontFailure) throw new Error('synthetic font failure'); },
    async getNodeByIdAsync(id) { if (nodeHook) await nodeHook(); return nodes.get(id) ?? null; },
    createFrame() { writes++; const node = make('FRAME'); raw.currentPage.appendChild(node); return node; },
    createPage() { writes++; const node=make('PAGE');node.selection=[];node.loadAsync=async()=>{};root.appendChild(node);return node; },
    createText() { writes++; const node = make('TEXT'); raw.currentPage.appendChild(node); return node; },
  };
  const figma = new Proxy(raw, {get(target, key) { if (!(key in target)) throw new Error('Unexpected Plugin API: ' + String(key)); return target[key]; }});
  const run = () => vm.runInContext(source, vm.createContext({figma, __html__: 'fixture', Date, Error, console}));
  run();
  const ctx = {epoch: 'epoch-one', fileKey, projectId: 'demo', runId: 'run-one', appOrigin: 'https://fixture.test'};
  await figma.ui.onmessage({type: 'status-card-context', context: ctx});
  return {figma, nodes, root, page, messages, events, data, ctx, make,
    async reopen() { run(); await figma.ui.onmessage({type: 'status-card-context', context: ctx}); },
    get writes() { return writes; }, set fontHook(fn) { fontHook = fn; }, set nodeHook(fn) { nodeHook = fn; },
    set fontFailure(value) { fontFailure = value; }, set failMapping(value) { failMapping = value; },
    async upsert(view = cardView(), invocationId = 'invoke-' + ++serial) {
      await figma.ui.onmessage({type: 'upsert-status-card', invocationId, epoch: ctx.epoch, orderId: view.orderId, view});
      return messages.findLast(m => m.invocationId === invocationId);
    },
    text(node) { return node.children.filter(n => n.type === 'TEXT').map(n => n.characters).join('\n'); },
    cards() { return [...nodes.values()].filter(n => n.type === 'FRAME' && !n.removed); },
  };
}
