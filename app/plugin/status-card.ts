import type {StatusCardView} from '../src/shared/types';
import {redactCardMoney} from '../src/shared/statusCardText';

const MAP = 'scope-settle.cards.v1', MARK = 'scope-settle.card.v1', ROLE = 'scope-settle.card-role.v1';
const FONT: FontName = {family: 'Inter', style: 'Regular'};
type CardContext = {epoch: string; fileKey: string; projectId: string; runId: string; appOrigin: string};
type Entry = {key: string; nodeId: string};
type Marker = {key: string; revision: number; projectionVersion: number; policyVersion: number};
let context: CardContext | null = null;
const queues = new Map<string, Promise<string>>();
function fail(message: string): never { throw new Error(message); }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown, names: string[]): value is Record<string, any> => object(value) && Object.keys(value).length === names.length && Object.keys(value).every(k => names.includes(k));
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const timestamp = (value: unknown) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const nullableNumber = (value: unknown) => value === null || integer(value);
const identity = (view: Pick<StatusCardView, 'fileKey' | 'projectId' | 'runId' | 'orderId'>) => JSON.stringify([view.fileKey, view.projectId, view.runId, view.orderId]);

function validOrigin(value: unknown): value is string {
  return text(value, 300) && /^(https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(?::\d{1,5})?)$/.test(value);
}
function validate(raw: unknown, owner: CardContext, orderId: string): StatusCardView {
  if (!keys(raw, ['schemaVersion','fileKey','projectId','runId','orderId','revision','title','deliverables','scope','approvalState','invoiceState','paymentState','deliveryState','paymentObservedAt','appReadAt','projectionVersion','displayPolicy','money','appUrl']) || JSON.stringify(raw).length > 100_000) fail('Invalid bounded status-card projection');
  const v = raw as unknown as StatusCardView;
  if (v.schemaVersion !== 1 || ![v.fileKey,v.projectId,v.runId,v.orderId].every(x => text(x)) || v.fileKey !== owner.fileKey || v.projectId !== owner.projectId || v.runId !== owner.runId || v.orderId !== orderId || !integer(v.revision, 1)) fail('Status-card identity changed; reconnect and refresh');
  if (!text(v.title) || !Array.isArray(v.deliverables) || v.deliverables.length > 20 || !v.deliverables.every(x => text(x, 4000))) fail('Invalid card scope text');
  if (!keys(v.scope, ['revisionId','snapshotId','version','rateVersion','approved']) || ![v.scope.revisionId,v.scope.snapshotId].every(x => x === null || text(x)) || ![v.scope.version,v.scope.rateVersion].every(nullableNumber) || typeof v.scope.approved !== 'boolean') fail('Invalid scope reference');
  if (!['draft','awaiting_client_approval','needs_re_review','approved','cancelled'].includes(v.approvalState) || v.scope.approved !== (v.approvalState === 'approved') || !['none','draft','scheduled','payable','closed','cancelled','unknown'].includes(v.invoiceState) || !['not_invoiced','not_started','due','pending','partial','paid','partially_refunded','refunded','review_required','unknown'].includes(v.paymentState) || v.deliveryState !== 'not_recorded') fail('Invalid independent status fields');
  if (!(v.paymentObservedAt === null || timestamp(v.paymentObservedAt)) || !timestamp(v.appReadAt) || !integer(v.projectionVersion, 1) || !keys(v.displayPolicy, ['version','showAmounts']) || !integer(v.displayPolicy.version) || typeof v.displayPolicy.showAmounts !== 'boolean') fail('Invalid freshness or display policy');
  if (v.displayPolicy.showAmounts) {
    if (!keys(v.money, ['currency','totalMinor','amountDueMinor','paidMinor','refundedMinor']) || v.money.currency !== 'USD' || !integer(v.money.totalMinor) || ![v.money.amountDueMinor,v.money.paidMinor,v.money.refundedMinor].every(nullableNumber)) fail('Invalid monetary projection');
  } else if (v.money !== null || [v.title,...v.deliverables].some(s => redactCardMoney(s) !== s)) fail('Hidden amounts must be removed before creating the card');
  const expected = owner.appOrigin + '/designer?order=' + encodeURIComponent(v.orderId) + '&run=' + encodeURIComponent(v.runId);
  if (v.appUrl !== expected) fail('Use the authenticated application landing URL without private access credentials');
  return v;
}

