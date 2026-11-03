import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { VerifiedGoogleIdentity } from './google-identity'
import { assertProviderAccountActive, type ProviderAccountStatusReader, type ProviderIdentity } from './provider-account-status'

const SESSION_MS = 8 * 60 * 60 * 1000
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
export type BindingProof = 'legacy-session' | 'google-subject' | 'operator-recovery'

async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

/**
 * Backend-only store. The caller supplies a pool for the explicitly selected
 * target and must prove account ownership BEFORE bind(). It never creates an
 * application account, promotes a role, or matches an email/phone.
 */
export class IdentityStore {
  constructor(private readonly pool: Pool, private readonly accountStatus: ProviderAccountStatusReader) {}

  private async readProviderStatus(identity: ProviderIdentity) {
    try { return await this.accountStatus(identity) }
    catch { throw new Error('Identity provider account status unavailable') }
  }

  private async verifyActive(identity: VerifiedGoogleIdentity, recent: boolean): Promise<void> {
    const age = Date.now() / 1000 - identity.authenticatedAt
    if (!Number.isSafeInteger(identity.authenticatedAt) || identity.authenticatedAt <= 0
      || age < -5 || (recent && age > 300)) throw new Error('Recent authentication required')
    assertProviderAccountActive(await this.readProviderStatus(identity), identity.authenticatedAt)
  }

  async owner(identity: Pick<VerifiedGoogleIdentity, 'projectId' | 'subject'>): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT b.user_id FROM public.app_identity_bindings b JOIN public.app_accounts a ON a.id=b.user_id
       WHERE b.project_id=$1 AND b.subject=$2 AND b.disabled_at IS NULL AND a.disabled_at IS NULL`, [identity.projectId, identity.subject])
    return result.rows[0]?.user_id ?? null
  }

  async bind(identity: VerifiedGoogleIdentity, userId: string, proof: BindingProof): Promise<void> {
    await this.verifyActive(identity, true)
    await transaction(this.pool, async client => {
      // One lock per provider identity, even when two different app accounts
      // try the first association concurrently. Lock releases on rollback too.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([identity.projectId, identity.subject])])
      const account = await client.query('SELECT id FROM public.app_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [userId])
      if (!account.rowCount) throw new Error('Account unavailable')
      const bound = await client.query<{ user_id: string; disabled_at: Date | null }>('SELECT user_id,disabled_at FROM public.app_identity_bindings WHERE project_id=$1 AND subject=$2', [identity.projectId, identity.subject])
      if (bound.rows[0] && bound.rows[0].user_id !== userId) throw new Error('Identity already belongs to another account')
      if (bound.rows[0]?.disabled_at) throw new Error('Identity binding unavailable')
      await client.query(
        `INSERT INTO public.app_identity_bindings(project_id,subject,user_id,provider,binding_proof)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT (project_id,subject) DO NOTHING`,
        [identity.projectId, identity.subject, userId, identity.provider, proof])
    })
  }

  async createSession(identity: VerifiedGoogleIdentity): Promise<{ token: string; expiresAt: Date }> {
    await this.verifyActive(identity, true)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_MS)
    await transaction(this.pool, async client => {
      const owner = await client.query<{ id: string; session_version: number }>(
        `SELECT a.id,a.session_version FROM public.app_accounts a
         JOIN public.app_identity_bindings b ON b.user_id=a.id
         WHERE b.project_id=$1 AND b.subject=$2 AND b.disabled_at IS NULL AND a.disabled_at IS NULL FOR UPDATE OF a,b`,
        [identity.projectId, identity.subject])
      const account = owner.rows[0]
      if (!account) throw new Error('Account unavailable')
      await client.query(
        `INSERT INTO public.app_sessions(token_hash,user_id,session_version,authenticated_at,expires_at,project_id,subject)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [digest(token), account.id, account.session_version, new Date(identity.authenticatedAt * 1000), expiresAt, identity.projectId, identity.subject])
    })
    return { token, expiresAt }
  }

  async session(token: string): Promise<{ userId: string; authenticatedAt: Date } | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    const result = await this.pool.query<{ user_id: string; authenticated_at: Date; project_id: string; subject: string }>(
      `SELECT s.user_id,s.authenticated_at,s.project_id,s.subject FROM public.app_sessions s JOIN public.app_accounts a ON a.id=s.user_id
       JOIN public.app_identity_bindings b ON b.project_id=s.project_id AND b.subject=s.subject AND b.user_id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND a.disabled_at IS NULL AND s.session_version=a.session_version
         AND b.disabled_at IS NULL`, [digest(token)])
    const row = result.rows[0]
    if (!row) return null
    assertProviderAccountActive(await this.readProviderStatus({ projectId: row.project_id, subject: row.subject }), Math.floor(row.authenticated_at.getTime() / 1000))
    return { userId: row.user_id, authenticatedAt: row.authenticated_at }
  }

  async logout(token: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) await this.pool.query('DELETE FROM public.app_sessions WHERE token_hash=$1', [digest(token)])
  }

  async revokeAll(userId: string): Promise<void> {
    // Atomic version increment invalidates concurrent/old sessions; createSession
    // serializes on this same account row before recording its version.
    await this.pool.query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1', [userId])
  }
}
