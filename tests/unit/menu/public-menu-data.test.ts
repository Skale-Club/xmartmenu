import { describe, expect, it, vi } from 'vitest'

// The loader module imports the Supabase server helpers (next/headers); the
// pure helpers under test never touch them.
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: vi.fn(), createClient: vi.fn() }))

import {
  buildOptionGroupsByProductId,
  groupByProductId,
  pickDefaultMenu,
  pickSectionMenu,
} from '@/lib/menu/public-menu-data'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'

// Active menus, ordered by position (as the loader queries them).
const lunch = { id: 'm1', slug: 'lunch', is_default: false }
const dinner = { id: 'm2', slug: 'dinner', is_default: true }
const drinks = { id: 'm3', slug: 'drinks', is_default: false }

describe('pickDefaultMenu', () => {
  it('picks the menu flagged as default', () => {
    expect(pickDefaultMenu([lunch, dinner, drinks])).toBe(dinner)
  })

  it('falls back to the first menu by position when none is default', () => {
    expect(pickDefaultMenu([lunch, drinks])).toBe(lunch)
  })

  it('falls back to the first menu when several claim to be default (maybeSingle parity)', () => {
    const otherDefault = { ...drinks, is_default: true }
    expect(pickDefaultMenu([lunch, dinner, otherDefault])).toBe(lunch)
  })

  it('returns null without active menus', () => {
    expect(pickDefaultMenu([])).toBeNull()
  })
})

describe('pickSectionMenu', () => {
  const menus = [lunch, dinner, drinks]

  it('resolves a menu slug when the segment is not a branch', () => {
    expect(pickSectionMenu(menus, 'drinks', null)).toBe(drinks)
    expect(pickSectionMenu(menus, 'brunch', null)).toBeNull()
  })

  it('returns null for a slug shared by several menus (maybeSingle parity)', () => {
    expect(pickSectionMenu([lunch, { ...drinks, slug: 'lunch' }], 'lunch', null)).toBeNull()
  })

  it("uses the branch's own menu when it is active", () => {
    expect(pickSectionMenu(menus, 'downtown', { menu_id: 'm3' })).toBe(drinks)
  })

  it("falls back to the default menu when the branch's menu is missing or inactive", () => {
    expect(pickSectionMenu(menus, 'downtown', { menu_id: 'gone' })).toBe(dinner)
    expect(pickSectionMenu(menus, 'downtown', { menu_id: null })).toBe(dinner)
    expect(pickSectionMenu([lunch, drinks], 'downtown', {})).toBe(lunch)
  })

  it('ignores menu slugs when the segment is a branch', () => {
    expect(pickSectionMenu(menus, 'drinks', { menu_id: null })).toBe(dinner)
  })

  it('returns null for a branch when the tenant has no active menu', () => {
    expect(pickSectionMenu([], 'downtown', { menu_id: 'm1' })).toBeNull()
  })
})

describe('groupByProductId', () => {
  it('buckets rows per product keeping their order', () => {
    const rows = [
      { id: 'a', product_id: 'p1' },
      { id: 'b', product_id: 'p2' },
      { id: 'c', product_id: 'p1' },
    ]
    expect(groupByProductId(rows)).toEqual({
      p1: [{ id: 'a', product_id: 'p1' }, { id: 'c', product_id: 'p1' }],
      p2: [{ id: 'b', product_id: 'p2' }],
    })
  })

  it('handles empty and missing results', () => {
    expect(groupByProductId([])).toEqual({})
    expect(groupByProductId(null)).toEqual({})
    expect(groupByProductId(undefined)).toEqual({})
  })
})

describe('buildOptionGroupsByProductId', () => {
  it('groups option groups per product and keeps only available options', () => {
    const groups = [
      { id: 'g1', product_id: 'p1', options: [{ id: 'o1', is_available: true }, { id: 'o2', is_available: false }] },
      { id: 'g2', product_id: 'p2', options: [] },
      { id: 'g3', product_id: 'p1', options: [{ id: 'o3', is_available: true }] },
    ] as unknown as GroupWithOptions[]

    const result = buildOptionGroupsByProductId(groups)
    expect(Object.keys(result)).toEqual(['p1', 'p2'])
    expect(result.p1.map(g => g.id)).toEqual(['g1', 'g3'])
    expect(result.p1[0].options.map(o => o.id)).toEqual(['o1'])
    expect(result.p1[1].options.map(o => o.id)).toEqual(['o3'])
    expect(result.p2[0].options).toEqual([])
    // The source rows are not mutated.
    expect(groups[0].options).toHaveLength(2)
  })

  it('handles a missing result', () => {
    expect(buildOptionGroupsByProductId(null)).toEqual({})
  })
})
