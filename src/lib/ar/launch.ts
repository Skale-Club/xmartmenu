/**
 * Augmented reality: opens a dish straight in the phone's own AR camera, the
 * way a shop's "view in your room" does. There is no 3D view in the page.
 *
 *   Android   Google Scene Viewer in AR-only mode (Google Play Services for AR),
 *             through an intent URL. Without it, Android sends the browser to
 *             the fallback URL, which carries AR_UNAVAILABLE_HASH.
 *   iOS       AR Quick Look with the dish's USDZ (made from the GLB when the
 *             model is uploaded; made on the phone if it is missing).
 *   other     no AR camera: the caller shows a QR code to open on a phone.
 *
 * Both viewers place the dish at its modelled size (metres) on the table;
 * scaling is turned off when the model is at real scale.
 *
 * The URL builders and the platform check are pure and unit-tested in
 * tests/unit/ar/launch.test.ts; openQuickLook touches the DOM.
 */

export type ArPlatform = 'scene-viewer' | 'quick-look'

/** Hash the page gets back when Android cannot open Scene Viewer. */
export const AR_UNAVAILABLE_HASH = '#ar-unavailable'

export interface ArEnvironment {
  userAgent: string
  /** `document.createElement('a').relList.supports('ar')`: true where AR Quick Look exists. */
  quickLook: boolean
  /** navigator.maxTouchPoints, to tell an iPad (desktop user agent) from a Mac. */
  maxTouchPoints?: number
}

/** Which AR viewer this device opens, or null when it has no AR camera. */
export function arPlatform(env: ArEnvironment): ArPlatform | null {
  if (env.quickLook) return 'quick-look'
  const ua = env.userAgent
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1)
  if (iOS) return null // Quick Look missing (an in-app browser): no AR route on iOS
  if (/Android/i.test(ua)) return 'scene-viewer'
  return null
}

/** The device's AR environment, read in the browser. */
export function currentArEnvironment(): ArEnvironment {
  let quickLook = false
  try {
    quickLook = document.createElement('a').relList.supports('ar')
  } catch {
    quickLook = false
  }
  return { userAgent: navigator.userAgent, quickLook, maxTouchPoints: navigator.maxTouchPoints }
}

/**
 * Scene Viewer intent, AR only: the camera opens with the dish on the table.
 * `fallbackUrl` is where Android goes when Google Play Services for AR is missing.
 */
export function sceneViewerIntentUrl(opts: { glbUrl: string; title: string; fallbackUrl: string; realScale: boolean }): string {
  const params = new URLSearchParams({ file: opts.glbUrl, mode: 'ar_only' })
  const title = opts.title.trim().slice(0, 60)
  if (title) params.set('title', title)
  if (opts.realScale) params.set('resizable', 'false')
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}`
    + '#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;'
    + `S.browser_fallback_url=${encodeURIComponent(opts.fallbackUrl)};end;`
}

/** The page's own URL with AR_UNAVAILABLE_HASH, for Scene Viewer's fallback. */
export function arFallbackUrl(href: string): string {
  return `${href.split('#')[0]}${AR_UNAVAILABLE_HASH}`
}

/** USDZ URL for Quick Look; real-scale models cannot be resized by the guest. */
export function quickLookUrl(usdzUrl: string, realScale: boolean): string {
  if (!realScale) return usdzUrl
  return `${usdzUrl}${usdzUrl.includes('#') ? '&' : '#'}allowsContentScaling=0`
}

/**
 * Opens AR Quick Look. Safari only opens it from an <a rel="ar"> whose first
 * child is an image; any other link would navigate away from the menu.
 */
export function openQuickLook(href: string): void {
  const anchor = document.createElement('a')
  anchor.setAttribute('rel', 'ar')
  anchor.setAttribute('href', href)
  anchor.appendChild(document.createElement('img'))
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
