/**
 * The landing page's background video: where it lives in storage and the
 * pure rules the upload and re-encode flow share (route:
 * src/app/api/superadmin/platform/hero-video/route.ts).
 *
 * Flow: the browser PUTs the raw file to a fixed staging key with a signed
 * URL (no body-size limit), then asks the server to encode it with the
 * `hero` profile (src/lib/media/video.ts) into the published key, with a
 * poster frame next to it. The same route re-encodes the published video
 * in place, for a file that was uploaded before encoding existed.
 */

export const HERO_VIDEO_BUCKET = 'tenant-assets' as const
export const HERO_VIDEO_PATH = '_platform/hero-bg-video.mp4'
export const HERO_POSTER_PATH = '_platform/hero-bg-poster.webp'
const HERO_SOURCE_PREFIX = '_platform/hero-source'

export const HERO_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export const MAX_HERO_UPLOAD_BYTES = 200 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }

/** Staging key for a raw upload of this type, or null when the type is not accepted. */
export function heroSourcePath(mimeType: string): string | null {
  const ext = EXT_BY_TYPE[mimeType]
  return ext ? `${HERO_SOURCE_PREFIX}.${ext}` : null
}

/**
 * The storage keys the encode route may read: the staging keys and the
 * published video (for an in-place re-encode). Anything else is refused.
 */
export function isEncodableHeroPath(path: string): boolean {
  if (path === HERO_VIDEO_PATH || path === '_platform/hero-bg-video.webm') return true
  return Object.values(EXT_BY_TYPE).some(ext => path === `${HERO_SOURCE_PREFIX}.${ext}`)
}

/**
 * The storage key behind a published hero video URL
 * (https://host/_platform/hero-bg-video.mp4?v=123 → _platform/hero-bg-video.mp4),
 * or null when the URL is not one of ours.
 */
export function heroVideoPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const marker = pathname.indexOf('/_platform/')
  if (marker === -1) return null
  const path = pathname.slice(marker + 1)
  return isEncodableHeroPath(path) ? path : null
}

/** "17.5 MB → 5.2 MB (−70%)" for the panel. */
export function describeVideoSavings(originalBytes: number, bytes: number): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  if (originalBytes <= 0) return mb(bytes)
  const pct = Math.round((1 - bytes / originalBytes) * 100)
  return `${mb(originalBytes)} → ${mb(bytes)} (${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%)`
}
