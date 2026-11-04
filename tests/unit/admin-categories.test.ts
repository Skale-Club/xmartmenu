import { describe, expect, it, vi } from 'vitest'
import { categoryFields, mutateAdminCategory, readAdminCategoriesPage } from '@/lib/data/admin-categories'

describe('category mutation validation', () => {
  it('accepts current category fields and sanitizes translations', () => {
    expect(categoryFields({ name: '  Dinner  ', description: '  Short  ', translations: { fr: { name: ' Soir ' }, unknown: { name: 'No' } }, course: 'main' }, true))
      .toEqual({ name: 'Dinner', description: '  Short  ', translations: { fr: { name: 'Soir' } }, course: 'main', is_active: true })
  })
  it('rejects authority fields, invalid courses, malformed text and positions', () => {
    for (const input of [{ name: 'Soup', tenant_id: 'other' }, { name: 'Soup', menu_id: 'other' }, { name: ' ' },
      { name: 'Soup', description: 4 }, { name: 'Soup', position: 1.5 }, { name: 'Soup', is_active: 'true' }]) {
      expect(() => categoryFields(input, true)).toThrow()
    }
    expect(categoryFields({ name: 'Soup', course: 'brunch' }, true).course).toBeNull()
  })
})

describe('category repository scope', () => {
  const tenantId = 'e7b7f160-0000-4000-8000-000000000001'
  const context = { tenantId, role: 'store-admin' as const }
  it('lists only the chosen tenant menu and preserves stable position order', async () => {
    const menu = { id: 'e7b7f160-0000-4000-8000-000000000002', tenant_id: tenantId, name: 'Dinner', slug: 'dinner', language: 'en', supported_languages: ['en'], translations: {}, purpose: 'restaurant', is_active: true, is_default: true, is_private: false, price_multiplier: 1, position: 0, created_at: '2026-01-01' }
    const query = vi.fn(async (text: string, _values?: unknown[]) => ({ rows: text.includes('FROM public.menus') ? [{ row: menu }] : [{ row: { id: 'category', tenant_id: tenantId, menu_id: menu.id, name: 'Soup', description: null, translations: {}, course: null, position: 0, is_active: true, created_at: '2026-01-01' } }] }))
    const result = await readAdminCategoriesPage(query, context, menu.id)
    expect(result.menu?.id).toBe(menu.id)
    expect(result.categories.map(category => category.name)).toEqual(['Soup'])
    expect(query.mock.calls[1][0]).toContain('c.tenant_id=$1 AND c.menu_id=$2 ORDER BY c.position,c.id')
    expect(query.mock.calls[1][1]).toEqual([tenantId, menu.id])
  })
  it('does not expose another tenant category by identifier', async () => {
    const query = vi.fn(async (text: string) => ({ rows: text.includes('FROM public.categories') ? [] : [{ row: { id: 'e7b7f160-0000-4000-8000-000000000099' } }] }))
    await expect(mutateAdminCategory(query, context, { kind: 'patch', id: 'e7b7f160-0000-4000-8000-000000000099', body: { name: 'Changed' } })).rejects.toMatchObject({ status: 404 })
  })
})
