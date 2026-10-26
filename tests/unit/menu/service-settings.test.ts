import { describe, expect, it } from 'vitest'
import { planCeiling } from '@/lib/service-modes'
import {
  lockedServiceKeys,
  normalizeWhatsapp,
  planRequirementFor,
  validateServiceSettingsPatch,
} from '@/lib/service-settings'

const MENU = { plan: planCeiling(['digital-menu', 'qr-code', 'analytics']) }
const ORDERS = { plan: planCeiling(['digital-menu', 'orders', 'qr-code', 'analytics']) }
const PAYMENTS = { plan: planCeiling(['digital-menu', 'orders', 'payments', 'stripe-connect', 'analytics']) }

describe('normalizeWhatsapp', () => {
  it('keeps digits only, country code first', () => {
    expect(normalizeWhatsapp('+55 (11) 99999-0000')).toBe('5511999990000')
    expect(normalizeWhatsapp('1 415 555 0100')).toBe('14155550100')
  })

  it('turns empty values into null', () => {
    expect(normalizeWhatsapp('')).toBeNull()
    expect(normalizeWhatsapp('  - ')).toBeNull()
    expect(normalizeWhatsapp(null)).toBeNull()
  })

  it('rejects non-strings and numbers longer than E.164', () => {
    expect(normalizeWhatsapp(5511999990000)).toBeUndefined()
    expect(normalizeWhatsapp('1234567890123456')).toBeUndefined()
  })
})

describe('planRequirementFor', () => {
  it('maps each key to the plan that unlocks it', () => {
    expect(planRequirementFor('orders_enabled')).toBeNull()
    expect(planRequirementFor('whatsapp_orders_enabled')).toBeNull()
    expect(planRequirementFor('whatsapp')).toBeNull()
    expect(planRequirementFor('table_management_enabled')).toBe('orders')
    expect(planRequirementFor('red_threshold_minutes')).toBe('orders')
    expect(planRequirementFor('direct_orders_enabled')).toBe('payments')
    expect(planRequirementFor('delivery_fee_cents')).toBe('payments')
    expect(planRequirementFor('upsell_enabled')).toBe('payments')
  })
})

describe('validateServiceSettingsPatch', () => {
  it('accepts the every-plan keys on Digital Menu', () => {
    const result = validateServiceSettingsPatch(
      { orders_enabled: true, whatsapp_orders_enabled: true, whatsapp: '+55 11 99999-0000' },
      MENU,
    )
    expect(result.errors).toEqual([])
    expect(result.locked).toEqual([])
    expect(result.patch).toEqual({ orders_enabled: true, whatsapp_orders_enabled: true, whatsapp: '5511999990000' })
  })

  it('locks enabling payments keys below Menu + Payments', () => {
    const result = validateServiceSettingsPatch(
      { direct_orders_enabled: true, tips_enabled: true, delivery_fee_cents: 500, table_management_enabled: true },
      ORDERS,
    )
    expect(result.errors).toEqual([])
    expect(result.locked.sort()).toEqual(['delivery_fee_cents', 'direct_orders_enabled', 'tips_enabled'])
  })

  it('locks orders keys on Digital Menu', () => {
    const result = validateServiceSettingsPatch(
      { table_management_enabled: true, item_notes_enabled: true, amber_threshold_minutes: 5 },
      MENU,
    )
    expect(result.locked.sort()).toEqual(['amber_threshold_minutes', 'item_notes_enabled', 'table_management_enabled'])
  })

  it('lets a locked key be switched off', () => {
    const result = validateServiceSettingsPatch(
      { direct_orders_enabled: false, delivery_fee_cents: 0, table_management_enabled: false },
      MENU,
    )
    expect(result.locked).toEqual([])
    expect(result.patch).toEqual({ direct_orders_enabled: false, delivery_fee_cents: 0, table_management_enabled: false })
  })

  it('treats re-sending the stored value of a locked key as a no-op', () => {
    const result = validateServiceSettingsPatch(
      { amber_threshold_minutes: 10, red_threshold_minutes: 20, pickup_eta_minutes: 25 },
      MENU,
      { amber_threshold_minutes: 10, red_threshold_minutes: 20, pickup_eta_minutes: 20 },
    )
    expect(result.locked).toEqual(['pickup_eta_minutes'])
  })

  it('allows everything on Menu + Payments', () => {
    const result = validateServiceSettingsPatch(
      {
        orders_enabled: true, direct_orders_enabled: true, tips_enabled: true, pickup_enabled: true,
        delivery_enabled: true, delivery_fee_cents: 990, pickup_eta_minutes: 15, upsell_enabled: true,
        table_management_enabled: true, item_notes_enabled: true, ingredient_customization_enabled: true,
        dine_in_enabled: false, amber_threshold_minutes: 8, red_threshold_minutes: 16,
      },
      PAYMENTS,
    )
    expect(result.errors).toEqual([])
    expect(result.locked).toEqual([])
    expect(Object.keys(result.patch)).toHaveLength(14)
  })

  it('reports invalid values', () => {
    const result = validateServiceSettingsPatch(
      { orders_enabled: 'yes', delivery_fee_cents: -1, pickup_eta_minutes: 2.5, amber_threshold_minutes: 0, red_threshold_minutes: 181, whatsapp: 42 },
      PAYMENTS,
    )
    expect(result.errors).toHaveLength(6)
    expect(result.patch).toEqual({})
  })

  it('requires amber below red, using the stored value for the missing one', () => {
    expect(validateServiceSettingsPatch({ amber_threshold_minutes: 20, red_threshold_minutes: 10 }, PAYMENTS).errors)
      .toEqual(['amber_threshold_minutes must be lower than red_threshold_minutes'])
    expect(validateServiceSettingsPatch({ amber_threshold_minutes: 25 }, PAYMENTS, { amber_threshold_minutes: 10, red_threshold_minutes: 20 }).errors)
      .toHaveLength(1)
    expect(validateServiceSettingsPatch({ amber_threshold_minutes: 15 }, PAYMENTS, { amber_threshold_minutes: 10, red_threshold_minutes: 20 }).errors)
      .toEqual([])
  })

  it('ignores unknown keys and rejects a non-object body', () => {
    expect(validateServiceSettingsPatch({ primary_color: '#000', orders_enabled: false }, MENU).patch).toEqual({ orders_enabled: false })
    expect(validateServiceSettingsPatch(null, MENU).errors).toEqual(['Invalid body'])
    expect(validateServiceSettingsPatch([], MENU).errors).toEqual(['Invalid body'])
  })
})

describe('lockedServiceKeys', () => {
  it('ignores keys every plan has', () => {
    expect(lockedServiceKeys({ orders_enabled: true, whatsapp: '5511' }, MENU.plan)).toEqual([])
  })
})
