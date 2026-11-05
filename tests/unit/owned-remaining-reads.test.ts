import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OWNED_MODE_FLAGS, assertOwnedModeStorage, ownedModeActive } from '@/lib/data/owned-mode'
import { SHARED_POOL_MAX, RUNTIME_ROLE_CONNECTION_LIMIT, TRANSPORT_HEARTBEAT_SLOTS, ROLLING_DEPLOY_CONTAINERS, closeSharedRuntimePools, sharedPoolForConfig, sharedPoolKey } from '@/lib/data/shared-pool'
import { PLATFORM_SETTINGS_LOCK, parsePlatformSettingsPatch, readPlatformSettingsRow, writePlatformSettingsRow } from '@/lib/data/platform-settings'
import { normalizeCustomDomainHost, readCustomDomainTenantSlug } from '@/lib/data/tenant-domain'
import { resolveOwnedDomainSlug, type DomainCacheEntry } from '@/lib/custom-domain-lookup'
import { checkOwnedDatabase } from '@/lib/data/database-health'
import { readPlatformBlogSitemap } from '@/lib/data/public-seo'
import { configSummary } from '@/lib/observability/health'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
const read = (path: string) => readFileSync(path, 'utf8')

describe('owned mode switch', () => {
  it('is off by default and on when ANY flag is exactly "true"', () => {
    expect(ownedModeActive({})).toBe(false)
    expect(ownedModeActive(Object.fromEntries(OWNED_MODE_FLAGS.map(name => [name, 'false'])))).toBe(false)
    for (const name of OWNED_MODE_FLAGS) {
      expect(ownedModeActive({ [name]: 'true' })).toBe(true)
      expect(ownedModeActive({ [name]: 'TRUE' })).toBe(false)
    }
  })
  it('declares every flag as false in .env.example', () => {
    const example = read('.env.example')
    for (const name of OWNED_MODE_FLAGS) expect(example).toMatch(new RegExp(`^${name}=false\\r?$`, 'm'))
    const used = new Set(read('src/lib/data/owned-mode.ts').match(/OWNED_[A-Z_]+_ENABLED/g))
    expect(used.size).toBe(OWNED_MODE_FLAGS.length)
  })
  it('refuses owned mode without the S3 storage provider, but leaves legacy mode alone', () => {
    expect(() => assertOwnedModeStorage({})).not.toThrow()
    expect(() => assertOwnedModeStorage({ OWNED_PUBLIC_MENU_ENABLED: 'true' })).toThrow('STORAGE_PROVIDER=s3')
    expect(() => assertOwnedModeStorage({ OWNED_AUTH_ENABLED: 'true', STORAGE_PROVIDER: 'supabase' })).toThrow()
    expect(() => assertOwnedModeStorage({ OWNED_AUTH_ENABLED: 'true', STORAGE_PROVIDER: 's3' })).not.toThrow()
    expect(read('src/instrumentation.ts')).toContain('assertOwnedModeStorage()')
    expect(read('src/lib/storage/index.ts')).toMatch(/getStorageClient\(\): IStorageClient \{\s+assertOwnedModeStorage\(\)/)
  })
  it('reports the database mode in the token-protected health config', () => {
    expect(configSummary({}).database_mode).toBe('legacy')
    expect(configSummary({ OWNED_MCP_ENABLED: 'true' }).database_mode).toBe('owned')
  })
})

describe('shared runtime pool budget', () => {
  it('fits the 12-connection role during a rolling deploy', () => {
    expect(SHARED_POOL_MAX).toBe(5)
    expect(ROLLING_DEPLOY_CONTAINERS * SHARED_POOL_MAX + TRANSPORT_HEARTBEAT_SLOTS).toBeLessThanOrEqual(RUNTIME_ROLE_CONNECTION_LIMIT)
  })
  it('reuses one pool for the same database and ignores application_name', async () => {
    const a = { connectionString: 'postgresql://runtime:pw@db:5432/app', ssl: false as const }
    const same = { connectionString: 'postgresql://runtime:pw@db:5432/app?application_name=other', ssl: false as const }
    const otherRole = { connectionString: 'postgresql://reader:pw@db:5432/app', ssl: false as const }
    const otherDb = { connectionString: 'postgresql://runtime:pw@db:5432/other', ssl: false as const }
    expect(sharedPoolKey(a)).toBe(sharedPoolKey(same))
    const pool = sharedPoolForConfig(a)
    expect(sharedPoolForConfig(same)).toBe(pool)
    expect(sharedPoolForConfig(otherRole)).not.toBe(pool)
    expect(sharedPoolForConfig(otherDb)).not.toBe(pool)
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(SHARED_POOL_MAX)
    await closeSharedRuntimePools()
  })
  it('routes every runtime through the shared registry', () => {
    for (const file of ['admin-menus', 'orders', 'payments', 'public-menu', 'platform-appearance']) {
      expect(read(`src/lib/data/${file}-runtime.ts`)).toMatch(/sharedRuntimePool\('/)
    }
    expect(read('src/lib/auth/identity-services.ts')).toContain('sharedPoolForConfig(config)')
  })
})

describe('platform_settings', () => {
  it('keeps only known fields and rejects bad shapes before any SQL', () => {
    expect(parsePlatformSettingsPatch({ app_name: 'X', evil: 1, landing: { a: 1 }, id: 'nope' })).toEqual({ app_name: 'X', landing: { a: 1 } })
    for (const body of [null, [], 'x', { app_name: null }, { landing: [] }, { landing: null }, { cta_color: 'x'.repeat(65) }, { legal: 'text' }, { seo_title: 4 }]) {
      expect(() => parsePlatformSettingsPatch(body)).toThrow('Invalid platform settings')
    }
    expect(parsePlatformSettingsPatch({ seo_title: null, favicon_url: null })).toEqual({ seo_title: null, favicon_url: null })
  })
  it('projects by allow-list and fails closed on a non-singleton', async () => {
    const query = vi.fn(async (_text: string) => ({ rows: [{ cta_color: '#fff', app_name: 'A' }] as Record<string, unknown>[] }))
    expect(await readPlatformSettingsRow(query, ['cta_color', 'app_name'])).toEqual({ cta_color: '#fff', app_name: 'A' })
    expect(query.mock.calls[0][0]).toContain('SELECT app_name, cta_color FROM public.platform_settings')
    await expect(readPlatformSettingsRow(query, ['cta_color; DROP TABLE x' as never])).rejects.toThrow()
    await expect(readPlatformSettingsRow(async () => ({ rows: [{}, {}] }), ['cta_color'])).rejects.toThrow('singleton')
    expect(await readPlatformSettingsRow(async () => ({ rows: [] }), '*')).toBeNull()
    expect(await readPlatformSettingsRow(async () => ({ rows: [{ row: { id: 'x', landing: {} } }] }), '*')).toEqual({ id: 'x', landing: {} })
  })
  it('serializes with the MCP writer, updates the single row and encodes jsonb once', async () => {
    const calls: Array<[string, unknown[] | undefined]> = []
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      calls.push([text, values])
      if (text.startsWith('SELECT id')) return { rows: [{ id: 'row-1' }] }
      return { rows: [{ row: { id: 'row-1', app_name: 'New' } }] }
    })
    expect(await writePlatformSettingsRow(query, { app_name: 'New', landing: { a: 1 } })).toEqual({ id: 'row-1', app_name: 'New' })
    expect(calls[0][1]).toEqual([PLATFORM_SETTINGS_LOCK])
    expect(PLATFORM_SETTINGS_LOCK).toBe('xmartmenu-mcp-platform')
    expect(read('src/lib/mcp/data/tools.ts')).toContain(PLATFORM_SETTINGS_LOCK)
    expect(calls[2][0]).toContain('UPDATE public.platform_settings SET app_name=$2, landing=$3::jsonb, updated_at=now()')
    expect(calls[2][1]).toEqual(['row-1', 'New', '{"a":1}'])
    await expect(writePlatformSettingsRow(query, { id: 'x' })).rejects.toThrow()
  })
  it('inserts when the restore left no row, and refuses two rows', async () => {
    const insert = vi.fn(async (text: string) => (text.startsWith('SELECT id') ? { rows: [] } : { rows: [{ row: { id: 'n' } }] }))
    await writePlatformSettingsRow(insert, { app_name: 'A' })
    expect(insert.mock.calls.at(-1)![0]).toContain('INSERT INTO public.platform_settings(app_name) VALUES($1)')
    await expect(writePlatformSettingsRow(async text => ({ rows: text.startsWith('SELECT id') ? [{ id: 1 }, { id: 2 }] : [] }), { app_name: 'A' })).rejects.toThrow('singleton')
  })
  it('call sites pick owned SQL before any Supabase access', () => {
    for (const file of ['src/app/(marketing)/layout.tsx', 'src/app/(marketing)/page.tsx', 'src/components/legal/LegalPage.tsx', 'src/app/auth/pending/page.tsx',
      'src/app/api/superadmin/settings/route.ts', 'src/app/(superadmin)/admin/page.tsx']) {
      const source = read(file), owned = source.indexOf('platformSettingsOwned()'), legacy = source.indexOf("from('platform_settings')")
      expect(owned, file).toBeGreaterThan(-1)
      expect(owned, file).toBeLessThan(legacy)
    }
    const route = read('src/app/api/superadmin/settings/route.ts')
    const patch = route.slice(route.indexOf('async function handlePATCH'))
    expect(patch.indexOf('if (owned) {')).toBeLessThan(patch.indexOf('createServiceClient()'))
  })
})

describe('custom domain resolution', () => {
  it('accepts only plausible hostnames', () => {
    expect(normalizeCustomDomainHost('Menu.Example.COM:443')).toBe('menu.example.com')
    for (const bad of ['', 'localhost', '-a.com', 'a b.com', 'x'.repeat(300) + '.com', null, 12]) expect(normalizeCustomDomainHost(bad)).toBeNull()
  })
  it('requires exactly one verified active tenant', async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [{ slug: 'bistro' }] as Record<string, unknown>[] }))
    expect(await readCustomDomainTenantSlug(query, 'Menu.Example.com')).toBe('bistro')
    expect(query.mock.calls[0][0]).toContain('custom_domain_verified=true')
    expect(query.mock.calls[0][1]).toEqual(['menu.example.com'])
    expect(await readCustomDomainTenantSlug(async () => ({ rows: [{ slug: 'a' }, { slug: 'b' }] }), 'menu.example.com')).toBeNull()
    expect(await readCustomDomainTenantSlug(async () => ({ rows: [] }), 'menu.example.com')).toBeNull()
    expect(await readCustomDomainTenantSlug(query, 'not a host')).toBeNull()
  })
  it('middleware keeps the legacy path untouched and asks the Node route in owned mode (Edge cannot run pg)', () => {
    const middleware = read('src/middleware.ts')
    expect(middleware).toContain('if (ownedModeActive()) return resolveOwnedDomainSlug(')
    expect(middleware.indexOf('ownedModeActive()')).toBeLessThan(middleware.indexOf("await import('@/lib/supabase/server')"))
    expect(read('src/lib/custom-domain-lookup.ts')).not.toMatch(/from '(pg|node:)/)
  })
  it('caches hits and misses, short-caches failures and keeps a stale hit through an outage', async () => {
    const cache = new Map<string, DomainCacheEntry>()
    let time = 0
    const answer = (body: unknown, ok = true) => vi.fn(async (..._args: unknown[]) => ({ ok, json: async () => body }) as unknown as Response)
    const hit = answer({ slug: 'bistro' })
    expect(await resolveOwnedDomainSlug('a.com', cache, hit as unknown as typeof fetch, () => time, { PORT: '4000' })).toBe('bistro')
    expect(hit.mock.calls[0][0]).toBe('http://127.0.0.1:4000/api/internal/resolve-domain?host=a.com')
    expect(await resolveOwnedDomainSlug('a.com', cache, hit as unknown as typeof fetch, () => time)).toBe('bistro')
    expect(hit).toHaveBeenCalledTimes(1)
    time = 61_000
    const down = vi.fn(async () => { throw new Error('boom') })
    expect(await resolveOwnedDomainSlug('a.com', cache, down as unknown as typeof fetch, () => time)).toBe('bistro')
    expect(await resolveOwnedDomainSlug('a.com', cache, down as unknown as typeof fetch, () => time)).toBe('bistro')
    expect(down).toHaveBeenCalledTimes(1)
    expect(await resolveOwnedDomainSlug('b.com', cache, answer({ error: 'x' }, false) as unknown as typeof fetch, () => time)).toBeNull()
    expect(await resolveOwnedDomainSlug('c.com', cache, answer({ slug: 5 }) as unknown as typeof fetch, () => time)).toBeNull()
    expect(await resolveOwnedDomainSlug('d.com', cache, answer({ slug: null }) as unknown as typeof fetch, () => time)).toBeNull()
  })
})

