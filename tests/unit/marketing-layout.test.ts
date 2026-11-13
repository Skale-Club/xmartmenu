import React, { type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND_BASE } from '@/lib/brand'

const mocks = vi.hoisted(() => ({ settings: vi.fn() }))
vi.mock('@/lib/data/platform-settings', () => ({ platformSettingsOwned: () => true }))
vi.mock('@/lib/data/platform-settings-runtime', () => ({ readOwnedPlatformSettings: mocks.settings }))
vi.mock('@/components/tracking/PlatformTagManager', () => ({ PlatformTagManager: () => null }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => { throw new Error('Legacy store must not be queried') } }))
import MarketingLayout from '@/app/(marketing)/layout'

beforeEach(() => vi.clearAllMocks())

describe('nested marketing theme ownership', () => {
  it('renders a scoped theme without replacing the root document or fonts', async () => {
    mocks.settings.mockResolvedValue({ cta_color: '#283F32' })
    const html = renderToStaticMarkup(await MarketingLayout({ children: React.createElement('main', null, 'Page') }) as ReactElement)
    expect(html).toMatch(/^<div/)
    expect(html).not.toMatch(/<\/?(?:html|body)\b|:root\s*\{/)
    expect(html).toContain('--primary:#283F32')
    expect(html).toContain(`--primary-foreground:${BRAND_BASE}`)
    expect(html).toContain('<main>Page</main>')
  })

  it('preserves a configured platform primary inside the marketing boundary', async () => {
    mocks.settings.mockResolvedValue({ cta_color: '#F5D662' })
    const html = renderToStaticMarkup(await MarketingLayout({ children: 'Page' }) as ReactElement)
    expect(html).toContain('--primary:#F5D662')
    expect(html).toContain('--primary-foreground:#09090b')
    expect(html).not.toMatch(/<style>|<html|<body/)
  })
})
