import { describe, expect, it } from 'vitest'
import { readOwnedWaiterData } from '@/lib/data/owned-waiter'

describe('readOwnedWaiterData', () => {
  it('returns null for an unknown or inactive slug without further reads', async () => {
    const seen: string[] = []
    expect(await readOwnedWaiterData(async text => { seen.push(text); return { rows: [] } }, 'nope')).toBeNull()
    expect(seen).toHaveLength(1)
  })
  it('scopes every list to the tenant and menu it resolved and groups nothing across tenants', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = []
    const result = await readOwnedWaiterData(async (text, values) => {
      calls.push({ text, values })
      if (text.includes('FROM public.tenants')) return { rows: [{ id: 't1', name: 'Cafe', slug: 'cafe', settings: { currency: 'EUR' } }] }
      if (text.includes('FROM public.menus')) return { rows: [{ id: 'm1' }] }
      if (text.includes('FROM public.products')) return { rows: [{ row: { id: 'p1' } }] }
      if (text.includes('product_option_groups')) return { rows: [{ row: { id: 'g1', product_id: 'p1', options: [] } }] }
      return { rows: [] }
    }, 'cafe')
    expect(result?.tenant).toEqual({ id: 't1', name: 'Cafe', slug: 'cafe' })
    expect(result?.groups).toHaveLength(1)
    const tenantScoped = calls.filter(c => /restaurant_tables|public\.categories|public\.products|public\.orders/.test(c.text))
    expect(tenantScoped.length).toBe(4)
    for (const c of tenantScoped) expect(c.values).toContain('t1')
    expect(calls.some(c => /supabase/i.test(c.text))).toBe(false)
  })
})
