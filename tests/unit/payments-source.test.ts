import {randomUUID} from 'node:crypto'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {PaymentDataError} from '@/lib/data/payments'
const mock=vi.hoisted(()=>({cookie:vi.fn(),legacy:vi.fn(),transaction:vi.fn(),construct:vi.fn(),intent:vi.fn(),rate:vi.fn(),ownedRetrieve:vi.fn(),legacyRetrieve:vi.fn(),checkout:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createClient:mock.cookie,createServiceClient:mock.legacy}))
vi.mock('@/lib/data/payments-runtime',()=>({withOwnedPayments:mock.transaction,loadOwnedPaymentCheckout:mock.checkout}))
vi.mock('@/lib/stripe',()=>({stripe:{webhooks:{constructEvent:mock.construct},paymentIntents:{retrieve:mock.legacyRetrieve}},retrieveOwnedPaymentIntent:mock.ownedRetrieve,getOrCreatePaymentIntent:mock.intent,isStripeEnabled:vi.fn()}))
vi.mock('@/lib/tenant-plan',()=>({getTenantCapabilities:vi.fn(),reconcileTenantSettings:vi.fn()}))
vi.mock('@/lib/xphere/queue',()=>({enqueueXphereSync:vi.fn()}))
vi.mock('@/lib/ai/billing',()=>({billAiUsage:vi.fn(),subscriptionIdFromInvoice:vi.fn()}))
vi.mock('@/lib/rate-limit',()=>({rateLimit:mock.rate,getClientIp:()=> '127.0.0.1'}))
vi.mock('@/lib/observability',()=>({captureSecurityEvent:vi.fn()}))
vi.mock('@/lib/observability/log',()=>({log:{error:vi.fn(),warn:vi.fn()}}))
vi.mock('@/lib/observability/with-api',()=>({withApi:(_:string,handler:unknown)=>handler}))
import {POST as paymentRoute} from '@/app/api/stripe/payment-intents/route'
import {POST as webhookRoute} from '@/app/api/stripe/webhooks/route'
import ConfirmationPage from '@/app/(public)/checkout/[orderId]/confirmation/page'
const id=randomUUID(),tenant=randomUUID(),user=randomUUID(),forged=randomUUID()
const repo={authorizedOrder:vi.fn(),event:vi.fn()}
const request=(body:unknown)=>new Request('http://localhost/api/stripe/payment-intents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{
 vi.stubEnv('STRIPE_WEBHOOK_SECRET','offline-signature-key')
 vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED','true');vi.stubEnv('OWNED_ORDER_DATA_ENABLED','true')
 mock.rate.mockResolvedValue({ok:true});mock.cookie.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:user}},error:null})},from:()=>{throw Error('Legacy order data used')}})
 mock.legacy.mockImplementation(()=>{throw Error('Legacy data factory used')})
 mock.transaction.mockImplementation(async(_write:boolean,operation:(r:unknown)=>unknown)=>operation(repo))
 repo.authorizedOrder.mockResolvedValue({id,tenant_id:tenant,status:'awaiting_payment',total:'20.00',currency:null,tip_cents:200})
 mock.checkout.mockResolvedValue({id,tenant_id:tenant,status:'awaiting_payment',total:20,payment_intent_id:'pi_fixture',tenants:{slug:'fixture',name:'Fixture',tenant_settings:{currency:'usd'}}})
 mock.ownedRetrieve.mockResolvedValue({id:'pi_fixture',status:'requires_payment_method',last_payment_error:null})
 repo.event.mockResolvedValue({received:true});mock.intent.mockResolvedValue({clientSecret:'synthetic-client-secret',paymentIntentId:'pi_fixture'})
 mock.construct.mockReturnValue({id:'evt_fixture',type:'payment_intent.succeeded',data:{object:{id:'pi_fixture',amount:2000,currency:'usd',metadata:{order_id:id,tenant_id:tenant}}}})
})
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()})
describe('owned payment HTTP source selection',()=>{
 it('keeps authentication and database authorization and ignores body tenant/price',async()=>{
   const response=await paymentRoute(request({order_id:id,tenant_id:forged,amount:1}) as never,undefined)
   expect(response.status).toBe(200);expect(repo.authorizedOrder).toHaveBeenCalledWith(id,user)
   expect(mock.intent).toHaveBeenCalledWith({tenantId:tenant,orderId:id,amountDollars:20,tipCents:200,currency:undefined})
   expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('rejects anonymous and inaccessible order requests without minting payment intents',async()=>{
   repo.authorizedOrder.mockResolvedValue(null)
   expect((await paymentRoute(request({order_id:id}) as never,undefined)).status).toBe(404)
   mock.cookie.mockResolvedValue({auth:{getUser:async()=>({data:{user:null},error:null})}})
   expect((await paymentRoute(request({order_id:id}) as never,undefined)).status).toBe(401)
   expect(mock.intent).not.toHaveBeenCalled();expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('does not fallback to legacy data after owned SQL failures',async()=>{
   mock.transaction.mockRejectedValue(new PaymentDataError(503,'Payment service is unavailable'))
   expect((await paymentRoute(request({order_id:id}) as never,undefined)).status).toBe(503)
   expect(mock.legacy).not.toHaveBeenCalled();expect(mock.intent).not.toHaveBeenCalled()
 })
 it('verifies raw webhook signature before entering the atomic owned event/ledger transaction',async()=>{
   const raw='synthetic-signed-event',req=new Request('http://localhost/api/stripe/webhooks',{method:'POST',headers:{'stripe-signature':'offline-signature'},body:raw})
   const response=await webhookRoute(req as never,undefined)
   expect(response.status).toBe(200);expect(mock.construct).toHaveBeenCalledWith(raw,'offline-signature','offline-signature-key')
   expect(mock.transaction).toHaveBeenCalledWith(true,expect.any(Function));expect(repo.event).toHaveBeenCalledWith(mock.construct.mock.results[0].value)
   expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('returns retryable failure when the owned event transaction fails, without legacy acknowledgment',async()=>{
   mock.transaction.mockRejectedValue(new PaymentDataError(503,'Payment service is unavailable'))
   const req=new Request('http://localhost/api/stripe/webhooks',{method:'POST',headers:{'stripe-signature':'offline-signature'},body:'event'})
   expect((await webhookRoute(req as never,undefined)).status).toBe(500);expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('rejects signature failures before all database access',async()=>{
   mock.construct.mockImplementation(()=>{throw Error('offline signature rejected')})
   const req=new Request('http://localhost/api/stripe/webhooks',{method:'POST',headers:{'stripe-signature':'offline-signature'},body:'event'})
   expect((await webhookRoute(req as never,undefined)).status).toBe(400)
   expect(mock.transaction).not.toHaveBeenCalled();expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('confirmation uses the bounded own provider reader without the legacy SDK reader or data factory',async()=>{
   await ConfirmationPage({params:Promise.resolve({orderId:id})})
   expect(mock.ownedRetrieve).toHaveBeenCalledWith('pi_fixture')
   expect(mock.legacyRetrieve).not.toHaveBeenCalled();expect(mock.legacy).not.toHaveBeenCalled()
 })
 it('the actual shared owned provider helper enforces6s/retry0 and sanitizes SDK failure',async()=>{
   vi.stubEnv('STRIPE_SECRET_KEY',randomUUID())
   const actual=await vi.importActual<typeof import('@/lib/stripe')>('@/lib/stripe')
   const retrieve=vi.spyOn(actual.stripe.paymentIntents,'retrieve').mockResolvedValue({id:'pi_fixture'} as never)
   try{
     await actual.retrieveOwnedPaymentIntent('pi_fixture')
     expect(retrieve).toHaveBeenCalledWith('pi_fixture',{},expect.objectContaining({timeout:6000,maxNetworkRetries:0}))
     retrieve.mockRejectedValue(Error('sensitive provider diagnostics'))
     await expect(actual.retrieveOwnedPaymentIntent('pi_fixture')).rejects.toMatchObject({status:503,message:'Payment provider is unavailable'})
   }finally{retrieve.mockRestore()}
 })})