describe('owned readiness', () => {
  it('measures the owned database and hides driver details', async () => {
    let t = 0
    const ok = await checkOwnedDatabase(async operation => operation(async text => { expect(text).toContain('public.plans'); return { rows: [] } }), () => (t += 10))
    expect(ok).toEqual({ ok: true, latency_ms: 10 })
    const bad = await checkOwnedDatabase(async () => { throw new Error('postgresql://user:secret@10.0.4.1/db') })
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).not.toContain('secret')
    const route = read('src/app/api/health/ready/route.ts')
    const start = route.indexOf('async function checkDatabase')
    expect(route.indexOf('ownedModeActive()', start)).toBeLessThan(route.indexOf('createServiceClient()', start))
  })
})

describe('public SEO reads', () => {
  it('builds platform blog tags and archive only from published, already-live posts', async () => {
    const past = new Date('2026-01-15T00:00:00Z'), future = new Date('2099-01-01T00:00:00Z')
    const query = vi.fn(async (_text: string) => ({ rows: [
      { slug: 'a', tags: 'Massa Fresca, vinho', published_at: past, updated_at: past },
      { slug: 'b', tags: 'agendado', published_at: future, updated_at: future },
    ] as Record<string, unknown>[] }))
    const result = await readPlatformBlogSitemap(query, new Date('2026-02-01T00:00:00Z'))
    expect(query.mock.calls[0][0]).toContain('tenant_id IS NULL')
    expect(result.tags).toEqual(['massa-fresca', 'vinho'])
    expect(result.archive).toEqual([{ year: 2026, month: 1 }])
    expect(result.posts.map(p => p.slug)).toEqual(['a', 'b'])
  })
  it('every SEO entry point checks owned mode before reading Supabase', () => {
    for (const file of ['src/app/sitemap.ts', 'src/app/(public)/[slug]/sitemap.xml/route.ts', 'src/app/(public)/[slug]/robots.txt/route.ts', 'src/app/(public)/[slug]/opengraph-image.tsx']) {
      const source = read(file), owned = source.indexOf('ownedModeActive()'), legacy = source.indexOf('createServiceClient()', source.indexOf('export'))
      expect(owned, file).toBeGreaterThan(-1)
      expect(owned, file).toBeLessThan(legacy)
    }
  })
})

