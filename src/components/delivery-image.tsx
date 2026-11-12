import Image, { type ImageProps } from 'next/image'

/** Keep arbitrary legacy URLs working while optimizing sources allowed by next.config.ts. */
export function canOptimizeImage(src: ImageProps['src']): boolean {
  if (typeof src !== 'string') return true
  let url: URL
  try {
    url = new URL(src, 'https://local.invalid')
  } catch {
    return false
  }
  if (/\.svg$/i.test(url.pathname)) return false
  if (src.startsWith('/') && !src.startsWith('//')) {
    return !url.search || (url.pathname.startsWith('/brands/celes-confections/') && url.search === '?v=20261029')
  }
  if (url.protocol !== 'https:' || url.port) return false
  if (['xmartmenu-tenant-assets.skale.club', 'xmartmenu-product-images.skale.club', 'images.unsplash.com'].includes(url.hostname)) return true
  return /^[^.]+\.supabase\.co$/.test(url.hostname) && url.pathname.startsWith('/storage/v1/object/public/')
}

/** Callers supply the rendered size so small logos and mobile covers stay small. */
export function DeliveryImage(props: ImageProps) {
  return <Image {...props} alt={props.alt} unoptimized={props.unoptimized || !canOptimizeImage(props.src)} />
}