function mapping(): Entry[] {
  const raw = figma.root.getPluginData(MAP);
  if (!raw) return [];
  if (raw.length > 60_000) fail('Card mapping is too large; repair it in the plugin');
  let parsed: any; try { parsed = JSON.parse(raw); } catch { fail('Invalid card mapping; repair required'); }
  if (!keys(parsed, ['schemaVersion','entries']) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > 100 || !parsed.entries.every((e: unknown) => keys(e, ['key','nodeId']) && text(e.key, 1000) && text(e.nodeId))) fail('Invalid card mapping; repair required');
  if (new Set(parsed.entries.map((e: Entry) => e.key)).size !== parsed.entries.length) fail('Ambiguous card mapping; repair required');
  return parsed.entries;
}
function marker(node: BaseNode): Marker | null {
  const raw = node.getPluginData(MARK);
  if (!raw || raw.length > 2000) return null;
  try {
    const p = JSON.parse(raw);
    return keys(p, ['key','revision','projectionVersion','policyVersion']) && text(p.key, 1000) && integer(p.revision, 1) && integer(p.projectionVersion, 1) && integer(p.policyVersion) ? p as Marker : null;
  } catch { return null; }
}
function discover(page: PageNode, key: string): FrameNode | null {
  const pending: SceneNode[] = [...page.children], found: FrameNode[] = [];
  let visited = 0;
  while (pending.length) {
    if (++visited > 2000 || pending.length > 2000) fail('Page is too large for bounded card recovery; restore the card mapping');
    const node = pending.pop()!;
    if (node.type === 'FRAME' && marker(node)?.key === key) found.push(node);
    if ('children' in node) pending.push(...node.children);
  }
  if (found.length > 1) fail('Multiple matching cards found; repair duplicates before updating');
  return found[0] ?? null;
}
function body(view: StatusCardView): string {
  const pretty = (s: string) => s.replace(/_/g, ' ');
  const lines = ['Scope & Settle', view.title, 'Proposal revision ' + view.revision,
    (view.scope.approved ? 'Approved scope' : 'Unapproved proposal') + ': ' + (view.scope.revisionId ?? 'Unknown') + ' · Scope v' + (view.scope.version ?? '?') + ' · Rates v' + (view.scope.rateVersion ?? '?'),
    ...view.deliverables.map(s => '• ' + s), 'Approval: ' + pretty(view.approvalState), 'Payment: ' + pretty(view.paymentState) + ' (invoice ' + pretty(view.invoiceState) + ')', 'Delivery: Not recorded'];
  if (view.money) {
    const amount = (n: number | null) => n === null ? 'Unknown' : (n / 100).toFixed(2) + ' ' + view.money!.currency;
    lines.push((view.scope.approved ? 'Approved total: ' : 'Proposed total: ') + amount(view.money.totalMinor), 'Amount due: ' + amount(view.money.amountDueMinor), 'Paid: ' + amount(view.money.paidMinor), 'Refunded: ' + amount(view.money.refundedMinor));
  }
  lines.push('Payment observed: ' + (view.paymentObservedAt ?? 'Unavailable'), 'App status read: ' + view.appReadAt, 'Card updated: ' + new Date().toISOString(), 'Cached snapshot — refresh in plugin/app');
  return lines.join('\n');
}

