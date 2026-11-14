import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LazyMotion, domAnimation } from 'framer-motion'
import { describe, expect, it } from 'vitest'
import { isDefaultPlatformLogo, PLATFORM_BRAND_ASSETS, platformLogoUrl } from '@/lib/platform-brand'
import { platformMetadataIcons } from '@/lib/platform-metadata'
import PlatformSignature from '@/components/branding/PlatformSignature'
import { Nav, Footer } from '@/components/marketing/MarketingChrome'
import manifest from '@/app/manifest'
import socialImage, { contentType, size } from '@/app/opengraph-image'

describe('approved platform identity preserves explicit configuration', () => {
  it('selects versioned default assets without silently rewriting old or custom logos', () => {
    expect(platformLogoUrl(null)).toBe(PLATFORM_BRAND_ASSETS.icon)
    expect(isDefaultPlatformLogo(`https://xprout.app${PLATFORM_BRAND_ASSETS.icon}`)).toBe(true)
    for (const configured of ['/icon.png', 'https://custom.example/logo.png', `${PLATFORM_BRAND_ASSETS.icon}?custom=1`]) {
      expect(platformLogoUrl(configured)).toBe(configured)
      expect(isDefaultPlatformLogo(configured)).toBe(false)
    }
    expect(platformMetadataIcons('https://custom.example/logo.png')).toMatchObject({ icon: 'https://custom.example/logo.png' })
  })
  it('renders an accessible image signature with the approved aspect and no typeset substitute', () => {
    const markup = renderToStaticMarkup(createElement(PlatformSignature, { tone: 'ivory' }))
    expect(markup).toContain('alt="Xprout"')
    expect(markup).toContain(PLATFORM_BRAND_ASSETS.horizontalIvory)
    expect(markup).toContain('aspect-ratio:1176.5155165075823 / 326.6565102866406')
    expect(markup).not.toContain('<span')
  })
  it('uses the signature only for the default Xprout identity in navigation and footer', () => {
    const nav = (props: Parameters<typeof Nav>[0]) => renderToStaticMarkup(createElement(LazyMotion, { features: domAnimation, children: createElement(Nav, props) }))
    expect(nav({})).toContain(PLATFORM_BRAND_ASSETS.horizontalIvory)
    expect(nav({ appName: 'Custom', logoUrl: 'https://custom.example/logo.png' })).not.toContain(PLATFORM_BRAND_ASSETS.horizontalIvory)
    expect(nav({ appName: 'Custom' })).toContain('Custom')
    const footer = renderToStaticMarkup(createElement(Footer, { appName: 'Xprout' }))
    expect(footer).toContain(PLATFORM_BRAND_ASSETS.horizontalIvory)
  })
  it('publishes versioned PWA icons and bounded approved PNG social bytes', async () => {
    const icons = manifest().icons!
    expect(icons.map(icon => icon.src)).toEqual([PLATFORM_BRAND_ASSETS.icon192, PLATFORM_BRAND_ASSETS.icon, PLATFORM_BRAND_ASSETS.maskable192, PLATFORM_BRAND_ASSETS.maskable512])
    expect(icons.map(icon => icon.purpose)).toEqual(['any', 'any', 'maskable', 'maskable'])
    expect(JSON.stringify(platformMetadataIcons())).toContain(PLATFORM_BRAND_ASSETS.apple)
    const response = await socialImage(), bytes = Buffer.from(await response.arrayBuffer())
    expect(response.headers.get('content-type')).toBe(contentType)
    expect(bytes.length).toBeLessThanOrEqual(180 * 1024)
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([size.width, size.height])
  })
})
