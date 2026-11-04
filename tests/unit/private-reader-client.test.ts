import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { assertReadQuery, readerConfiguration, runReadProof, validatePacket } from '../../scripts/ops/xmartmenu-private-reader-client'

const packet = () => ({ protocol: 'xmartmenu-private-read-v1', nonce: randomBytes(16).toString('hex'), password: randomBytes(32).toString('base64url'), validUntil: Date.now()+120_000 })
describe('private reader client', () => {
  it('accepts only bounded credentials and no destination/url/SQL options', () => {
    const source = packet()
    expect(validatePacket(source)).toBe(source)
    for (const changed of [{ ...source, host: 'other' }, { ...source, connectionString: 'other' },
      { ...source, validUntil: Date.now()+900_000 }, { ...source, validUntil: 1 }, { ...source, nonce: 'bad' }]) expect(() => validatePacket(changed)).toThrow()
    const config = readerConfiguration(source)
    expect(config.host).toBe('10.0.4.1'); expect(config.port).toBe(15432)
    expect(config.user).toBe('xmartmenu_staging_reader'); expect(config.database).toBe('xmartmenu')
    expect(config.ssl).toBe(false); expect(config.connectionTimeoutMillis).toBe(5000)
    expect(config.options).toContain('default_transaction_read_only=on')
    expect(config).not.toHaveProperty('connectionString')
  })
  it('allows simple adapter selects and denies mutation/RPC/locking/multistatement queries', () => {
    assertReadQuery('SELECT id FROM public.orders WHERE id=$1')
    for (const query of ['UPDATE public.orders SET status=$1', 'SELECT 1; DELETE FROM public.orders',
      'SELECT public.create_order_with_items($1,$2)', 'SELECT id FROM public.orders FOR UPDATE',
      "SELECT set_config('transaction_read_only','off',true)", "SELECT nextval('sequence')"]) expect(() => assertReadQuery(query)).toThrow()
  })
  it('fails a wrong SQL authority inside READ ONLY, rolls back and closes without exposing the credential', async () => {
    const source = packet()
    const query = vi.fn(async (text: string) => ({ rows: text.startsWith('SELECT') ? [{ database: 'other' }] : [] }))
    const client = { connect: vi.fn(async () => undefined), query, end: vi.fn(async () => undefined) }
    await expect(runReadProof(source, () => client as never)).rejects.toThrow('authority')
    expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(client.end).toHaveBeenCalledOnce()
    expect(source.password).toBe('')
  })
})
