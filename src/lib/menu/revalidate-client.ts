/**
 * Browser side: tell the server the public menu of the signed-in restaurant
 * changed, so its cached data (src/lib/menu/public-menu-cache.ts) is dropped.
 *
 * Admin screens that write straight to Supabase from the browser (products,
 * options, ingredients, media, translations, tables) call this after a
 * successful write. Fire-and-forget: a failure only means the menu stays
 * cached until the TTL runs out.
 */
export function notifyPublicMenuChanged(): void {
  if (typeof window === 'undefined') return
  void fetch('/api/admin/revalidate', { method: 'POST', keepalive: true }).catch(() => {})
}
