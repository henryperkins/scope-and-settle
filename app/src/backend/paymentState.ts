import type { FinancialState, LineItem } from "../shared/types.js";
import type { InvoiceDetail } from "./paypal.js";

export interface ApprovedInvoiceTerms {
  invoiceId?: string;
  merchantEmail: string;
  merchantProvenance: "approval-snapshot" | "legacy-configuration";
  currency: string;
  totalMinor: number;
  lineItems: Pick<LineItem, "description" | "quantity" | "unitAmountMinor">[];
  representation: "itemized-v1" | "aggregate-v0";
  reference: string;
  invoiceNumber: string;
  legacyDescription?: string;
}

/** Decimal USD strings only; missing evidence is never zero and fractional cents never round. */
export function parseMoney(amount: any, currency?: string): number | null {
  if (!amount || typeof amount.value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount.value) ||
      typeof amount.currency_code !== "string" || (currency && amount.currency_code !== currency)) return null;
  const [whole, fraction = ""] = amount.value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Shared by proposal inputs and rate snapshots; never shorten agreed descriptions. */
export function validateInvoiceItemDescription(description: unknown): void {
  if (typeof description !== "string" || !description.trim() || description.length > 1000) {
    throw new Error("Line-item description required (maximum 1000 characters)");
  }
}

/** Validate the lossless itemized representation before accepting proposal terms. */
export function validateItemizedInvoiceTerms(terms: Pick<ApprovedInvoiceTerms, "currency" | "totalMinor" | "lineItems">): void {
  if (terms.currency !== "USD") throw new Error("This demo supports USD only");
  if (!Array.isArray(terms.lineItems) || !terms.lineItems.length) throw new Error("Invoice line items required");
  let sum = 0;
  for (const item of terms.lineItems) {
    validateInvoiceItemDescription(item.description);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unitAmountMinor) || item.unitAmountMinor < 1) throw new Error("Approved invoice item cannot be represented exactly");
    sum += item.quantity * item.unitAmountMinor;
  }
  if (!Number.isSafeInteger(sum) || sum !== terms.totalMinor) throw new Error("Approved item sum does not match approved total");
}

/** Deterministic provider tuples retain ordering and duplicate multiplicity. */
export function approvedProviderItems(terms: ApprovedInvoiceTerms): any[] {
  if (terms.representation === "aggregate-v0") {
    if (typeof terms.legacyDescription !== "string" || !terms.legacyDescription) throw new Error("Legacy invoice representation cannot be established");
    return [{ name: terms.legacyDescription.slice(0,120), description: terms.legacyDescription.slice(0,1000), quantity: "1", unit_amount: { currency_code: terms.currency, value: (terms.totalMinor/100).toFixed(2) } }];
  }
  if (terms.representation !== "itemized-v1" || !Array.isArray(terms.lineItems) || !terms.lineItems.length) throw new Error("Unknown approved invoice representation");
  validateItemizedInvoiceTerms(terms);
  const items = terms.lineItems.map(item => {
    return { name: item.description.slice(0,200), description: item.description, quantity: String(item.quantity), unit_amount: {currency_code:terms.currency,value:(item.unitAmountMinor/100).toFixed(2)} };
  });
  return items;
}

export function invoiceTermProblems(detail: InvoiceDetail, approved: ApprovedInvoiceTerms): string[] {
  const raw = detail.raw ?? {}, problems: string[] = [];
  if (raw.id !== approved.invoiceId || raw.invoicer?.email_address?.toLowerCase() !== approved.merchantEmail?.toLowerCase() ||
      raw.detail?.currency_code !== approved.currency || parseMoney(raw.amount,approved.currency) !== approved.totalMinor) problems.push("Invoice identity, merchant, currency or total differs from approved terms");
  try {
    const expected = approvedProviderItems(approved);
    if (!Array.isArray(raw.items) || raw.items.length !== expected.length || expected.some((item,i)=>{
      const actual=raw.items[i];
      return actual?.name!==item.name || actual.description!==item.description ||
        typeof actual.quantity!=="string" || !/^\d+(?:\.0+)?$/.test(actual.quantity) || Number(actual.quantity)!==Number(item.quantity) ||
        parseMoney(actual.unit_amount,approved.currency)!==parseMoney(item.unit_amount,approved.currency);
    })) problems.push("Invoice items differ from the recorded approved representation");
    if (approved.representation === "itemized-v1" && (!approved.reference || raw.detail?.reference !== approved.reference)) problems.push("Invoice revision reference differs from the approval");
  } catch(error) { problems.push(error instanceof Error ? error.message : String(error)); }
  // Check every money object, including optional breakdowns and transaction entries.
  function checkMoney(value:any):void {
    if (!value || typeof value!=="object") return;
    if ("currency_code" in value && "value" in value && parseMoney(value,approved.currency)===null) problems.push("Malformed amount or currency disagreement");
    for (const child of Object.values(value)) checkMoney(child);
  }
  checkMoney(raw);
  for (const [key,value] of Object.entries(raw.amount?.breakdown ?? {})) {
    if (key === "item_total") { if(parseMoney(value,approved.currency)!==approved.totalMinor) problems.push("Item total differs from approval"); }
    else if(parseMoney(value,approved.currency)!==0) problems.push("Unapproved invoice adjustment");
  }
  if(raw.gratuity && parseMoney(raw.gratuity,approved.currency)!==0) problems.push("Unapproved gratuity");
  if(raw.configuration?.allow_tip || raw.detail?.payment_term?.discount || raw.detail?.payment_term?.late_fee) problems.push("Unapproved conditional terms");
  for(const item of Array.isArray(raw.items)?raw.items:[]) if(item.tax || item.discount) problems.push("Unapproved item adjustment");
  return [...new Set(problems)];
}