describe('legacy-only operations are closed in owned mode', () => {
  it('demo has no built-in password and answers 503 in owned mode', async () => {
    expect(read('src/app/demo/route.ts')).not.toContain('XmartDemo2026')
    expect(read('.env.example')).not.toContain('XmartDemo2026')
    const { GET } = await import('@/app/demo/route')
    vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED', 'true'); vi.stubEnv('DEMO_OWNER_PASSWORD', 'a-long-demo-password')
    expect((await GET(new Request('http://localhost/demo'))).status).toBe(503)
    vi.unstubAllEnvs(); vi.stubEnv('DEMO_OWNER_PASSWORD', '')
    expect((await GET(new Request('http://localhost/demo'))).status).toBe(503)
  }, 30_000)
  it('migrate-webp is blocked before any credential check', async () => {
    vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
    const { POST } = await import('@/app/api/superadmin/migrate-webp/route')
    const response = await POST(new Request('http://localhost/api/superadmin/migrate-webp', { method: 'POST' }), undefined as never)
    expect(response.status).toBe(410)
  }, 30_000)
  it('the password page redirects away when login is owned', () => {
    expect(read('src/app/(admin)/settings/password/layout.tsx')).toContain('if (ownedAuthSelected()) redirect(')
  })
  it('legacy checklist helpers refuse instead of touching Supabase', async () => {
    vi.stubEnv('OWNED_TENANT_ADMIN_ENABLED', 'true')
    const { loadLaunchChecklist, setLaunchChecklistItem, runLaunchChecklistScan } = await import('@/lib/admin/launch-checklist-data')
    const service = { from: () => { throw new Error('Supabase touched') } } as never
    await expect(loadLaunchChecklist(service)).rejects.toThrow('disabled in owned mode')
    await expect(setLaunchChecklistItem(service, { tenantId: 't', itemKey: 'k', status: 'done', updatedBy: null })).rejects.toThrow('disabled in owned mode')
    await expect(runLaunchChecklistScan(service, 't', { apply: true, updatedBy: 'x' })).rejects.toThrow('disabled in owned mode')
  }, 30_000)
})
