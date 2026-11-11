import { describe, expect, it } from 'vitest'
import { AR_UNAVAILABLE_HASH, arFallbackUrl, arPlatform, quickLookUrl, sceneViewerIntentUrl } from '@/lib/ar/launch'

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

describe('arPlatform', () => {
  it('opens Quick Look wherever the browser supports rel="ar"', () => {
    expect(arPlatform({ userAgent: UA.iphone, quickLook: true })).toBe('quick-look')
    expect(arPlatform({ userAgent: UA.ipadDesktop, quickLook: true, maxTouchPoints: 5 })).toBe('quick-look')
  })

  it('has no AR route on an iPhone browser without Quick Look (in-app browsers)', () => {
    expect(arPlatform({ userAgent: UA.iphone, quickLook: false })).toBeNull()
    expect(arPlatform({ userAgent: UA.ipadDesktop, quickLook: false, maxTouchPoints: 5 })).toBeNull()
  })

  it('opens Scene Viewer on Android', () => {
    expect(arPlatform({ userAgent: UA.android, quickLook: false })).toBe('scene-viewer')
  })

  it('has no AR camera on a computer', () => {
    expect(arPlatform({ userAgent: UA.windows, quickLook: false })).toBeNull()
    expect(arPlatform({ userAgent: UA.ipadDesktop, quickLook: false, maxTouchPoints: 0 })).toBeNull()
  })
})

describe('sceneViewerIntentUrl', () => {
  const glbUrl = 'https://cdn.example.com/t/ar/1-abc.glb'
  const fallbackUrl = 'https://menu.example.com/aurora?table=4#ar-unavailable'

  it('builds an AR-preferred intent opened by the Google app', () => {
    const url = sceneViewerIntentUrl({ glbUrl, title: 'Ham & Cheese', fallbackUrl, realScale: true })
    expect(url.startsWith('intent://arvr.google.com/scene-viewer/1.0?')).toBe(true)
    expect(url).toContain('#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;')
    expect(url.endsWith(';end;')).toBe(true)

    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1, url.indexOf('#')))
    expect(query.get('file')).toBe(glbUrl)
    expect(query.get('mode')).toBe('ar_preferred')
    expect(query.get('title')).toBe('Ham & Cheese')
    expect(query.get('resizable')).toBe('false')

    const fallback = url.match(/S\.browser_fallback_url=([^;]+);/)?.[1]
    expect(fallback && decodeURIComponent(fallback)).toBe(fallbackUrl)
  })

  it('lets the guest resize a model that is not at real scale, and caps the title at 60 characters', () => {
    const url = sceneViewerIntentUrl({ glbUrl, title: `  ${'x'.repeat(80)}  `, fallbackUrl, realScale: false })
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1, url.indexOf('#')))
    expect(query.has('resizable')).toBe(false)
    expect(query.get('title')).toHaveLength(60)
  })

  it('omits an empty title', () => {
    const url = sceneViewerIntentUrl({ glbUrl, title: '   ', fallbackUrl, realScale: true })
    expect(url).not.toContain('title=')
  })
})

describe('arFallbackUrl', () => {
  it('replaces any hash of the page with the AR-unavailable hash', () => {
    expect(arFallbackUrl('https://m.example.com/aurora?lang=pt')).toBe(`https://m.example.com/aurora?lang=pt${AR_UNAVAILABLE_HASH}`)
    expect(arFallbackUrl('https://m.example.com/aurora#dish')).toBe(`https://m.example.com/aurora${AR_UNAVAILABLE_HASH}`)
  })
})

describe('quickLookUrl', () => {
  it('lets guests resize: no scaling switch in the URL', () => {
    expect(quickLookUrl('https://cdn.example.com/a.usdz')).toBe('https://cdn.example.com/a.usdz')
    expect(quickLookUrl('blob:https://m.example.com/123', null)).toBe('blob:https://m.example.com/123')
  })

  it('adds Quick Look\'s order button with the dish and price', () => {
    const url = quickLookUrl('https://cdn.example.com/a.usdz', { label: 'Adicionar ao pedido', title: 'Ham & Cheese', subtitle: 'R$ 34,00' })
    expect(url).toBe('https://cdn.example.com/a.usdz#callToAction=Adicionar%20ao%20pedido&checkoutTitle=Ham%20%26%20Cheese&checkoutSubtitle=R%24%2034%2C00')
  })

  it('appends to an existing fragment and skips an empty price', () => {
    expect(quickLookUrl('blob:x#y=1', { label: 'Add', title: 'Pie' })).toBe('blob:x#y=1&callToAction=Add&checkoutTitle=Pie')
  })
})
