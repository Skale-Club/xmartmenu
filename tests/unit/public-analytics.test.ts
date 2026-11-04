import {randomUUID} from 'node:crypto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {ingestPublicAnalytics,readNativeAnalyticsBody} from '@/lib/data/public-analytics'
const batch=()=>({session:{id:randomUUID(),tenant_id:randomUUID(),menu_id:randomUUID()},events:[{client_event_id:randomUUID(),event_name:'menu_session_started',occurred_at:new Date().toISOString()}]})
afterEach(()=>vi.useRealTimers())
describe('native public analytics',()=>{
 it('uses only validated fixed client columns and parameterized tenant/session bindings',async()=>{
  const input=batch(),query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT s.analytics_enabled')?[{analytics_enabled:true}]:sql.startsWith('INSERT INTO public.menu_sessions')?[{id:input.session.id}]:[]}))
  expect(await ingestPublicAnalytics(query,input)).toEqual({ok:true,received:1})
  const calls=query.mock.calls as unknown as Array<[string,unknown[]]>
  expect(calls[0][1]).toEqual([input.session.tenant_id,input.session.menu_id]);expect(calls[1][1].slice(0,3)).toEqual([input.session.id,input.session.tenant_id,input.session.menu_id])
  const events=JSON.parse(calls[2][1][0] as string)
  expect(events[0]).toMatchObject({tenant_id:input.session.tenant_id,session_id:input.session.id,event_name:'menu_session_started'})
  expect(events[0]).not.toHaveProperty('amount');expect(events[0]).not.toHaveProperty('order_id')
  expect(calls[1][0]).toContain('GREATEST');expect(calls[2][0]).toContain('ON CONFLICT(client_event_id) DO NOTHING')
 })
 it('rejects client financial events, extra amount/order fields and expired timestamps before SQL',async()=>{
  const query=vi.fn()
  for(const override of [{event_name:'order_completed'},{amount:20},{order_id:randomUUID()},{occurred_at:'2000-01-01T00:00:00Z'}]){
   const input=batch();await expect(ingestPublicAnalytics(query,{...input,events:[{...input.events[0],...override}]})).rejects.toMatchObject({status:400})
  }
  expect(query).not.toHaveBeenCalled()
 })
 it('acknowledges disabled analytics without writing sessions or validating optional entities',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{analytics_enabled:false}]})
  expect(await ingestPublicAnalytics(query,batch())).toEqual({ok:true,received:0,disabled:true});expect(query).toHaveBeenCalledTimes(1)
 })
 it('refuses tuple conflicts without writing events',async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT s.analytics_enabled')?[{analytics_enabled:true}]:[]}))
  await expect(ingestPublicAnalytics(query,batch())).rejects.toMatchObject({status:409})
  expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO public.menu_events'))).toBe(false)
 })
 it('rejects oversized and stalled bodies without waiting for stalled cancellation',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65537))},cancel(){return new Promise(()=>{})}})
  await expect(readNativeAnalyticsBody(new Request('http://localhost',{method:'POST',body:stream,duplex:'half'} as RequestInit),10)).rejects.toMatchObject({status:413})
  vi.useFakeTimers()
  const partial=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(batch())))},cancel(){return new Promise(()=>{})}})
  const pending=readNativeAnalyticsBody(new Request('http://localhost',{method:'POST',body:partial,duplex:'half'} as RequestInit),10).catch(error=>error)
  await vi.advanceTimersByTimeAsync(11);expect(await pending).toMatchObject({status:400})
 })
})
