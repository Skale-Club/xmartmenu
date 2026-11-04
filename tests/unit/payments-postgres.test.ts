import { randomUUID } from 'node:crypto'
import { describe,it,expect,vi } from 'vitest'
import { OwnedPaymentRepository, PaymentDataError, paymentMoney, paymentsDataOwned, type PaymentSnapshot, type PaymentQuery } from '@/lib/data/payments'
import { getOwnedPaymentIntent,intentIdempotencyKey,type PaymentAccess,type OwnedPaymentGateway,type OwnedIntent } from '@/lib/orders/owned-payment-intent'
const tenant=randomUUID(),id=randomUUID(),user=randomUUID()
const snapshot=():PaymentSnapshot=>({order:{id,tenant_id:tenant,customer_id:user,status:'awaiting_payment',total:'20.00',currency:null,tip_cents:200,payment_intent_id:null},
  config:{currency:'usd',stripe_account_id:'acct_fixture',payments:true,stripe:true,fee:0.1}})
const intent=(patch:Partial<OwnedIntent>={}):OwnedIntent=>({id:'pi_fixture',amount:2000,currency:'usd',status:'requires_payment_method',client_secret:'synthetic-client-secret',transfer_data:{destination:'acct_fixture'},application_fee_amount:180,metadata:{order_id:id,tenant_id:tenant},...patch})
function fixture(current=snapshot()){
  const repo={snapshot:vi.fn(async()=>current),claim:vi.fn(async()=>true)}
  const access={read:async(operation:(repository:unknown)=>unknown)=>operation(repo),write:async(operation:(repository:unknown)=>unknown)=>operation(repo)} as PaymentAccess
  const gateway:OwnedPaymentGateway={create:vi.fn(async()=>intent()),retrieve:vi.fn(async()=>intent()),cancel:vi.fn(async()=>({status:'canceled'}))}
  return{repo,access,gateway}
}
describe('owned payment intent orchestration',()=>{
  it('defaults off and charges database amount/tip/currency/fee without trusting caller prices',async()=>{
    expect(paymentsDataOwned({})).toBe(false)
    const f=fixture()
    expect((await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:0.01,tipCents:999999},f.gateway,f.access)).paymentIntentId).toBe('pi_fixture')
    expect(f.gateway.create).toHaveBeenCalledWith(expect.objectContaining({amount:2000,currency:'usd',application_fee_amount:180,metadata:{order_id:id,tenant_id:tenant}}),expect.stringMatching(/^xmartmenu-order-v1-[a-f0-9]{64}$/))
  })
  it('preserves zero fees and zero-decimal currencies while keeping NULL snapshot currency',()=>{
    const s=snapshot();s.config.fee=0;expect(paymentMoney(s).fee).toBe(0)
    s.config.currency='jpy';s.order.total='100';s.order.tip_cents=1000;s.config.fee=0.1
    expect(paymentMoney(s)).toEqual({amount:100,currency:'jpy',fee:9});expect(s.order.currency).toBeNull()
    s.order.currency='eur';expect(paymentMoney(s).currency).toBe('eur')
    s.order.total='NaN';expect(()=>paymentMoney(s)).toThrow(PaymentDataError)
  })
  it('reuses a matching intent and refuses foreign metadata before cancellation or minting',async()=>{
    const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
    await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)
    expect(f.gateway.create).not.toHaveBeenCalled()
    vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({metadata:{order_id:randomUUID(),tenant_id:tenant}}))
    await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toMatchObject({status:409})
    expect(f.gateway.cancel).not.toHaveBeenCalled();expect(f.gateway.create).not.toHaveBeenCalled()
  })
  it('replaces only confirmable intents with a stale/missing destination or application fee',async()=>{
    const differences:Partial<OwnedIntent>[]=[{transfer_data:{destination:'acct_previous'}},{application_fee_amount:0},{application_fee_amount:null},
      {application_fee_amount:undefined},{transfer_data:null},{transfer_data:undefined},{transfer_data:{destination:null}},{transfer_data:{destination:{}}}]
    for(const patch of differences){
      const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
      vi.mocked(f.gateway.retrieve).mockResolvedValue(intent(patch))
      await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)
      expect(f.gateway.cancel).toHaveBeenCalledWith('pi_previous');expect(f.gateway.create).toHaveBeenCalledTimes(1)
    }
  })
  it('accepts an expanded account ID only when fee and destination exactly match',async()=>{
    const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
    vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({transfer_data:{destination:{id:'acct_fixture'}}}))
    await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)
    expect(f.gateway.cancel).not.toHaveBeenCalled();expect(f.gateway.create).not.toHaveBeenCalled()
  })
  it('never cancels/replaces settled, authorized-capture or ambiguous intents with different financial facts',async()=>{
    for(const status of ['succeeded','processing','requires_capture','unknown_provider_state']){
      const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
      vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({status,transfer_data:{destination:'acct_previous'},application_fee_amount:null}))
      await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toMatchObject({status:409})
      expect(f.gateway.cancel).not.toHaveBeenCalled();expect(f.gateway.create).not.toHaveBeenCalled()
    }
  })
  it('does not return a provider-created or CAS-winning intent with a wrong destination/fee',async()=>{
    const f=fixture();vi.mocked(f.gateway.create).mockResolvedValue(intent({application_fee_amount:0}))
    await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toMatchObject({status:503})
    expect(f.repo.claim).not.toHaveBeenCalled()
    const s=snapshot(),race=fixture(s);race.repo.claim.mockResolvedValue(false)
    race.repo.snapshot.mockResolvedValueOnce(s).mockResolvedValueOnce({...s,order:{...s.order,payment_intent_id:'pi_winner'}})
    vi.mocked(race.gateway.retrieve).mockResolvedValue(intent({id:'pi_winner',transfer_data:{destination:'acct_previous'}}))
    await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},race.gateway,race.access)).rejects.toMatchObject({status:409})
  })
  it('never mints another intent for a mismatched succeeded/processing payment',async()=>{
    for(const status of ['succeeded','processing']){
      const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
      vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({status,amount:1500}))
      await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toMatchObject({status:409})
      expect(f.gateway.create).not.toHaveBeenCalled();expect(f.gateway.cancel).not.toHaveBeenCalled()
    }
  })
  it('requires confirmed cancellation before replacing a mismatched confirmable intent',async()=>{
    const s=snapshot();s.order.payment_intent_id='pi_previous';const f=fixture(s)
    vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({amount:1500}));vi.mocked(f.gateway.cancel).mockRejectedValue(Error('offline provider failure'))
    await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toThrow()
    expect(f.gateway.create).not.toHaveBeenCalled()
  })
  it('does not cancel a shared provider-idempotency winner after losing CAS',async()=>{
    const s=snapshot(),f=fixture(s);f.repo.claim.mockResolvedValue(false)
    f.repo.snapshot.mockResolvedValueOnce(s).mockResolvedValueOnce({...s,order:{...s.order,payment_intent_id:'pi_fixture'}})
    expect((await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).paymentIntentId).toBe('pi_fixture')
    expect(f.gateway.cancel).not.toHaveBeenCalled()
  })
  it('cancels an orphan and validates a different winning intent before returning its secret',async()=>{
    const s=snapshot(),f=fixture(s);f.repo.claim.mockResolvedValue(false)
    f.repo.snapshot.mockResolvedValueOnce(s).mockResolvedValueOnce({...s,order:{...s.order,payment_intent_id:'pi_winner'}})
    vi.mocked(f.gateway.retrieve).mockResolvedValue(intent({id:'pi_winner'}))
    expect((await getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).paymentIntentId).toBe('pi_winner')
    expect(f.gateway.cancel).toHaveBeenCalledWith('pi_fixture')
  })
  it('does not blindly cancel or retry an ambiguous claim/COMMIT failure',async()=>{
    const f=fixture();f.repo.claim.mockRejectedValue(new PaymentDataError(503,'Payment service is unavailable'))
    await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toMatchObject({status:503})
    expect(f.gateway.create).toHaveBeenCalledTimes(1);expect(f.gateway.cancel).not.toHaveBeenCalled()
  })
  it('fails closed for disabled plans/canceled orders/changed requested currency before Stripe',async()=>{
    for(const mutate of [(s:PaymentSnapshot)=>{s.config.payments=false},(s:PaymentSnapshot)=>{s.order.status='cancelled'}]){
      const s=snapshot();mutate(s);const f=fixture(s)
      await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20},f.gateway,f.access)).rejects.toBeInstanceOf(PaymentDataError)
      expect(f.gateway.create).not.toHaveBeenCalled();expect(f.gateway.retrieve).not.toHaveBeenCalled()
    }
    const f=fixture();await expect(getOwnedPaymentIntent({tenantId:tenant,orderId:id,amountDollars:20,currency:'eur'},f.gateway,f.access)).rejects.toMatchObject({status:409})
    expect(f.gateway.create).not.toHaveBeenCalled()
  })
  it('provider retry key is stable for a snapshot and changes only with charge-defining facts',()=>{
    const a=snapshot(),b=structuredClone(a);expect(intentIdempotencyKey(a)).toBe(intentIdempotencyKey(b))
    b.order.total='21';expect(intentIdempotencyKey(a)).not.toBe(intentIdempotencyKey(b))
  })
})
describe('owned payment repository boundary',()=>{
  it('tenant-scopes CAS and retains intent and payable-state predicates',async()=>{
    const s=snapshot(),calls:Array<{text:string;values?:unknown[]}>=[]
    const query:PaymentQuery=async(text,values)=>{calls.push({text,values});return{rows:text.startsWith('UPDATE')?[{id}]:[]}}
    const repo=new OwnedPaymentRepository(query);vi.spyOn(repo,'snapshot').mockResolvedValue(s)
    expect(await repo.claim(s,'pi_fixture')).toBe(true)
    expect(calls[0].text).toContain('tenant_id=$1 AND id=$2 AND payment_intent_id IS NOT DISTINCT FROM $4')
    expect(calls[0].text).toContain("status IN ('awaiting_payment','pending','payment_failed')")
    expect(calls[0].values?.slice(0,4)).toEqual([tenant,id,'pi_fixture',null])
  })
  it('refuses arbitrary order references and malformed evidence before SQL',async()=>{
    const query=vi.fn(async()=>({rows:[]})),repo=new OwnedPaymentRepository(query)
    await expect(repo.order('not-an-id')).rejects.toMatchObject({status:400})
    await expect(repo.applySignal({id:'pi_fixture',amount:1,currency:'usdX',metadata:{order_id:id}},'succeeded')).rejects.toMatchObject({status:400})
    expect(query).not.toHaveBeenCalled()
  })
  it('records event ledger after successful business handling in the same query/transaction scope',async()=>{
    const calls:string[]=[],query:PaymentQuery=async(text)=>{calls.push(text);return{rows:[]}}
    const repo=new OwnedPaymentRepository(query);vi.spyOn(repo,'applySignal').mockResolvedValue({ok:true,changed:true,status:'paid'})
    await repo.event({id:'evt_fixture',type:'payment_intent.succeeded',data:{object:intent()}})
    expect(repo.applySignal).toHaveBeenCalledTimes(1);expect(calls.at(-1)).toContain('INSERT INTO public.processed_stripe_events')
  })
})
