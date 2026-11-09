import { getTenantBySlug } from '@/lib/menu/public-menu-data'
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'
import { safeCssColor } from '@/lib/color-utils'

/** What the platform sign-in shows when it opens inside a restaurant's menu. */
export interface GuestBrand {
  /** The menu's slug, kept on links that stay inside the sign-in. */
  slug: string
  name: string
  logoUrl: string | null
  bannerUrl: string | null
  /** Safe hex. */
  primaryColor: string
  country: string | null
  currency: string | null
  /** A menu language code ("pt", "zh-TW"), English when unknown. */
  lang: string
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * The restaurant a guest is signing in from (the menu passes its slug and
 * language to the embedded sign-in). Only public menu facts: name, logo,
 * banner, colour, country and currency. Null for an unknown or inactive slug,
 * and the sign-in then shows without a restaurant.
 */
export async function guestBrandFor(slug: unknown, lang: unknown): Promise<GuestBrand | null> {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null
  const tenant = await getTenantBySlug(slug).catch(() => null)
  if (!tenant) return null
  const settings = (tenant.tenant_settings ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof settings[key] === 'string' && settings[key] ? settings[key] as string : null)
  return {
    slug,
    name: tenant.name,
    logoUrl: text('logo_url'),
    bannerUrl: text('banner_url'),
    primaryColor: safeCssColor(text('primary_color'), '#18181b'),
    country: text('country'),
    currency: text('currency'),
    lang: typeof lang === 'string' && (MENU_LANGUAGE_CODES as readonly string[]).includes(lang) ? lang : 'en',
  }
}
