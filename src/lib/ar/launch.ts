/**
 * Augmented reality: opens a dish straight in the phone's own AR camera, the
 * way a shop's "view in your room" does. There is no 3D view in the page.
 *
 *   Android   Google Scene Viewer through the Google app (on almost every
 *             Android phone), AR preferred: the camera opens with the dish on
 *             the table; Scene Viewer asks to install Google Play Services for
 *             AR when it is missing, and shows the dish in 3D on a phone with
 *             no AR. Without the Google app, Android sends the browser to the
 *             fallback URL, which carries AR_UNAVAILABLE_HASH.
 *   iOS       AR Quick Look with the dish's USDZ (made from the GLB when the
 *             model is uploaded; made on the phone if it is missing).
 *   computer  no AR camera: the dish sheet shows the model in a 3D viewer in
 *             the page instead (turn it with the mouse, zoom with the wheel;
 *             owner decision 2026-11-12, computers only). iPhone in-app
 *             browsers get neither.
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

/**
 * A computer: no phone or tablet (no AR camera at all), so the dish is shown in
 * a 3D viewer in the page instead. False on any iPhone/iPad (even an in-app
 * browser or an iPad with a desktop user agent) and on Android.
 */
export function isComputer(env: ArEnvironment): boolean {
  if (env.quickLook) return false
  const ua = env.userAgent
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return false
  if (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1) return false
  return true
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
 * Scene Viewer intent, AR preferred, opened by the Google app (the way
 * Google's <model-viewer> does). An AR-only intent for Google Play Services
 * for AR (com.google.ar.core) did nothing on phones without that app, which
 * many Android phones do not have installed; the Google app is on almost all
 * of them and handles the install prompt and the no-AR case itself.
 * `fallbackUrl` is where Android goes when the Google app is missing.
 */
export function sceneViewerIntentUrl(opts: { glbUrl: string; title: string; fallbackUrl: string; realScale: boolean }): string {
  const params = new URLSearchParams({ file: opts.glbUrl, mode: 'ar_preferred' })
  const title = opts.title.trim().slice(0, 60)
  if (title) params.set('title', title)
  if (opts.realScale) params.set('resizable', 'false')
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}`
    + '#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;'
    + `S.browser_fallback_url=${encodeURIComponent(opts.fallbackUrl)};end;`
}

/** The page's own URL with AR_UNAVAILABLE_HASH, for Scene Viewer's fallback. */
export function arFallbackUrl(href: string): string {
  return `${href.split('#')[0]}${AR_UNAVAILABLE_HASH}`
}

/** Quick Look's own button at the bottom of the AR view ("Add to order · R$ 34"). */
export interface QuickLookAction {
  /** The button's text. */
  label: string
  /** Shown above it: the dish. */
  title: string
  /** Under the title: the price. */
  subtitle?: string
}

/** The message Quick Look sends to the <a rel="ar"> when its button is tapped. */
export const QUICK_LOOK_ACTION_MESSAGE = '_apple_ar_quicklook_button_tapped'

/**
 * USDZ URL for Quick Look. Guests may resize the dish (Quick Look shows the %
 * and snaps back to 100 %, the real size); `action` adds Quick Look's order
 * button (callToAction / checkoutTitle / checkoutSubtitle in the fragment).
 */
export function quickLookUrl(usdzUrl: string, action?: QuickLookAction | null): string {
  if (!action) return usdzUrl
  const params = [
    `callToAction=${encodeURIComponent(action.label)}`,
    `checkoutTitle=${encodeURIComponent(action.title.trim().slice(0, 60))}`,
    ...(action.subtitle ? [`checkoutSubtitle=${encodeURIComponent(action.subtitle)}`] : []),
  ]
  return `${usdzUrl}${usdzUrl.includes('#') ? '&' : '#'}${params.join('&')}`
}

/**
 * Opens AR Quick Look. Safari only opens it from an <a rel="ar"> whose first
 * child is an image; any other link would navigate away from the menu.
 */
export function openQuickLook(href: string, onAction?: () => void): void {
  const anchor = document.createElement('a')
  anchor.setAttribute('rel', 'ar')
  anchor.setAttribute('href', href)
  anchor.appendChild(document.createElement('img'))
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  if (!onAction) {
    anchor.click()
    anchor.remove()
    return
  }
  // Quick Look reports its button on this anchor, so it stays in the page
  // while the guest is in AR (removed after 30 min at the latest).
  const removeLater = window.setTimeout(() => anchor.remove(), 30 * 60_000)
  anchor.addEventListener('message', event => {
    if ((event as MessageEvent).data !== QUICK_LOOK_ACTION_MESSAGE) return
    onAction()
  })
  anchor.click()
  void removeLater
}
