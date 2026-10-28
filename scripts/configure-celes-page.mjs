/**
 * Sets the public contact email of Celes Confections (shown in the "Connect"
 * block at the end of the menu, and the address of /celes-confections/contact),
 * after migration 20261028090000_contact_email.sql.
 *
 *   node scripts/configure-celes-page.mjs           shows what it would write
 *   node scripts/configure-celes-page.mjs --apply   writes it
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'celes-confections').single()
const contactEmail = 'hello@celesconfections.com'
console.log('contact_email:', contactEmail)

if (!process.argv.includes('--apply')) {
  console.log('\n(dry run: add --apply to write it)')
} else {
  const { error } = await sb.from('tenant_settings').update({ contact_email: contactEmail }).eq('tenant_id', tenant.id)
  console.log(error ? `failed: ${error.message}` : 'contact_email saved')
}
