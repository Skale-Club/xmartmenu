import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { VerifiedGoogleIdentity } from './google-identity'
import { assertProviderAccountActive } from './provider-account-status'
import { requireCurrentPhone, type CustomerAccountStatus } from './google-customer-account'

export class RegistrationConflict extends Error {}
export type RegistrationKind = 'customer' | 'business'

/** Explicit creation only: never discovers an owner by contact information. */
export class NativeRegistration {
  constructor(private readonly pool: Pool, private readonly projectId: string,
    private readonly account: (identity: VerifiedGoogleIdentity) => Promise<CustomerAccountStatus>) {}

  async create(identity: VerifiedGoogleIdentity, name: string, kind: RegistrationKind) {
    const age = Date.now() / 1000 - identity.authenticatedAt
    if (identity.projectId !== this.projectId || !identity.subject || identity.subject.length > 128
      || !['phone', 'google.com'].includes(identity.provider) || !Number.isSafeInteger(identity.authenticatedAt)
      || identity.authenticatedAt <= 0 || age < -5 || age > 300) throw new Error('Recent verified identity required')
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !['customer','business'].includes(kind)) throw new Error('Invalid registration')
    const status = await this.account(identity)
    assertProviderAccountActive(status, identity.authenticatedAt)
    if (identity.provider === 'phone') requireCurrentPhone(status, identity.authenticatedAt, identity.phone ?? '')
    const userId = randomUUID(), token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([identity.projectId,identity.subject])])
      const existing = await client.query('SELECT user_id FROM public.app_identity_bindings WHERE project_id=$1 AND subject=$2', [identity.projectId,identity.subject])
      if (existing.rowCount) throw new RegistrationConflict('Use sign-in, independent account linking, or reviewed recovery.')
      // A contact collision is never proof of ownership. Conservatively stop;
      // independent linking/recovery decides whether the person owns that UID.
      if (identity.phone) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`registration-phone:${identity.phone}`])
        const contact = await client.query("SELECT id FROM public.profiles WHERE regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$1 LIMIT 1", [identity.phone.replace(/\D/g,'')])
        if (contact.rowCount) throw new RegistrationConflict('Use sign-in, independent account linking, or reviewed recovery.')
      }
      // Canonical 005 role default is store-admin for business signup. Customer
      // QR signup explicitly uses customer. No tenant exists at registration.
      await client.query('INSERT INTO public.profiles(id,role,full_name,phone,tenant_id,must_change_password) VALUES($1,$2,$3,$4,NULL,false)',
        [userId,kind === 'business' ? 'store-admin' : 'customer',name.trim(),identity.provider === 'phone' ? identity.phone : null])
      await client.query('INSERT INTO public.app_accounts(id) VALUES($1)', [userId])
      await client.query(`INSERT INTO public.app_identity_bindings(project_id,subject,user_id,provider,binding_proof)
        VALUES($1,$2,$3,$4,'native-registration')`, [identity.projectId,identity.subject,userId,identity.provider])
      await client.query(`INSERT INTO public.app_sessions(token_hash,user_id,session_version,authenticated_at,expires_at,project_id,subject)
        VALUES($1,$2,0,$3,$4,$5,$6)`, [createHash('sha256').update(token).digest('hex'),userId,new Date(identity.authenticatedAt*1000),expiresAt,identity.projectId,identity.subject])
      await client.query('COMMIT')
      return { token, expiresAt }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }
}
