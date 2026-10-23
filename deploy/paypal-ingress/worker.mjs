const signatureHeaders = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
const origin = 'https://scope-and-settle.hperkins.com';

/** @satisfies {ExportedHandler} */
export default {
  /** @param {Request} request */
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      try {
        const response = await fetch(origin + '/health', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (response.status >= 300 && response.status < 400) return new Response('Upstream redirect rejected', { status: 502 });
        return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      } catch { return new Response('Upstream unavailable', { status: 502 }); }
    }
    if (request.method !== 'POST' || path !== '/webhooks/paypal') return new Response('Not found', { status: 404 });
    if (signatureHeaders.some(name => !request.headers.get(name))) return new Response('Missing PayPal signature headers', { status: 401 });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const name of signatureHeaders) headers.set(name, request.headers.get(name) || '');
    try {
      // Stream the exact original body. The backend verifies PayPal's signature,
      // reconciles the invoice, and durably records the event before acknowledging.
      const response = await fetch(origin + '/webhooks/paypal', {
        method: 'POST', headers, body: request.body, redirect: 'manual', signal: AbortSignal.timeout(25000),
      });
      console.info(JSON.stringify({ component: 'paypal_ingress', state: 'forwarded', upstreamStatus: response.status }));
      if (response.status >= 300 && response.status < 400) return new Response('Upstream redirect rejected', { status: 502 });
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch {
      console.warn(JSON.stringify({ component: 'paypal_ingress', state: 'upstream_unavailable' }));
      return new Response('Upstream unavailable; retry delivery', { status: 502 });
    }
  },
};
