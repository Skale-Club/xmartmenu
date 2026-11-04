import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { hasSameOriginAdminMutation, mutateAdminDisplaySettings, readAdminDisplaySettings } from '@/lib/data/admin-display-settings'

const context = { tenantId: randomUUID(), role: 'store-admin' as const }

describe('owned tenant display settings SQL', () => {
  it('reads only the allowlisted branding projection for the current tenant', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
      void _sql; void _values
      return { rows: [{ logo_url: 'https://cdn.example/logo.webp' }] }
    })
    await expect(readAdminDisplaySettings(query, context, 'branding')).resolves.toEqual({ logo_url: 'https://cdn.example/logo.webp' })
    expect(query).toHaveBeenCalledWith(
      'SELECT s.primary_color, s.accent_color, s.instagram, s.tagline, s.whatsapp, s.logo_url, s.banner_url FROM public.tenant_settings s WHERE s.tenant_id=$1 LIMIT 1',
      [context.tenantId],
    )
  })

  it('upserts only validated columns and returns the exact menu display projection', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
      void _sql; void _values
      return { rows: [{ visual_feed_enabled: false, menu_default_view: 'list' }] }
    })
    await expect(mutateAdminDisplaySettings(query, context, 'menu-display', {
      analytics_enabled: true,
      visual_feed_enabled: false,
      menu_default_view: 'list',
      feed_autoplay_videos: true,
    })).resolves.toEqual({ visual_feed_enabled: false, menu_default_view: 'list' })
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-display-settings:${context.tenantId}`])
    const [sql, values] = query.mock.calls[1]
    expect(sql).toContain('INSERT INTO public.tenant_settings AS s (tenant_id, analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos, updated_at)')
    expect(sql).toContain('ON CONFLICT (tenant_id) DO UPDATE SET analytics_enabled=EXCLUDED.analytics_enabled')
    expect(sql).toContain('RETURNING s.analytics_enabled, s.visual_feed_enabled, s.menu_default_view, s.feed_autoplay_videos, s.upsell_enabled')
    expect(values).toEqual([context.tenantId, true, false, 'list', true])
  })

  it('preserves staff reads while rejecting writes and authority or cross-screen columns', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
      void _sql; void _values
      return { rows: [{ seo_title: null }] }
    })
    await expect(readAdminDisplaySettings(query, { ...context, role: 'store-staff' }, 'seo')).resolves.toEqual({ seo_title: null })
    query.mockClear()
    await expect(mutateAdminDisplaySettings(query, { ...context, role: 'store-staff' }, 'seo', { seo_title: null })).rejects.toMatchObject({ status: 403 })
    await expect(mutateAdminDisplaySettings(query, context, 'branding', { tenant_id: randomUUID(), logo_url: null })).rejects.toBeInstanceOf(AdminMenuError)
    await expect(mutateAdminDisplaySettings(query, context, 'seo', { primary_color: '#fff' })).rejects.toBeInstanceOf(AdminMenuError)
    expect(query).not.toHaveBeenCalled()
  })

  it('checks cancelled payment entitlement under row locks before writing upsell', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
      void _values
      if (_sql.includes('tenant_subscriptions')) return { rows: [{ status: 'cancelled', features: ['payments'] }] }
      return { rows: [] }
    })
    await expect(mutateAdminDisplaySettings(query, context, 'menu-display', { upsell_enabled: true })).rejects.toMatchObject({ status: 403 })
    expect(query.mock.calls[1]?.[0]).toContain('FOR SHARE OF s,p')
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.tenant_settings'))).toBe(false)
  })

  it('requires an exact Origin match for owned mutations', () => {
    expect(hasSameOriginAdminMutation(new Request('https://menu.example.test/api/admin/seo', {
      method: 'PATCH', headers: { host: 'menu.example.test', origin: 'https://menu.example.test' },
    }))).toBe(true)
    expect(hasSameOriginAdminMutation(new Request('https://menu.example.test/api/admin/seo', {
      method: 'PATCH', headers: { host: 'menu.example.test', origin: 'https://evil.example.test' },
    }))).toBe(false)
  })
})
