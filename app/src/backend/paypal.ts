import { config, paypalBase } from "./env.js";
import { approvedProviderItems, parseMoney, type ApprovedInvoiceTerms } from "./paymentState.js";

let tokenCache: { token: string; expiresAt: number } | null = null;

export function parseRetryAfter(value:string|null,now=Date.now()):number|null {
  if(!value?.trim())return null;
  const text=value.trim(),at=/^\d+$/.test(text)?now+Number(text)*1000:/^[A-Za-z]{3},/.test(text)?Date.parse(text):NaN;
  return Number.isFinite(at) && at>=now && at<=8640000000000000?at:null;
}
export class PayPalRequestError extends Error {
  readonly retryable:boolean; readonly category:string;
  constructor(public status:number|null,public retryAfterAt:number|null,operation:string,failure?:'transport'|'invalid_response'){
    super(`PayPal ${operation} unavailable${status?`: HTTP ${status}`:''}`);
    this.retryable=failure==='invalid_response'?false:status===null || status===429 || status===404 || status>=500 || (failure==='transport' && status>=200 && status<300);
    this.category=failure==='invalid_response'?'provider_invalid_response':status===429?'provider_rate_limit':status===null || (failure==='transport' && status>=200 && status<300)?'provider_transport':status>=500?'provider_unavailable':status===404?'provider_not_found':'provider_rejected';
  }
}
async function providerFetch(url:string,init:RequestInit):Promise<Response>{
  try{return await fetch(url,init);}catch{throw new PayPalRequestError(null,null,'transport');}
}
// Fetch resolves at headers; the body remains a separate network/timeout boundary.
async function readProviderBody(res:Response,operation:string):Promise<{body:any;retryAfterAt:number|null}>{
  const retryAfterAt=parseRetryAfter(res.headers.get('Retry-After'));
  let text:string;
  try{text=await res.text();}
  catch{throw new PayPalRequestError(res.status,retryAfterAt,operation,'transport');}
  try{return {body:text?JSON.parse(text):null,retryAfterAt};}
  catch{
    if(res.ok)throw new PayPalRequestError(res.status,retryAfterAt,operation,'invalid_response');
    // An HTTP rejection still controls retryability even if its error body is not JSON.
    return {body:null,retryAfterAt};
  }
}

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.token;
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const res = await providerFetch(`${paypalBase}/v1/oauth2/token`, {
    method: "POST",
    redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalRequestError(res.status,parseRetryAfter(res.headers.get('Retry-After')),'OAuth');
  const {body:data,retryAfterAt}=await readProviderBody(res,'OAuth response');
  if(!data || typeof data.access_token!=='string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in<=0)throw new PayPalRequestError(res.status,retryAfterAt,'OAuth response','invalid_response');
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function api(path: string, init: RequestInit = {}, authorized?:()=>boolean,onDispatch?:()=>void): Promise<{ status: number; body: any; retryAfterAt:number|null }> {
  const token = await getAccessToken();
  if(authorized && !authorized())throw new Error("Provider action cancelled because its authority changed");
  onDispatch?.();
  const res = await providerFetch(`${paypalBase}${path}`, {
    ...init,
    redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const {body,retryAfterAt}=await readProviderBody(res,'response');
  return { status: res.status, body, retryAfterAt };
}

export interface CreatedInvoice { id: string; href: string | null }

export async function createDraftInvoice(input: {
  merchantEmail: string;
  buyerEmail: string;
  description: string;
  amountMinor: number;
  currency: string;
  reference: string;
  approvedTerms?: ApprovedInvoiceTerms;
  paymentTerms?: string;
}, authorized?: () => boolean): Promise<CreatedInvoice> {
  const value = (input.amountMinor / 100).toFixed(2);
  const { status, body } = await api("/v2/invoicing/invoices", {
    method: "POST",
    body: JSON.stringify({
      detail: {
        invoice_number: input.approvedTerms?.invoiceNumber ?? input.reference.slice(0, 25),
        reference: input.reference,
        // Let PayPal choose the merchant's current date. UTC can be tomorrow in
        // the merchant's time zone, which schedules rather than publishes it.
        currency_code: input.currency,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
        terms_and_conditions: input.paymentTerms ?? "Work begins after payment. Sandbox demonstration only.",
        note: "Scope & Settle change order",
      },
      invoicer: { email_address: input.merchantEmail },
      primary_recipients: [{ billing_info: { email_address: input.buyerEmail } }],
      items: input.approvedTerms ? approvedProviderItems(input.approvedTerms) : [{
        name: input.description.slice(0, 120),
        description: input.description.slice(0, 1000),
        quantity: "1",
        unit_amount: { currency_code: input.currency, value },
      }],
      configuration: { partial_payment: { allow_partial_payment: false }, tax_calculated_after_discount: true },
    }),
  }, authorized);
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

export async function sendInvoice(invoiceId: string, authorized?: () => boolean, onSent?: () => void, onDispatch?:()=>void): Promise<string | null> {
  const { status, body } = await api(`/v2/invoicing/invoices/${invoiceId}/send`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: false }),
  }, authorized,onDispatch);
  if (status !== 202 && status !== 200) {
    throw new Error(`Send invoice failed: HTTP ${status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  onSent?.();
  if (authorized && !authorized()) throw new Error("Provider action cancelled because its authority changed");
  const fromSend = (body?.links ?? []).find((l: any) => l.rel === "payer-view")?.href;
  if (fromSend) return fromSend;
  const detail = await getInvoice(invoiceId, authorized);
  return detail.payerViewUrl ?? payerViewUrl(invoiceId);
}

/** Explicitly enabled reminder policy only. This never records a payment. */
export interface InvoiceNotification {send_to_invoicer:boolean;send_to_recipient:boolean;additional_recipients:string[]}
export async function notifyInvoice(invoiceId:string,kind:'remind'|'cancel',notification:InvoiceNotification,authorized:()=>boolean,onDispatch:()=>void):Promise<{status:number}> {
  const {status,retryAfterAt}=await api(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/${kind}`,{method:'POST',body:JSON.stringify(notification)},authorized,onDispatch);
  if(status!==204)throw new PayPalRequestError(status,retryAfterAt,kind);
  return {status};
}
export async function remindInvoice(invoiceId:string,authorized?:()=>boolean,onDispatch?:()=>void):Promise<void> {
  const {status,retryAfterAt}=await api(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`,{
    method:"POST",body:JSON.stringify({send_to_invoicer:false,send_to_recipient:true,additional_recipients:[]}),
  },authorized,onDispatch);
  if(status!==204)throw new PayPalRequestError(status,retryAfterAt,'reminder');
}

/** Reconciliation: find an existing invoice by its invoice_number (e.g. after a lost create response). */
export async function findInvoiceByNumber(invoiceNumber: string, authorized?: () => boolean): Promise<string | null> {
  const { status, body } = await api("/v2/invoicing/search-invoices?page_size=100", {
    method: "POST", body: JSON.stringify({ invoice_number: invoiceNumber }),
  }, authorized);
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
  return parseMoney(amount);
}

export async function getInvoice(invoiceId: string, authorized?: () => boolean): Promise<InvoiceDetail> {
  const { status, body, retryAfterAt } = await api(`/v2/invoicing/invoices/${invoiceId}`, {}, authorized);
  if (status !== 200) throw new PayPalRequestError(status,retryAfterAt,'invoice retrieval');
  const payer = (body.links ?? []).find((l: any) => l.rel === "payer-view");
  // Invoicing v2 publishes the actual recipient URL in detail.metadata.
  // Preserve its opaque fragment; the resource ID is not a replacement for it.
  const recipientUrl = body.detail?.metadata?.recipient_view_url;
  return {
    id: body.id,
    status: body.status,
    totalMinor: toMinor(body.amount),
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
  const { status, body, retryAfterAt } = await api("/v1/notifications/verify-webhook-signature", {
    method: "POST", body: JSON.stringify({ ...fields, webhook_id: config.paypalWebhookId, webhook_event: event }),
  });
  if (status !== 200) throw new PayPalRequestError(status,retryAfterAt,'webhook verification');
  return body.verification_status === "SUCCESS";
}
