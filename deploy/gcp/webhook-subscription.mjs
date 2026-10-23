export function webhookTargets(publicUrl, callbackUrl, environment = '') {
  const origin = new URL(publicUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Provide an HTTPS app origin on port 443');
  const saved = environment.match(/^PAYPAL_WEBHOOK_URL=(.+)$/m)?.[1].trim();
  const callback = new URL(callbackUrl || saved || new URL('/webhooks/paypal', origin));
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.port || callback.pathname !== '/webhooks/paypal' || callback.search || callback.hash) throw new Error('Provide an HTTPS callback ending in /webhooks/paypal on port 443');
  return { origin, callback: callback.href };
}

export async function ensureInvoiceWebhook(api, {callback, names, webhookId}) {
  const existing = (await api('/v1/notifications/webhooks')).webhooks || [];
  const matches = existing.filter(x => x.url === callback);
  if (matches.length > 1) throw new Error('Duplicate callback subscriptions require review');
  let hook = webhookId ? existing.find(x => x.id === webhookId) : matches[0];
  if (webhookId && !hook) throw new Error('The configured webhook ID is not owned by this REST app');
  if (hook && matches.some(x => x.id !== hook.id)) throw new Error('Another subscription already uses the requested callback');
  const created = !hook;
  let updated = false;
  if (!hook) {
    hook = await api('/v1/notifications/webhooks', {method:'POST', body:JSON.stringify({url:callback, event_types:names.map(name=>({name}))})});
  } else {
    const patches = [];
    if (hook.url !== callback) patches.push({op:'replace', path:'/url', value:callback});
    if (names.some(name => !hook.event_types?.some(x => x.name === name))) {
      const all = [...new Set([...(hook.event_types || []).map(x=>x.name), ...names])].sort();
      patches.push({op:'replace', path:'/event_types', value:all.map(name=>({name}))});
    }
    if (patches.length) {
      await api('/v1/notifications/webhooks/'+encodeURIComponent(hook.id), {method:'PATCH', body:JSON.stringify(patches)});
      updated = true;
    }
  }
  if (!hook.id) throw new Error('PayPal returned no webhook ID');
  const verified = await api('/v1/notifications/webhooks/'+encodeURIComponent(hook.id));
  if (verified.id !== hook.id || verified.url !== callback || names.some(name => !verified.event_types?.some(x => x.name === name))) throw new Error('Webhook readback does not match the requested callback and invoice events');
  return {hook:verified, created, updated};
}
