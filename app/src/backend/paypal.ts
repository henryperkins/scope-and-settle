import { config, paypalBase } from "./env.js";

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.token;
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const res = await fetch(`${paypalBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

export interface CreatedInvoice { id: string; href: string | null }

export async function createDraftInvoice(input: {
  merchantEmail: string;
  buyerEmail: string;
  description: string;
  amountMinor: number;
  currency: string;
  reference: string;
}): Promise<CreatedInvoice> {
  const value = (input.amountMinor / 100).toFixed(2);
  const { status, body } = await api("/v2/invoicing/invoices", {
    method: "POST",
    body: JSON.stringify({
      detail: {
        invoice_number: input.reference.slice(0, 25),
        reference: input.reference,
        // Let PayPal choose the merchant's current date. UTC can be tomorrow in
        // the merchant's time zone, which schedules rather than publishes it.
        currency_code: input.currency,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
        terms_and_conditions: "Work begins after payment. Sandbox demonstration only.",
        note: "Scope & Settle change order",
      },
      invoicer: { email_address: input.merchantEmail },
      primary_recipients: [{ billing_info: { email_address: input.buyerEmail } }],
      items: [{
        name: input.description.slice(0, 120),
        description: input.description.slice(0, 1000),
        quantity: "1",
        unit_amount: { currency_code: input.currency, value },
      }],
      configuration: { partial_payment: { allow_partial_payment: false }, tax_calculated_after_discount: true },
    }),
  });
  if (status !== 201 && status !== 200) {
    throw new Error(`Create invoice failed: HTTP ${status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  // Sandbox can return one top-level link, a link array, or an expanded invoice.
  const links = Array.isArray(body) ? body : Array.isArray(body.links) ? body.links : body.rel ? [body] : [];
  const self = links.find((l: any) => l.rel === "self");
  const payer = links.find((l: any) => l.rel === "payer-view");
  const idFromLink = self?.href ? String(self.href).split("/").pop() : null;
  const id = body.id ?? idFromLink;
  if (!id) throw new Error(`Create invoice returned no invoice ID: ${JSON.stringify(body).slice(0, 300)}`);
  return { id, href: payer?.href ?? self?.href ?? null };
}

export function payerViewUrl(invoiceId: string): string {
  const host = config.paypalEnv === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";
  return `${host}/invoice/payerView/details/${invoiceId}`;
}

export async function sendInvoice(invoiceId: string): Promise<string | null> {
  const { status, body } = await api(`/v2/invoicing/invoices/${invoiceId}/send`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: false }),
  });
  if (status !== 202 && status !== 200) {
    throw new Error(`Send invoice failed: HTTP ${status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  const fromSend = (body?.links ?? []).find((l: any) => l.rel === "payer-view")?.href;
  if (fromSend) return fromSend;
  const detail = await getInvoice(invoiceId);
  return detail.payerViewUrl ?? payerViewUrl(invoiceId);
}

/** Reconciliation: find an existing invoice by its invoice_number (e.g. after a lost create response). */
export async function findInvoiceByNumber(invoiceNumber: string): Promise<string | null> {
  const { status, body } = await api("/v2/invoicing/search-invoices?page_size=100", {
    method: "POST", body: JSON.stringify({ invoice_number: invoiceNumber }),
  });
  if (status !== 200) throw new Error(`Invoice reconciliation unavailable: HTTP ${status}`);
  for (const item of body.items ?? []) {
    if (item.detail?.invoice_number === invoiceNumber) return item.id;
  }
  return null;
}

export interface InvoiceDetail {
  id: string;
  status: string;
  totalMinor: number | null;
  amountDueMinor: number | null;
  currency: string | null;
  payerViewUrl: string | null;
  raw: any;
}

function toMinor(amount: any): number | null {
  if (!amount?.value) return null;
  return Math.round(parseFloat(amount.value) * 100);
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const { status, body } = await api(`/v2/invoicing/invoices/${invoiceId}`);
  if (status !== 200) throw new Error(`Get invoice failed: HTTP ${status} ${JSON.stringify(body).slice(0, 300)}`);
  const payer = (body.links ?? []).find((l: any) => l.rel === "payer-view");
  // Invoicing v2 publishes the actual recipient URL in detail.metadata.
  // Preserve its opaque fragment; the resource ID is not a replacement for it.
  const recipientUrl = body.detail?.metadata?.recipient_view_url;
  return {
    id: body.id,
    status: body.status,
    totalMinor: toMinor(body.detail?.amount_with_breakdown?.total_amount ?? body.amount),
    amountDueMinor: toMinor(body.due_amount),
    currency: body.detail?.currency_code ?? null,
    payerViewUrl: (typeof recipientUrl === "string" && recipientUrl ? recipientUrl : payer?.href) ??
      (body.status !== "DRAFT" ? payerViewUrl(body.id) : null),
    raw: body,
  };
}

export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  if (!config.paypalWebhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  const fields = { auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"] };
  if (Object.values(fields).some(x => typeof x !== "string" || !x)) return false;
  const { status, body } = await api("/v1/notifications/verify-webhook-signature", {
    method: "POST", body: JSON.stringify({ ...fields, webhook_id: config.paypalWebhookId, webhook_event: event }),
  });
  if (status !== 200) throw new Error(`Webhook verification unavailable: HTTP ${status}`);
  return body.verification_status === "SUCCESS";
}
