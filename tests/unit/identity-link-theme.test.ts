import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import IdentityPilot from '@/app/identity/IdentityPilot'
import type { IdentityWebConfig } from '@/lib/auth/identity-browser'
import { computePrimaryForeground } from '@/lib/color-utils'

vi.mock('@/lib/auth/identity-browser', () => ({ googleProof: vi.fn(), phoneProof: vi.fn() }))

describe('embedded existing-account verification presentation', () => {
  it.each(['#184D3B', '#F5D662'])('retains the existing credentials form and restaurant colour %s', primaryColor => {
    const html = renderToStaticMarkup(React.createElement(IdentityPilot, {
      config: {} as IdentityWebConfig, continueToApp: true, customerFlow: true, embedded: true, existingAccountLink: true,
      brand: { slug: 'fixture', name: 'Restaurant fixture', primaryColor, bannerUrl: null, logoUrl: null, country: 'US', currency: 'usd', lang: 'en' },
    }))
    expect(html).toContain('Restaurant fixture')
    expect(html).toContain('Link your existing account')
    expect(html).toContain('id="existing-email"')
    expect(html).toContain('id="existing-password"')
    expect(html).toContain('id="identity-phone"')
    expect(html).toContain('Continue with Google')
    expect(html).toContain(`--primary:${primaryColor}`)
    expect(html).toContain(`--primary-foreground:${computePrimaryForeground(primaryColor)}`)
    expect(html).toContain('bg-white text-zinc-950')
    expect(html).not.toContain('platform-dark')
  })

  it('keeps the platform presentation for an unbranded existing-account entry', () => {
    const html = renderToStaticMarkup(React.createElement(IdentityPilot, { config: {} as IdentityWebConfig, continueToApp: true, existingAccountLink: true }))
    expect(html).toContain('platform-dark')
    expect(html).toContain('Xprout')
    expect(html).toContain('id="existing-password"')
  })
})
