import {readFile} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {describe,expect,it,vi} from 'vitest'
import {ANALYTICS_SQL} from '@/lib/data/admin-analytics-sql'
import {readAdminAnalytics} from '@/lib/data/admin-analytics'

const tenantId=randomUUID(),context={tenantId,role:'store-admin' as const}
const window={startedAt:'2026-10-01T00:00:00Z',endedAt:'2026-10-08T00:00:00Z',previousStartedAt:'2026-09-24T00:00:00Z',menuId:null,locationId:null}
describe('native analytics contracts',()=>{
 it('pins each canonical function body while executing only parameterized SELECT translations',async()=>{
  for(const definition of Object.values(ANALYTICS_SQL)){
   const source=(await readFile(new URL(`../../supabase/migrations/${definition.source}`,import.meta.url),'utf8')).replaceAll('\r\n','\n')
   const fn=source.match(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${definition.functionName}\\([\\s\\S]*?\\$\\$;`))?.[0]
   const body=fn?.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1]
   expect(body).toBeDefined();expect(createHash('sha256').update(body!).digest('hex')).toBe(definition.bodySha256)
   expect(definition.sql).not.toMatch(/\b(?:GRANT|ALTER|INSERT|UPDATE|DELETE)\b/);expect(definition.sql).not.toContain(definition.functionName)
   expect(definition.sql).toContain('$1::uuid');expect(definition.sql).toMatch(/public\.(menu_sessions|orders)/)
  }
 })
 it('denies customer/unknown tenant and invalid windows before touching SQL',async()=>{
  const query=vi.fn()
  for(const actor of [{...context,role:'customer' as const},{...context,tenantId:'bad'}])await expect(readAdminAnalytics(query,actor,window)).rejects.toMatchObject({status:403})
  await expect(readAdminAnalytics(query,context,{...window,menuId:'bad'})).rejects.toMatchObject({status:400})
  await expect(readAdminAnalytics(query,context,{...window,endedAt:'2027-01-01'})).rejects.toMatchObject({status:400})
  expect(query).not.toHaveBeenCalled()
 })
 it('derives all scopes and plan gates from the authorized tenant and keeps attribution independent of menu',async()=>{
  const menu=randomUUID(),location=randomUUID()
  const query=vi.fn(async(sql:string)=>{
   if(sql.includes('FROM public.tenant_settings'))return{rows:[{currency:null,country:null,region:null,orders_enabled:true,direct_orders_enabled:true,table_management_enabled:true}]}
   if(sql.includes('FROM public.tenant_subscriptions'))return{rows:[{features:[]}]}
   if(sql.startsWith('SELECT id,name'))return{rows:[]}
   return{rows:[{data:sql===ANALYTICS_SQL.overview.sql?[{}]:sql===ANALYTICS_SQL.products.sql?[]:{}}]}
  })
  const result=await readAdminAnalytics(query,context,{...window,menuId:menu,locationId:location})
  expect(result.capabilities.plan.payments).toBe(false)
  const calls=query.mock.calls as unknown as Array<[string,unknown[]]>
  expect(calls.every(([,params])=>params[0]===tenantId)).toBe(true)
  expect(calls.find(([sql])=>sql===ANALYTICS_SQL.attribution.sql)?.[1]).toEqual([tenantId,window.startedAt,window.endedAt,location])
 })
})
