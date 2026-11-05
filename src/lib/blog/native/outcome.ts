import {AdminMenuError} from '../../data/admin-menus'
/** The remote side answered and we know nothing usable (or billable) happened:
 * 4xx, malformed JSON, oversize body, content that fails validation. The
 * operation becomes `failed` and never blocks the tenant. */
export class NativeBlogDefinitiveError extends AdminMenuError{constructor(message='Blog operation failed; no paid call is pending'){super(409,message)}}
/** Genuinely unknown: timeout or network loss after the request left, a 5xx,
 * or a commit whose result we cannot see. Only this becomes `reconcile`. */
export class NativeBlogUnknownOutcomeError extends AdminMenuError{constructor(message='Blog outcome needs reconciliation; the request will not be repeated automatically'){super(409,message)}}
/** 4xx except 408 (request timeout) is a definitive refusal; 5xx and anything else is unknown. */
export const definitiveHttpStatus=(status:number)=>status>=400&&status<500&&status!==408
