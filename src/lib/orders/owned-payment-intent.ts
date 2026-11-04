import { createHash } from 'node:crypto'
import { withOwnedPayments } from '../data/payments-runtime'
import { assertPayable, PaymentDataError, paymentMoney, type OwnedPaymentRepository, type PaymentSnapshot } from '../data/payments'
export type OwnedIntent={id:string;amount:number;currency:string;status:string;client_secret:string|null;transfer_data?:{destination?:string|{id?:string}|null}|null;application_fee_amount?:number|null;metadata?:{order_id?:string;tenant_id?:string}|null}
export type IntentCreateBody={amount:number;currency:string;application_fee_amount:number;automatic_payment_methods:{enabled:true};transfer_data:{destination:string};metadata:{order_id:string;tenant_id:string}}
export interface OwnedPaymentGateway {
  retrieve:(id:string)=>Promise<OwnedIntent>
  create:(body:IntentCreateBody,idempotencyKey:string)=>Promise<OwnedIntent>
  cancel:(id:string)=>Promise<{status:string}>
}
export interface PaymentAccess {
  read:<T>(operation:(repository:OwnedPaymentRepository)=>Promise<T>)=>Promise<T>
  write:<T>(operation:(repository:OwnedPaymentRepository)=>Promise<T>)=>Promise<T>
}
const runtimeAccess:PaymentAccess={read:operation=>withOwnedPayments(false,operation),write:operation=>withOwnedPayments(true,operation)}
export type PaymentIntentParams={tenantId:string;orderId:string;amountDollars:number;tipCents?:number;currency?:string}
function matches(intent:OwnedIntent,snapshot:PaymentSnapshot){
  const money=paymentMoney(snapshot)
  if(intent.metadata?.order_id!==snapshot.order.id||intent.metadata?.tenant_id!==snapshot.order.tenant_id)throw new PaymentDataError(409,'Existing payment ownership must be reviewed')
  const rawDestination=intent.transfer_data?.destination
  const destination=typeof rawDestination==='string'?rawDestination:rawDestination&&typeof rawDestination==='object'?rawDestination.id:undefined
  // Missing/null facts never inherit the current destination or a zero fee.
  return intent.amount===money.amount&&intent.currency===money.currency
    &&typeof destination==='string'&&/^acct_[A-Za-z0-9]+$/.test(destination)&&destination===snapshot.config.stripe_account_id
    &&Number.isSafeInteger(intent.application_fee_amount)&&intent.application_fee_amount===money.fee
}
const confirmable=new Set(['requires_payment_method','requires_confirmation','requires_action'])
const reusable=new Set([...confirmable,'processing','succeeded','requires_capture'])
function result(intent:OwnedIntent){
  if(!/^pi_[A-Za-z0-9]+$/.test(intent.id)||typeof intent.client_secret!=='string'||!intent.client_secret||intent.client_secret.length>8192||!reusable.has(intent.status))throw new PaymentDataError(503,'Payment provider response is unavailable')
  return{paymentIntentId:intent.id,clientSecret:intent.client_secret}
}
export function intentIdempotencyKey(snapshot:PaymentSnapshot){
  const money=paymentMoney(snapshot)
  return 'xmartmenu-order-v1-'+createHash('sha256').update(JSON.stringify({tenant:snapshot.order.tenant_id,order:snapshot.order.id,
    previous:snapshot.order.payment_intent_id,...money,destination:snapshot.config.stripe_account_id})).digest('hex')
}
/** Provider requests never hold a DB connection; ambiguous commits are not retried or blindly cancelled. */
export async function getOwnedPaymentIntent(params:PaymentIntentParams,gateway:OwnedPaymentGateway,access:PaymentAccess=runtimeAccess){
  const snapshot=await access.read(repo=>repo.snapshot(params.orderId,params.tenantId))
  assertPayable(snapshot.order)
  if(!snapshot.config.payments||!snapshot.config.stripe)throw new PaymentDataError(403,'Payments not available on current plan')
  if(!snapshot.config.stripe_account_id)throw new PaymentDataError(403,'No active Stripe connection for tenant')
  const money=paymentMoney(snapshot)
  // Only the database decides amount/tip/currency, including historical snapshot currency.
  if(params.currency&&params.currency.toLowerCase()!==money.currency)throw new PaymentDataError(409,'Order currency changed')
  const previous=snapshot.order.payment_intent_id
  if(previous){
    const intent=await gateway.retrieve(previous)
    const same=matches(intent,snapshot)
    if(intent.status!=='canceled'&&same)return result(intent)
    if(intent.status!=='canceled'&&!confirmable.has(intent.status))throw new PaymentDataError(409,'Existing payment requires reconciliation')
    if(intent.status!=='canceled'){
      const canceled=await gateway.cancel(previous)
      if(canceled.status!=='canceled')throw new PaymentDataError(503,'Previous payment cancellation must be confirmed')
    }
  }
  const created=await gateway.create({amount:money.amount,currency:money.currency,application_fee_amount:money.fee,
    automatic_payment_methods:{enabled:true},transfer_data:{destination:snapshot.config.stripe_account_id},
    metadata:{order_id:snapshot.order.id,tenant_id:snapshot.order.tenant_id}},intentIdempotencyKey(snapshot))
  if(!matches(created,snapshot))throw new PaymentDataError(503,'Payment provider financial facts changed')
  const output=result(created)
  // On a transaction/COMMIT error, leave the provider intent intact. A retry's
  // deterministic provider key or recorded intent resolves which side committed.
  const claimed=await access.write(repo=>repo.claim(snapshot,created.id))
  if(claimed)return output
  const winner=await access.read(repo=>repo.snapshot(params.orderId,params.tenantId))
  // Stripe can return the SAME intent to concurrent calls under the same key.
  // Never cancel that winner, even if our CAS returned no row.
  if(winner.order.payment_intent_id===created.id){assertPayable(winner.order);if(!matches(created,winner))throw new PaymentDataError(409,'Order payment facts changed');return output}
  try{await gateway.cancel(created.id)}catch{/* Orphan secret was never returned. Reconciliation remains observable through provider metadata. */}
  assertPayable(winner.order)
  if(winner.order.payment_intent_id){
    const intent=await gateway.retrieve(winner.order.payment_intent_id)
    if(matches(intent,winner)&&intent.status!=='canceled')return result(intent)
  }
  throw new PaymentDataError(409,'Could not attach a payment to this order, please try again')
}
