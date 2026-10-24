import {ScopedAccessError,DOMAIN_ERROR_CODES} from './context.js';
import {SourceUnavailableError,SourceObservationSupersededError} from './requestSources.js';
import {FigmaRequestError} from './figma.js';
import {PayPalRequestError} from './paypal.js';
import {AssessmentOutputError} from './assessment.js';

// ---- Stable sanitized domain codes. Messages are matched here and never leave the process. ----
const CONFLICTS:[RegExp,string][]=[
 [/limit reached/i,'budget_exhausted'],
 [/revision changed/i,'stale_revision'],
 [/operation id belongs/i,'operation_conflict'],
 [/attempt is (rejected|uncertain)|did not complete|superseded|saved assessment is unavailable/i,'attempt_unresolved'],
 [/source is unavailable|source unavailable/i,'source_unavailable'],
 [/reviewed item|assessment differs|source or scope context changed|source changed|context changed|anchor changed|request changed|unknown current canonical|evidence changed|stale|pixels|differs from/i,'stale_reference'],
];
// Pre-existing plain refusals without a status (eligible(), reserve(), assessment, providers).
const PLAIN:[RegExp,string][]=[
 [/not eligible billable work/i,'item_not_billable'],
 [/already reserved or committed/i,'item_already_reserved'],
 [/duplicate|lineage|overlapping/i,'designer_review_required'],
 [/one current assessment|source or scope context changed|scope or rates changed|scope or commitments changed/i,'stale_reference'],
 [/select unique eligible item ids/i,'invalid_arguments'],
 [/budget exhausted/i,'budget_exhausted'],
 [/authority changed/i,'unauthorized'],
 [/not found/i,'not_found'],
 [/was reset|association changed/i,'conflict'],
 [/baseten|ai assessment did not complete|ai returned no assessment|figma|paypal|invoice reconciliation/i,'provider_unavailable'],
];
/** Compatibility for pre-existing adapters. Message text stays inside this explicit boundary. */
export function legacyAdapterCodeFor(error:Error,status?:number):string {
 if(status===400)return /root comment/i.test(error.message)?'source_not_found':/canonical bounds/i.test(error.message)?'source_unavailable':'invalid_arguments';
 if(status===409)return CONFLICTS.find(([pattern])=>pattern.test(error.message))?.[1]??'conflict';
 return PLAIN.find(([pattern])=>pattern.test(error.message))?.[1]??'internal_error';
}
export function codeFor(error:unknown):string {
 if(error instanceof SourceUnavailableError)return 'source_unavailable';
 if(error instanceof SourceObservationSupersededError)return 'stale_reference';
 if(error instanceof ScopedAccessError){
  if(error.code&&DOMAIN_ERROR_CODES.includes(error.code))return error.code;
  if(error.status===401)return 'unauthorized';
  if(error.status===403)return 'forbidden';
  if(error.status===404)return 'not_found';
  return legacyAdapterCodeFor(error,error.status);
 }
 if(error instanceof AssessmentOutputError)return 'assessment_failed';
 if(error instanceof FigmaRequestError||error instanceof PayPalRequestError)return 'provider_unavailable';
 return error instanceof Error?legacyAdapterCodeFor(error):'internal_error';
}
/** Sanitized reporter: event, operation, code, correlation ID and error class only. */
export function report(event:string,details:Record<string,unknown>={},error?:unknown){
 console.warn(JSON.stringify({component:'mcp',event,...details,...(error instanceof Error?{errorName:error.name}:{})}));
}
