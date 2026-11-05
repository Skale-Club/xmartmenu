import { randomUUID } from 'node:crypto'
import { expect,it,vi } from 'vitest'
vi.mock('@/lib/mcp/data/authority',async importOriginal=>({ ...await importOriginal<typeof import('@/lib/mcp/data/authority')>(),requireMcpAuthority:vi.fn() }))
import { nativeMcpDataTool } from '@/lib/mcp/data/tools'
const id=randomUUID(),actor={ actorId:randomUUID(),oauth:{ tokenHash:'a'.repeat(64),requiredScope:'mcp:admin' as const } }
const privateMarker=randomUUID()
const privateRow={ id,app_name:'Public brand',brand_name:'Brand',landing:{ title:'Public page' },smtp_password:privateMarker,stripe_secret_key:privateMarker,provider_credentials:{ private:true } }
it('platform read returns only its public contract even if a driver row contains integration credentials',async()=>{
  const query=vi.fn(async(sql:string)=>({ rows:sql.startsWith('SELECT pg_') ? [] : [privateRow] }))
  const result=await nativeMcpDataTool(query,actor,'get_platform_settings',{},'https://fixture.invalid')
  expect(result).toEqual({ id,app_name:'Public brand',brand_name:'Brand',landing:{ title:'Public page' } })
  const selects=query.mock.calls.map(([sql])=>sql).filter(sql=>sql.includes('platform_settings'))
  expect(selects[0]).not.toContain('SELECT *'); expect(selects[0]).not.toMatch(/smtp|stripe_secret|provider_credentials/)
})
it('platform update/insert RETURNING projections never expose fields outside the same whitelist',async()=>{
  for(const existing of [true,false]) {
    const query=vi.fn(async(sql:string)=>({ rows:sql.startsWith('SELECT pg_') ? [] : sql.startsWith('SELECT ') && !existing ? [] : [privateRow] }))
    const result=await nativeMcpDataTool(query,actor,'update_platform_settings',{ settings:{ app_name:'Public brand' } },'https://fixture.invalid')
    expect(JSON.stringify(result)).not.toContain(privateMarker); expect(result).not.toHaveProperty('provider_credentials')
    const write=query.mock.calls.map(([sql])=>sql).find(sql=>sql.startsWith(existing ? 'UPDATE ' : 'INSERT '))!
    expect(write).toContain('RETURNING id,app_name,brand_name'); expect(write).not.toContain('RETURNING *')
  }
})
