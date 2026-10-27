/**
 * report-customer-phone-backfill.ts — REPORT ONLY (EX-07). Writes nothing.
 *
 *   npx tsx scripts/report-customer-phone-backfill.ts
 *
 * Orders placed before customer_phone_e164 existed only have the free-text
 * phone and the last-8-digit key. Per restaurant this counts:
 *   normalizable  the typed phone gives one E.164 number (explicit +/00, or
 *                 the restaurant's configured country): a later backfill may
 *                 set customer_phone_e164, after which the owner of that
 *                 number can claim them by verifying it
 *   ambiguous     no prefix and no configured country: left unassociated
 *   suffix_clash  distinct normalized numbers sharing their last 8 digits:
 *                 orders the old panel showed to the wrong person
 * Output is counts per tenant id: no names, no phone numbers.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { phoneMatchKey, toE164 } from '../src/lib/phone'

config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data: settings, error: settingsError } = await supabase.from('tenant_settings').select('tenant_id, country')
  if (settingsError) throw settingsError
  const countryByTenant = new Map((settings ?? []).map((s) => [s.tenant_id as string, s.country as string | null]))

  const report: Record<string, { legacy: number; normalizable: number; ambiguous: number; suffix_clash: number }> = {}
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data: rows, error } = await supabase
      .from('orders')
      .select('tenant_id, customer_phone')
      .is('customer_id', null)
      .is('customer_phone_e164', null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!rows?.length) break
    const numbersBySuffix = new Map<string, Set<string>>()
    for (const row of rows) {
      const tenant = row.tenant_id as string
      const r = (report[tenant] ??= { legacy: 0, normalizable: 0, ambiguous: 0, suffix_clash: 0 })
      r.legacy++
      const e164 = toE164(row.customer_phone as string, countryByTenant.get(tenant))
      if (!e164) { r.ambiguous++; continue }
      r.normalizable++
      const suffixKey = `${tenant}:${phoneMatchKey(e164)}`
      const set = numbersBySuffix.get(suffixKey) ?? new Set<string>()
      set.add(e164)
      numbersBySuffix.set(suffixKey, set)
    }
    for (const [suffixKey, numbers] of numbersBySuffix) {
      if (numbers.size > 1) report[suffixKey.split(':')[0]].suffix_clash += numbers.size
    }
    if (rows.length < pageSize) break
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error('report failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