export function deriveFinancialState(detail: InvoiceDetail, approved: ApprovedInvoiceTerms): FinancialState {
  const raw=detail.raw ?? {}, status=raw.status;
  const invoiceStates:Record<string,FinancialState["invoiceState"]>={DRAFT:"draft",SCHEDULED:"scheduled",SENT:"payable",UNPAID:"payable",SHARED:"payable",PARTIALLY_PAID:"payable",PAYMENT_PENDING:"closed",PAID:"closed",MARKED_AS_PAID:"closed",PAID_EXTERNAL:"closed",CANCELLED:"cancelled",AUTO_CANCELLED:"cancelled",REFUNDED:"closed",PARTIALLY_REFUNDED:"closed",MARKED_AS_REFUNDED:"closed",REFUNDED_EXTERNAL:"closed"};
  const known=typeof status==="string" && Object.hasOwn(invoiceStates,status);
  const problems=invoiceTermProblems(detail,approved);
  const due=parseMoney(raw.due_amount,approved.currency), paid=parseMoney(raw.payments?.paid_amount,approved.currency), refund=parseMoney(raw.refunds?.refund_amount,approved.currency);
  const state:FinancialState={invoiceState:known?invoiceStates[status]:"unknown",paymentState:"unknown",rawStatus:status??null,amountDueMinor:due,paidMinor:paid,refundedMinor:refund,observedAt:new Date().toISOString(),representation:approved.representation??"unknown",merchantProvenance:approved.merchantProvenance??"legacy-configuration",issues:problems};
  function transactions(group:any,aggregate:number|null,idKey:string):boolean {
    if(group===undefined || group===null)return false;
    if(typeof group!=="object" || Array.isArray(group) || aggregate===null){problems.push("Missing or malformed payment/refund aggregate");return false;}
    if(group.transactions===undefined)return false;
    if(!Array.isArray(group.transactions) || !group.transactions.length){if(aggregate>0)problems.push("Positive aggregate has no transactions");return false;}
    let sum=0;const ids=new Set<string>();let paypal=true;
    for(const tx of group.transactions){
      const amount=parseMoney(tx?.amount,approved.currency);
      if(amount===null || typeof tx?.[idKey]!=="string" || !tx[idKey] || ids.has(tx[idKey]) ||
          (tx.status!==undefined && tx.status!=="SUCCESS"))problems.push("Conflicting or unsupported transaction evidence");
      ids.add(tx?.[idKey]);sum+=amount??0;
      if(tx?.type!=="PAYPAL"){paypal=false;problems.push("Settlement provenance is external or unknown");}
    }
    if(!Number.isSafeInteger(sum) || sum!==aggregate)problems.push("Transaction sum differs from aggregate");
    return paypal;
  }
  const paidPaypal=transactions(raw.payments,paid,"payment_id"),refundPaypal=transactions(raw.refunds,refund,"refund_id");
  if(raw.due_amount!==undefined && due===null)problems.push("Malformed due amount");
  if(due!==null && due>approved.totalMinor)problems.push("Due amount exceeds approved total");
  if(paid!==null && paid>approved.totalMinor)problems.push("Payment exceeds approved total");
  if(refund!==null && refund>0 && (paid===null || refund>paid))problems.push("Refund exceeds evidenced payment");
  // Unknown provider status stays unknown, even when its amounts resemble settlement.
  if(!known)return state;
  if(problems.length){state.paymentState="review_required";return state;}
  const noRefund=refund===null || refund===0;
  const coherentPayment=paid!==null && paid>0 && paidPaypal;
  const coherentRefund=coherentPayment && refund!==null && refund>0 && refund<=paid! && refundPaypal;
  switch(status){
    case "DRAFT": case "SCHEDULED": state.paymentState=(!paid && !refund && (due===null || due===approved.totalMinor))?"not_started":"review_required";break;
    case "SENT": case "UNPAID": case "SHARED": state.paymentState=(due===approved.totalMinor && due>0 && !paid && noRefund && (status!=="SHARED" || !!raw.detail?.metadata?.recipient_view_url))?"due":"review_required";break;
    case "PARTIALLY_PAID": state.paymentState=(coherentPayment && paid!<approved.totalMinor && due!==null && due>0 && due+(paid!)===approved.totalMinor && noRefund)?"partial":"review_required";break;
    case "PAYMENT_PENDING": state.paymentState="pending";break;
    case "PAID": state.paymentState=(due===0 && paid===approved.totalMinor && paidPaypal && noRefund)?"paid":"review_required";break;
    case "REFUNDED": state.paymentState=(coherentRefund && refund===paid)?"refunded":"review_required";break;
    case "PARTIALLY_REFUNDED": state.paymentState=(coherentRefund && refund!<paid!)?"partially_refunded":"review_required";break;
    case "CANCELLED": case "AUTO_CANCELLED": state.paymentState=coherentRefund?(refund===paid?"refunded":"partially_refunded"):(paid || refund)?"review_required":"unknown";break;
    default: state.paymentState="review_required";
  }
  if(state.paymentState==="review_required" && !problems.length)problems.push("Provider status lacks coherent PayPal financial evidence");
  return state;
}

/** Older consumers receive a safe non-actionable status for unsupported outcomes. */
export function compatibilityStatus(state:FinancialState):"paid"|"payment_due"|"payment_review_required" {
  return state.paymentState==="paid"?"paid":state.invoiceState==="payable" && ["due","partial"].includes(state.paymentState)?"payment_due":"payment_review_required";
}

