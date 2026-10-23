// Account-level events need a mapping from the merchant account to this REST app.
// Never take a mapping away from an unrelated integration.
export async function ensureWebhookLookup(api, clientId) {
  const list = async () => (await api('/v1/notifications/webhooks-lookup')).webhooks_lookups || [];
  const existing = await list();
  if (existing.some(row => row.client_id !== clientId)) throw new Error('A webhook lookup belongs to another app; review it without replacing it');
  if (existing.length) return { id: existing[0].id, created: false };
  const row = await api('/v1/notifications/webhooks-lookup', { method: 'POST' });
  if (!row.id || row.client_id !== clientId || !(await list()).some(x => x.id === row.id && x.client_id === clientId)) {
    throw new Error('The webhook lookup could not be read back for this app');
  }
  return { id: row.id, created: true };
}
