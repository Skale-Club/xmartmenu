/**
 * Imports `google sub -> app account` from the legacy Supabase Auth Admin API.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... IDENTITY_CLAIMS_DATABASE_URL=... \
 *     npx tsx scripts/ops/import-google-subject-claims.ts [--apply]
 *
 * - The source is only read (HTTP GET). Nothing is written to Supabase.
 * - A claim is created only when the Auth user UID is EXACTLY an `app_accounts.id`.
 *   E-mail is never read for matching.
 * - Dry run by default. `--apply` writes with ON CONFLICT DO NOTHING (idempotent);
 *   a subject already claimed by a DIFFERENT account aborts the whole run.
 * - Prints counts only: never a sub, an e-mail or a UID.
 */
import { pathToFileURL } from 'node:url'

export type AuthUser = { id?: unknown; identities?: unknown }
export interface ClaimPlan {
  claims: { googleSub: string; accountId: string }[]
  skippedNoAccount: number
  skippedNoGoogle: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GOOGLE_SUB = /^\d{5,40}$/

function googleSubOf(user: AuthUser): string | null {
  if (!Array.isArray(user.identities)) return null
  const subs = new Set<string>()
  for (const identity of user.identities) {
    if (!identity || typeof identity !== 'object') continue
    const row = identity as { provider?: unknown; provider_id?: unknown; identity_data?: { sub?: unknown } | null }
    if (row.provider !== 'google') continue
    const sub = typeof row.provider_id === 'string' ? row.provider_id : row.identity_data?.sub
    if (typeof sub === 'string' && GOOGLE_SUB.test(sub)) subs.add(sub)
  }
  return subs.size === 1 ? [...subs][0] : null
}

export function planClaims(users: AuthUser[], accountIds: ReadonlySet<string>): ClaimPlan {
  const plan: ClaimPlan = { claims: [], skippedNoAccount: 0, skippedNoGoogle: 0 }
  const seen = new Set<string>()
  for (const user of users) {
    const sub = googleSubOf(user)
    if (!sub) { plan.skippedNoGoogle++; continue }
    if (typeof user.id !== 'string' || !UUID.test(user.id) || !accountIds.has(user.id)) { plan.skippedNoAccount++; continue }
    if (seen.has(sub)) continue
    seen.add(sub)
    plan.claims.push({ googleSub: sub, accountId: user.id })
  }
  return plan
}

async function fetchAllUsers(baseUrl: string, key: string): Promise<AuthUser[]> {
  const users: AuthUser[] = []
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, redirect: 'error',
    })
    if (!response.ok) throw new Error(`Auth Admin API returned ${response.status}`)
    const body = await response.json() as { users?: AuthUser[] }
    if (!Array.isArray(body.users)) throw new Error('Unexpected Auth Admin API response')
    users.push(...body.users)
    if (body.users.length < 200) break
  }
  return users
}

async function main() {
  const apply = process.argv.includes('--apply')
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY, db = process.env.IDENTITY_CLAIMS_DATABASE_URL
  if (!base || !key || !db) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and IDENTITY_CLAIMS_DATABASE_URL are required')
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: db, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })
  try {
    const accounts = new Set((await pool.query<{ id: string }>('SELECT id FROM public.app_accounts')).rows.map(row => row.id))
    const users = await fetchAllUsers(base, key)
    const plan = planClaims(users, accounts)
    let inserted = 0, existing = 0
    if (apply) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const claim of plan.claims) {
          const result = await client.query("INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source) VALUES($1,$2,'supabase-auth-import') ON CONFLICT (google_sub) DO NOTHING", [claim.googleSub, claim.accountId])
          if (result.rowCount) { inserted++; continue }
          const same = await client.query('SELECT 1 FROM public.identity_google_subject_claims WHERE google_sub=$1 AND account_id=$2', [claim.googleSub, claim.accountId])
          if (!same.rowCount) throw new Error('A Google subject is already claimed by a different account; nothing was written')
          existing++
        }
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
      finally { client.release() }
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', authUsers: users.length, accounts: accounts.size,
      claimsPlanned: plan.claims.length, skippedNoGoogle: plan.skippedNoGoogle, skippedNoAppAccount: plan.skippedNoAccount, inserted, alreadyPresent: existing }))
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed'); process.exit(1) })
}
