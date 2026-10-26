'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { PLAN_FOR_MODE } from '@/lib/service-modes'

/** The tenant_settings columns this card edits (null = never set, the column default applies). */
export interface ServiceSwitchValues {
  orders_enabled: boolean | null
  direct_orders_enabled: boolean | null
  table_management_enabled: boolean | null
  tips_enabled: boolean | null
  delivery_enabled: boolean | null
  upsell_enabled: boolean | null
}

type SwitchKey = keyof ServiceSwitchValues

interface SwitchDef {
  key: SwitchKey
  label: string
  hint: string
  /** The plan capability the switch needs; null = available on every plan. */
  needs: 'orders' | 'payments' | null
  /** What an unset column means (matches the column default). */
  fallback: boolean
}

const SWITCHES: readonly SwitchDef[] = [
  { key: 'orders_enabled', label: 'Orders', hint: 'Master switch: off turns every ordering mode off at once.', needs: null, fallback: true },
  { key: 'direct_orders_enabled', label: 'Guest ordering', hint: 'Guests build a cart and check out from the menu.', needs: 'payments', fallback: false },
  { key: 'table_management_enabled', label: 'Tables and waiter app', hint: 'Staff take orders at the table; table links and QR codes.', needs: 'orders', fallback: false },
  { key: 'tips_enabled', label: 'Tips', hint: 'Tip suggestions at guest checkout.', needs: 'payments', fallback: false },
  { key: 'delivery_enabled', label: 'Delivery', hint: 'Delivery orders with a fee and address.', needs: 'payments', fallback: false },
  { key: 'upsell_enabled', label: 'Upsell suggestions', hint: '"Complete your order" suggestions after a dish is added.', needs: 'payments', fallback: true },
]

/**
 * Superadmin view of a restaurant's service switches. A switch above the plan's
 * ceiling is locked (it can still be switched off); the settings API enforces
 * the same rule, this just makes it visible.
 */
export default function ServiceSwitchesCard({ tenantId, initial, access, onError }: {
  tenantId: string
  initial: ServiceSwitchValues
  access: { orders: boolean; payments: boolean }
  onError: (message: string | null) => void
}) {
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState<SwitchKey | null>(null)

  async function toggle(def: SwitchDef, next: boolean) {
    setSaving(def.key)
    onError(null)
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [def.key]: next }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update the switch')
      setValues(current => ({ ...current, [def.key]: typeof body?.[def.key] === 'boolean' ? body[def.key] : next }))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Failed to update the switch')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold text-zinc-900">Service switches</h2>
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-zinc-500">
        What this restaurant has switched on inside its plan. Switches above the plan are locked until the plan includes them.
      </p>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
        {SWITCHES.map(def => {
          const on = values[def.key] ?? def.fallback
          const locked = def.needs !== null && !access[def.needs]
          const planName = def.needs === 'orders' ? PLAN_FOR_MODE.waiter : PLAN_FOR_MODE.self_service
          // A locked switch can still be turned off, never on.
          const disabled = saving !== null || (locked && !on)
          return (
            <li key={def.key} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                  {locked && <Lock className="size-3.5 text-zinc-400" aria-hidden="true" />}
                  {def.label}
                </p>
                <p className="text-xs text-zinc-500">{def.hint}</p>
                {locked && (
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
                    {on ? `Above the plan: switch it off. Needs ${planName}.` : `Locked: needs the ${planName} plan.`}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={def.label}
                disabled={disabled}
                onClick={() => toggle(def, !on)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-zinc-300'}`}
              >
                <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150 ${on ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
