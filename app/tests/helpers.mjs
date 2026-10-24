import { cp, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Each suite imports a fresh compiled application and uses a fresh SQLite file.
// Never copy or mutate the developer's database or read their provider credentials.
export async function isolatedApp() {
  const root = await mkdtemp(join(tmpdir(), 'scope-settle-test-'));
  const app = join(root, 'app');
  await mkdir(app);
  await cp(fileURLToPath(new URL('../dist', import.meta.url)), join(app, 'dist'), { recursive: true });
  await cp(fileURLToPath(new URL('../web', import.meta.url)), join(app, 'web'), { recursive: true });
  await writeFile(join(app, 'package.json'), '{"type":"module"}');
  // The backend has pinned runtime dependencies (the MCP SDK); the copy resolves them from the
  // installed, lockfile-verified packages through a link, never a second install or a copy.
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(app, 'node_modules'), 'junction');
  for (const [key, value] of Object.entries({
    PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'test-id', PAYPAL_CLIENT_SECRET: 'test-secret',
    PAYPAL_SANDBOX_MERCHANT_EMAIL: 'merchant@example.com', PAYPAL_SANDBOX_BUYER_EMAIL: 'buyer@example.com',
    FIGMA_PERSONAL_ACCESS_TOKEN: 'test-token', FIGMA_FILE_KEY: 'test-file',
    FIGMA_WEBHOOK_ENABLED:'false',FIGMA_WEBHOOK_ACCESS_VERIFIED:'false',FIGMA_WEBHOOK_ID:'',FIGMA_WEBHOOK_PASSCODE:'',FIGMA_WEBHOOK_CONTEXT_TYPE:'file',FIGMA_WEBHOOK_CONTEXT_ID:'',
    AI_API_KEY: 'wrong-provider', OPENAI_API_KEY: 'wrong-provider', BASETEN_API_KEY: 'baseten-test-only',
    AI_PROVIDER: 'baseten', AI_MODEL: 'deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast', AI_REASONING_EFFORT: 'max', AI_BUDGET_USD: '25',
    PAYPAL_WEBHOOK_ID: 'test-webhook',
    AGENT_WORKER_DISABLED: 'true',
    JOB_WORKER_DISABLED: 'true',
    MCP_ALLOWED_ORIGINS: '', MCP_TRUSTED_PROXIES: '',
    SCOPE_SETTLE_DATA_DIR: join(app, 'data'), PORT: '0',
  })) process.env[key] = value;
  return { root, app, load: name => import(pathToFileURL(join(app, 'dist/backend', name + '.js')).href) };
}

export function providerFixture({ topLevelCreateLink = false, merchantToday, idPrefix = 'INV2-TEST-' } = {}) {
  const invoices = new Map();
  let creates = 0, sends = 0, failSends = 0;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  return {
    invoices,
    counts: () => ({ creates, sends }),
    failNextSend: () => { failSends++; },
    async fetch(url, init = {}) {
      const u = new URL(url);
      if (u.hostname !== 'api-m.sandbox.paypal.com') throw new Error('Unexpected external request: ' + u.origin);
      if (u.pathname === '/v1/oauth2/token') return reply({ access_token: 'test-token', expires_in: 3600 });
      if (u.pathname === '/v1/notifications/verify-webhook-signature') {
        return reply({ verification_status: JSON.parse(init.body).transmission_sig === 'bad' ? 'FAILURE' : 'SUCCESS' });
      }
      if (u.pathname === '/v2/invoicing/search-invoices') {
        const q = JSON.parse(init.body);
        return reply({ items: [...invoices.values()].filter(x => x.detail.invoice_number === q.invoice_number) });
      }
      if (u.pathname === '/v2/invoicing/invoices' && init.method === 'POST') {
        const data = JSON.parse(init.body);
        const total = data.items.reduce((sum,item)=>sum+Number(item.quantity)*Math.round(Number(item.unit_amount.value)*100),0);
        const id = idPrefix + (++creates);
        invoices.set(id, {
          id, status: 'DRAFT', detail: data.detail, invoicer: { email_address: 'merchant@example.com' },
          primary_recipients: data.primary_recipients,
          items: data.items,
          amount: { currency_code: 'USD', value: (total/100).toFixed(2) },
          due_amount: { currency_code: 'USD', value: (total/100).toFixed(2) }, links: [],
        });
        const self = { rel: 'self', href: u.origin + '/v2/invoicing/invoices/' + id, method: 'GET' };
        return reply(topLevelCreateLink ? self : { links: [self] }, 201);
      }
      const match = u.pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)(\/send)?$/);
      if (match) {
        const invoice = invoices.get(match[1]);
        if (!invoice) return reply({ error: 'missing fixture invoice' }, 404);
        if (match[2]) {
          sends++;
          if (failSends) { failSends--; return reply({ error: 'temporary send failure' }, 503); }
          invoice.status = merchantToday && invoice.detail.invoice_date > merchantToday ? 'SCHEDULED' : 'UNPAID';
          return reply({}, 202);
        }
        return reply(invoice);
      }
      throw new Error('Unexpected PayPal request: ' + u.pathname);
    },
  };
}