/** Every native await completes before the write section; one queue serializes each scoped identity. */
export async function upsertStatusCard(orderId: string, raw: unknown, selectionGeneration: () => number): Promise<string> {
  const owner = context;
  if (!owner || !figma.fileKey || figma.fileKey !== owner.fileKey) fail('Open the connected project file before updating its card');
  const view = validate(raw, owner, orderId), key = identity(view), page = figma.currentPage;
  const generation = selectionGeneration(), selection = page.selection.map(n => n.id).join(',');
  // Capture placement with the invocation, outside selected design bounds, before any await.
  const bounds = page.selection.map(n => n.absoluteBoundingBox).filter((b): b is NonNullable<typeof b> => b !== null);
  const placement = bounds.length ? {x: Math.max(...bounds.map(b => b.x + b.width)) + 40, y: Math.min(...bounds.map(b => b.y))} : {x: figma.viewport.center.x, y: figma.viewport.center.y};
  const guard = () => {
    if (context !== owner || figma.fileKey !== owner.fileKey || figma.currentPage.id !== page.id || selectionGeneration() !== generation || page.selection.map(n => n.id).join(',') !== selection) fail('Card context or selection changed; invoke the update again');
  };
  const previous = queues.get(key);
  const work = (async () => {
    if (previous) await previous.catch(() => {});
    guard();
    await figma.loadFontAsync(FONT); guard();
    const entries = mapping(), existing = entries.find(e => e.key === key);
    let node: BaseNode | null = existing ? await figma.getNodeByIdAsync(existing.nodeId) : null;
    guard();
    if (node && (node.type !== 'FRAME' || marker(node)?.key !== key)) fail('Mapped node is not this application card; repair required');
    if (!node) { await page.loadAsync(); guard(); node = discover(page, key); }
    const frame = node as FrameNode | null, prior = frame ? marker(frame)! : null;
    if (prior && (view.revision < prior.revision || view.projectionVersion < prior.projectionVersion || view.displayPolicy.version < prior.policyVersion)) fail('An older card snapshot cannot replace the saved one');
    // Another identity can finish while this lookup awaits. Merge against the latest
    // document mapping in the synchronous write section, never the earlier snapshot.
    const currentEntries = mapping();
    if (!currentEntries.some(e => e.key === key) && currentEntries.length >= 100) fail('Card mapping is full; repair unused mappings before creating another card');
    const oldMap = figma.root.getPluginData(MAP), oldMark = frame?.getPluginData(MARK) ?? '';
    let target = frame, owned: TextNode[] = [], created: SceneNode[] = [];
    if (target) {
      owned = target.children.filter(n => n.type === 'TEXT' && ['body','link'].includes(n.getPluginData(ROLE))) as TextNode[];
      if (target.layoutMode !== 'VERTICAL' || owned.length !== 2 || !['body','link'].every(role => owned.filter(n => n.getPluginData(ROLE) === role).length === 1)) fail('Card structure changed; repair it before refreshing');
    }
    const rollback: {node: TextNode; characters: string; hyperlink: TextNode['hyperlink']; fontName: TextNode['fontName']; name: string}[] = owned.map(n => ({node: n, characters: n.characters, hyperlink: n.hyperlink, fontName: n.fontName, name: n.name}));
    try {
      guard();
      if (!target) {
        target = figma.createFrame(); created.push(target); target.name = 'Scope & Settle status card';
        target.layoutMode = 'VERTICAL'; target.primaryAxisSizingMode = 'AUTO'; target.counterAxisSizingMode = 'FIXED';
        target.paddingTop = target.paddingBottom = target.paddingLeft = target.paddingRight = 20; target.itemSpacing = 12;
        target.resize(440, 120); target.x = placement.x; target.y = placement.y;
        page.appendChild(target);
        for (const role of ['body','link']) { const n = figma.createText(); created.push(n); n.setPluginData(ROLE, role); target.appendChild(n); owned.push(n); }
      }
      for (const n of owned) { n.fontName = FONT; n.fontSize = 14; n.textAutoResize = 'HEIGHT'; n.resize(400, 20); n.name = 'Scope & Settle ' + n.getPluginData(ROLE); }
      const content = owned.find(n => n.getPluginData(ROLE) === 'body')!, link = owned.find(n => n.getPluginData(ROLE) === 'link')!;
      content.characters = body(view); link.characters = 'Open Scope & Settle'; link.hyperlink = {type: 'URL', value: view.appUrl};
      target.setPluginData(MARK, JSON.stringify({key, revision: view.revision, projectionVersion: view.projectionVersion, policyVersion: view.displayPolicy.version}));
      const next = currentEntries.filter(e => e.key !== key); next.push({key, nodeId: target.id});
      figma.root.setPluginData(MAP, JSON.stringify({schemaVersion: 1, entries: next}));
      return target.id;
    } catch (error) {
      if (frame) {
        for (const old of rollback) { try { old.node.fontName = old.fontName; old.node.characters = old.characters; old.node.hyperlink = old.hyperlink; old.node.name = old.name; } catch {} }
        try { frame.setPluginData(MARK, oldMark); } catch {}
      } else for (const n of created.reverse()) { try { if (!n.removed) n.remove(); } catch {} }
      try { figma.root.setPluginData(MAP, oldMap); } catch {}
      throw error;
    }
  })();
  queues.set(key, work);
  try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
}

export async function handleStatusCardMessage(msg: Record<string, any>, selectionGeneration: () => number): Promise<void> {
  if (msg.type === 'status-card-context') {
    const c = msg.context;
    context = keys(c, ['epoch','fileKey','projectId','runId','appOrigin']) && [c.epoch,c.fileKey,c.projectId,c.runId].every(x => text(x)) && validOrigin(c.appOrigin) ? {...c} as CardContext : null;
    return;
  }
  try {
    if (!keys(msg, ['type','invocationId','epoch','orderId','view']) || !text(msg.invocationId) || !context || msg.epoch !== context.epoch || !text(msg.orderId)) fail('Expired or invalid status-card invocation');
    const nodeId = await upsertStatusCard(msg.orderId, msg.view, selectionGeneration);
    figma.ui.postMessage({type: 'status-card-result', invocationId: msg.invocationId, epoch: msg.epoch, orderId: msg.orderId, ok: true, nodeId});
  } catch (error) {
    figma.ui.postMessage({type: 'status-card-result', invocationId: msg.invocationId, epoch: msg.epoch, orderId: msg.orderId, ok: false, message: error instanceof Error ? error.message : 'Card update failed'});
  }
}
