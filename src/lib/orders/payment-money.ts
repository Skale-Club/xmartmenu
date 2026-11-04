/** Existing Stripe minor-unit rules; pure and shared by legacy/owned paths. */
const ZERO_DECIMAL_CURRENCIES=new Set(['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'])
export function currencyMinorFactor(currency:string){return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())?1:100}
export function toStripeAmount(major:number,currency:string){return Math.round(Number(major)*currencyMinorFactor(currency))}