export function draftInput() {
  return {
    title: 'Mobile checkout', commentId: 'comment-1', deliverables: ['Mobile layouts for the checkout'], currency: 'USD',
    lineItems: [{ rateCardId: 'mobile_checkout', priceSource: 'rate_card', description: 'Mobile checkout', quantity: 1, unitAmountMinor: 25000 }],
  };
}

// Trusted synthetic setup for callers that exercise the public canonical draft service.
// It creates distinct requested work, immutable context and real persisted item identities;
// it never adds a production fallback or calls a provider.
export async function canonicalDraftFactory(app) {
  const {db,getProjectForRun}=await app.load('db'),ledger=await app.load('scopeLedger'),items=await app.load('requestItems');
  let serial=0;
  return (ctx,options={})=>{
    const project=getProjectForRun(ctx.runId),scope=ledger.scopeContextForRun(ctx.runId),id=options.assessmentId??crypto.randomUUID(),root='fixture-source-'+crypto.randomUUID();
    const requested=options.requestedDeliverable??`Mobile checkout for synthetic flow ${++serial}`;
    const raw={items:[{requestedDeliverable:requested,requestQuote:requested,classification:'new_work',evidence:[{kind:'scope_clause',snapshotId:scope.scopeSnapshot.id,clauseId:project.scopeClauses[0].id,quote:project.scopeClauses[0].text}],rates:[{rateCardId:project.rateCard[0].id,quantity:1}],questions:[],existingCommitment:null}],explanation:'Synthetic supported additional flow',designObservations:[]};
    if(options.count>1){for(let n=1;n<options.count;n++)raw.items.push({...raw.items[0],requestedDeliverable:requested.replace('Mobile checkout','Mobile receipt')+' variant '+n,requestQuote:requested.replace('Mobile checkout','Mobile receipt')+' variant '+n});}
    const text=raw.items.map(i=>i.requestQuote).join(' / ');
    const result=items.validateItemizedAssessment(raw,project,scope,[text]),ref=options.scopeContext??ledger.captureScopeContext(ctx.runId),record={id,result,scopeContext:ref,scopeRevisionId:project.scopeRevisionId};
    db.prepare('INSERT INTO assessments(id,project_id,run_id,scope_revision_id,input_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id,project.id,ctx.runId,project.scopeRevisionId,JSON.stringify({project,comment:{id:root,message:text},replies:[],itemized:true}),JSON.stringify(record),new Date().toISOString());
    ledger.linkScopeContext('assessment',id,1,ref.id);
    const saved=items.recordRequestAssessment(ctx.runId,{source:'portal',rootId:root,fileKey:'',messages:[{id:root,message:text}]},record);
    for(const item of saved.items)for(const reference of item.reviewReferences??[]){const current=items.assessmentItems(id,ctx.runId).find(i=>i.id===item.id);items.resolveDuplicate(ctx,item.id,'distinct_work','This synthetic fixture explicitly requests a different numbered flow',reference.resourceId,reference.revision,current.review);}
    return {title:requested,deliverables:[requested],lineItems:saved.items[0].lineItems.map(x=>({...x})),currency:project.currency,commentId:null,assessmentId:id,itemIds:saved.items.map(i=>i.id),operationId:crypto.randomUUID()};
  };
}
