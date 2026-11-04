import { OwnedOrderRepository } from './orders'
import { normalizeRole } from '../auth/role-utils'
import { planCeiling } from '../service-modes'
import { isOrderStatus, paymentTransition, type PaymentSignal } from '../orders/status-machine'
import { currencyMinorFactor, toStripeAmount } from '../orders/payment-money'
export type PaymentQuery=(text:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>
export class PaymentDataError extends Error { constructor(public status:number,message:string){super(message)} }
export const paymentsDataOwned=(env:Record<string,string|undefined>=process.env)=>env.OWNED_PAYMENT_DATA_ENABLED==='true'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const payable=new Set(['awaiting_payment','pending','payment_failed'])
const paidLike=new Set(['paid','preparing','ready','out_for_delivery','done'])
export type PaymentOrder={id:string;tenant_id:string;customer_id:string|null;status:string;total:string|number;
  tip_cents:number;currency:string|null;payment_intent_id:string|null}
export type PaymentConfiguration={currency:string|null;stripe_account_id:string|null;payments:boolean;stripe:boolean;fee:number}
export type PaymentSnapshot={order:PaymentOrder;config:PaymentConfiguration}
export type PaymentFacts={id:string;amount:number;currency:string;metadata?:{order_id?:string;tenant_id?:string}|null}
export type CheckoutOrder=PaymentOrder&{order_items:Array<Record<string,unknown>>;tenants:{slug:string;name:string;tenant_settings:{currency:string|null}}}
export function assertPayable(order:PaymentOrder){if(!payable.has(order.status))throw new PaymentDataError(409,'Order is not awaiting payment')}
export function paymentMoney(snapshot:PaymentSnapshot){
  const {order,config}=snapshot,currency=(order.currency??config.currency??'usd').toLowerCase()||'usd'
  const total=Number(order.total),tip=Number(order.tip_cents??0),amount=toStripeAmount(total,currency)
  const tipMinor=Math.round(tip/100*currencyMinorFactor(currency)),fee=Math.floor(Math.max(0,amount-tipMinor)*config.fee)
  if(!/^[a-z]{3}$/.test(currency)||!Number.isFinite(total)||total<=0||!Number.isSafeInteger(amount)||amount<1
    ||!Number.isSafeInteger(tip)||tip<0||!Number.isFinite(config.fee)||config.fee<0||config.fee>1||!Number.isSafeInteger(fee)||fee<0||fee>amount)
    throw new PaymentDataError(503,'Payment configuration must be verified')
  return{currency,amount,fee}
}
export class OwnedPaymentRepository {
  constructor(private query:PaymentQuery){}
  async order(id:string,tenantId?:string,lock=false):Promise<PaymentOrder|null>{
    if(!UUID.test(id)||(tenantId!==undefined&&!UUID.test(tenantId)))throw new PaymentDataError(400,'Invalid order')
    const result=await this.query(`SELECT id,tenant_id,customer_id,status,total,tip_cents,currency,payment_intent_id FROM public.orders
      WHERE id=$1${tenantId?' AND tenant_id=$2':''}${lock?' FOR UPDATE':''}`,[id,...(tenantId?[tenantId]:[])])
    const order=result.rows[0] as PaymentOrder|undefined
    if(result.rows.length>1||order&&(!UUID.test(order.tenant_id)||!isOrderStatus(order.status)))throw new PaymentDataError(503,'Order data is unavailable')
    return order??null
  }
  async configuration(tenantId:string,lock=false):Promise<PaymentConfiguration>{
    if(!UUID.test(tenantId))throw new PaymentDataError(400,'Invalid tenant')
    if(lock){
      // A parent UPDATE lock prevents new FK references; row locks also stop
      // activation/repricing of existing settings/subscription/connection rows.
      await this.query('SELECT id FROM public.tenants WHERE id=$1 FOR UPDATE',[tenantId])
      for(const table of ['tenant_settings','tenant_subscriptions','stripe_connections'])
        await this.query(`SELECT tenant_id FROM public.${table} WHERE tenant_id=$1 FOR SHARE`,[tenantId])
      await this.query('SELECT p.id FROM public.plans p JOIN public.tenant_subscriptions s ON s.plan_id=p.id WHERE s.tenant_id=$1 FOR SHARE OF p',[tenantId])
    }
    const sub=await this.query(`SELECT s.status,p.features,coalesce(s.override_transaction_fee_pct,p.transaction_fee_pct,0.005) AS fee,
      settings.currency FROM public.tenants t LEFT JOIN public.tenant_settings settings ON settings.tenant_id=t.id
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id=t.id LEFT JOIN public.plans p ON p.id=s.plan_id WHERE t.id=$1 LIMIT 2`,[tenantId])
    if(sub.rows.length>1)throw new PaymentDataError(503,'Payment configuration must be verified')
    const row=sub.rows[0],features=row&&['active','trial'].includes(String(row.status))?row.features:[]
    if(!Array.isArray(features)||features.some(f=>typeof f!=='string'))throw new PaymentDataError(503,'Payment plan data is unavailable')
    const ceiling=planCeiling(features)
    const connections=await this.query('SELECT stripe_account_id FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true LIMIT 2',[tenantId])
    if(connections.rows.length>1)throw new PaymentDataError(503,'Ambiguous active payment connection')
    const account=connections.rows[0]?.stripe_account_id??null
    if(account!==null&&(typeof account!=='string'||!/^acct_[A-Za-z0-9]+$/.test(account)))throw new PaymentDataError(503,'Payment connection is unavailable')
    return{currency:row?.currency===null||row?.currency===undefined?null:String(row.currency),stripe_account_id:account as string|null,
      payments:ceiling.payments,stripe:ceiling.stripe,fee:Number(row?.fee??0.005)}
  }
  async snapshot(id:string,tenantId:string,lock=false){const order=await this.order(id,tenantId,lock);if(!order)throw new PaymentDataError(404,'Order not found');return{order,config:await this.configuration(tenantId,lock)}}
  async authorizedOrder(id:string,userId:string){
    if(!UUID.test(userId))throw new PaymentDataError(401,'Unauthorized')
    const order=await this.order(id);if(!order)return null
    const profile=(await this.query('SELECT role,tenant_id FROM public.profiles WHERE id=$1',[userId])).rows[0]
    const role=normalizeRole(profile?.role),member=profile?.tenant_id===order.tenant_id,superadmin=role==='superadmin'
    if(!member&&!superadmin&&order.customer_id!==userId)return null
    if(order.payment_intent_id&&!member&&!superadmin)throw new PaymentDataError(403,'Forbidden')
    return order
  }
  async checkout(id:string):Promise<CheckoutOrder|null>{
    const order=await this.order(id);if(!order)return null
    const tenant=(await this.query(`SELECT t.slug,t.name,s.currency FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.id=$1`,[order.tenant_id])).rows[0]
    if(!tenant)return null
    const items=await this.query(`SELECT oi.id,oi.product_name,oi.quantity,oi.unit_price,oi.selected_options
      FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id AND o.tenant_id=$1 WHERE oi.order_id=$2 ORDER BY oi.id LIMIT 1001`,[order.tenant_id,id])
    if(items.rows.length>1000)throw new PaymentDataError(503,'Order items are unavailable')
    return{...order,order_items:items.rows,tenants:{slug:String(tenant.slug),name:String(tenant.name),tenant_settings:{currency:tenant.currency===null?null:String(tenant.currency)}}}
  }
  async claim(snapshot:PaymentSnapshot,intentId:string){
    if(!/^pi_[A-Za-z0-9]+$/.test(intentId))throw new PaymentDataError(503,'Payment provider response is unavailable')
    // Re-read configuration before a CAS; network calls never hold a SQL lease.
    const current=await this.snapshot(snapshot.order.id,snapshot.order.tenant_id,true)
    if(JSON.stringify(current.config)!==JSON.stringify(snapshot.config)||current.order.total!==snapshot.order.total
      ||current.order.currency!==snapshot.order.currency||current.order.tip_cents!==snapshot.order.tip_cents)return false
    const result=await this.query(`UPDATE public.orders SET payment_intent_id=$3,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND payment_intent_id IS NOT DISTINCT FROM $4 AND status IN ('awaiting_payment','pending','payment_failed')
      AND total=$5::numeric AND currency IS NOT DISTINCT FROM $6 AND tip_cents=$7 RETURNING id`,
    [snapshot.order.tenant_id,snapshot.order.id,intentId,snapshot.order.payment_intent_id,snapshot.order.total,snapshot.order.currency,snapshot.order.tip_cents])
    return result.rows.length===1
  }
  async divergence(order:PaymentOrder,intent:PaymentFacts,kind:string,details:Record<string,unknown>={}){
    await this.query(`INSERT INTO public.payment_divergences(order_id,tenant_id,payment_intent_id,kind,amount_minor,currency,details)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(payment_intent_id,kind) DO NOTHING`,[order.id,order.tenant_id,intent.id,kind,intent.amount,intent.currency,JSON.stringify(details)])
  }
  async applySignal(intent:PaymentFacts,signal:PaymentSignal):Promise<{ok:true;changed:boolean;status?:string}>{
    if(!intent.metadata?.order_id)return{ok:true,changed:false}
    if(!UUID.test(intent.metadata.order_id)||!/^pi_[A-Za-z0-9]+$/.test(intent.id)||!['succeeded','failed','canceled'].includes(signal)
      ||!Number.isSafeInteger(intent.amount)||intent.amount<0||typeof intent.currency!=='string'||!/^[a-z]{3}$/i.test(intent.currency))throw new PaymentDataError(400,'Invalid payment evidence')
    const order=await this.order(intent.metadata.order_id,undefined,true)
    if(!order)return{ok:true,changed:false}
    if(intent.metadata.tenant_id&&intent.metadata.tenant_id!==order.tenant_id){await this.divergence(order,intent,'tenant_mismatch',{metadata_tenant:intent.metadata.tenant_id});return{ok:true,changed:false,status:order.status}}
    const current=!order.payment_intent_id||order.payment_intent_id===intent.id
    if(!current&&signal!=='succeeded')return{ok:true,changed:false,status:order.status}
    if(signal==='succeeded'){
      const currency=(order.currency??(await this.configuration(order.tenant_id)).currency??'usd').toLowerCase()||'usd'
      if(intent.currency.toLowerCase()!==currency){await this.divergence(order,intent,'currency_mismatch',{expected:currency});return{ok:true,changed:false,status:order.status}}
      const total=Number(order.total),amount=toStripeAmount(total,currency)
      if(!/^[a-z]{3}$/.test(currency)||!Number.isFinite(total)||total<=0||!Number.isSafeInteger(amount)||amount<1)throw new PaymentDataError(503,'Order financial data must be verified')
      if(intent.amount<amount){await this.divergence(order,intent,'amount_below_total',{expected_minor:amount});return{ok:true,changed:false,status:order.status}}
      if(!current&&paidLike.has(order.status)){await this.divergence(order,intent,'second_payment',{current_intent:order.payment_intent_id});return{ok:true,changed:false,status:order.status}}
    }
    const transition=paymentTransition(order.status,signal)
    if(transition.divergence)await this.divergence(order,intent,transition.divergence)
    if(!transition.next)return{ok:true,changed:false,status:order.status}
    const updated=await this.query(`UPDATE public.orders SET status=$3,payment_intent_id=CASE WHEN $4 THEN $5 ELSE payment_intent_id END,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status=$6 RETURNING id,status`,[order.tenant_id,order.id,transition.next,signal==='succeeded',intent.id,order.status])
    if(updated.rows.length!==1)throw new PaymentDataError(409,'Order changed during payment synchronization')
    if(transition.next==='paid'||transition.next==='cancelled')await new OwnedOrderRepository(this.query,order.tenant_id).recordAnalytics(order.id,transition.next==='paid'?'order_completed':'order_cancelled')
    return{ok:true,changed:true,status:transition.next}
  }
  async event(event:{id:string;type:string;data:{object:PaymentFacts}}){
    const signals:Record<string,PaymentSignal>={'payment_intent.succeeded':'succeeded','payment_intent.payment_failed':'failed','payment_intent.canceled':'canceled'}
    if(!/^evt_[A-Za-z0-9]+$/.test(event.id)||!Object.hasOwn(signals,event.type))throw new PaymentDataError(400,'Invalid payment event')
    await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1,190732))',[event.id])
    const previous=(await this.query('SELECT event_type FROM public.processed_stripe_events WHERE event_id=$1',[event.id])).rows[0]
    if(previous){if(previous.event_type!==null&&previous.event_type!==event.type)throw new PaymentDataError(503,'Payment event identity conflict');return{received:true,skipped:true}}
    await this.applySignal(event.data.object,signals[event.type])
    // A ledger failure rolls back status/divergence too; Stripe may retry safely.
    await this.query('INSERT INTO public.processed_stripe_events(event_id,event_type,processed_at) VALUES($1,$2,now())',[event.id,event.type])
    return{received:true}
  }
}
