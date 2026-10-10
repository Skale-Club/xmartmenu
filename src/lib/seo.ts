import type { TenantSettings, BusinessHours, Category, Product } from '@/types/database'

export const PLATFORM_BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://xmartmenu.skale.club'

/** Hostname (no scheme/port) of the platform domain — used for per-host robots/sitemap logic. */
export const PLATFORM_HOST = PLATFORM_BASE.replace(/^https?:\/\//, '').split(':')[0]

// Day names for schema.org DayOfWeek
const SCHEMA_DAYS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export function getCanonicalUrl(
  tenant: { slug: string; custom_domain?: string | null; custom_domain_verified?: boolean },
  path: string = '/',
): string {
  const base = (tenant.custom_domain && tenant.custom_domain_verified)
    ? `https://${tenant.custom_domain}`
    : `${PLATFORM_BASE}/${tenant.slug}`
  const suffix = path === '/' ? '' : path.replace(/^\//, '')
  return suffix ? `${base}/${suffix}` : base
}

function parseHours(str: string): { opens: string; closes: string } | null {
  const match = str.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/)
  if (!match) return null
  return { opens: match[1], closes: match[2] }
}

function buildOpeningHours(hours: BusinessHours): object[] {
  return Object.entries(hours)
    .filter(([, v]) => v && v.trim())
    .flatMap(([day, value]) => {
      const parsed = parseHours(value!)
      if (!parsed || !SCHEMA_DAYS[day]) return []
      return [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
        opens: parsed.opens,
        closes: parsed.closes,
      }]
    })
}

// ----- Local SEO building blocks (SEED-014) -----

interface AddressParts {
  streetAddress?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

/** schema.org PostalAddress, omitting empty parts. Returns null when fully empty. */
function buildPostalAddress(a: AddressParts): object | null {
  const entries: [string, string | null | undefined][] = [
    ['streetAddress', a.streetAddress],
    ['addressLocality', a.city],
    ['addressRegion', a.region],
    ['postalCode', a.postalCode],
    ['addressCountry', a.country],
  ]
  const filled = entries.filter(([, v]) => v && String(v).trim())
  if (!filled.length) return null
  return { '@type': 'PostalAddress', ...Object.fromEntries(filled) }
}

/** schema.org GeoCoordinates from lat/lng, or null when either is missing. */
function buildGeo(lat: number | null | undefined, lng: number | null | undefined): object | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { '@type': 'GeoCoordinates', latitude: lat, longitude: lng }
}

/** Google Maps deep-link from coordinates (preferred) or a free-text address. */
function buildMapUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  addressParts: (string | null | undefined)[],
): string | null {
  if (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  }
  const q = addressParts.filter((p) => p && String(p).trim()).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

/** Public profile URLs (Instagram, WhatsApp) surfaced as schema.org sameAs. */
export function buildSameAs(settings: { instagram?: string | null; whatsapp?: string | null } | null): string[] {
  const out: string[] = []
  const ig = settings?.instagram?.trim()
  if (ig) {
    out.push(/^https?:\/\//.test(ig) ? ig : `https://instagram.com/${ig.replace(/^@/, '')}`)
  }
  const wa = settings?.whatsapp?.trim()
  if (wa) {
    const digits = wa.replace(/[^\d]/g, '')
    if (digits) out.push(`https://wa.me/${digits}`)
  }
  return out
}

export function buildLocalBusinessJsonLd(
  tenant: { name: string; slug: string; custom_domain?: string | null; custom_domain_verified?: boolean },
  settings: TenantSettings | null,
  canonicalUrl: string,
): object {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': canonicalUrl,
    name: tenant.name,
    url: canonicalUrl,
    // The menu page IS the canonical home — link it as the restaurant's menu.
    menu: canonicalUrl,
    hasMenu: canonicalUrl,
  }

  if (settings?.tagline) ld.description = settings.tagline
  else if (settings?.about) ld.description = settings.about.slice(0, 300)

  if (settings?.phone) ld.telephone = settings.phone

  const address = buildPostalAddress({
    streetAddress: settings?.address,
    city: settings?.city,
    region: settings?.region,
    postalCode: settings?.postal_code,
    country: settings?.country,
  })
  if (address) ld.address = address

  const geo = buildGeo(settings?.latitude, settings?.longitude)
  if (geo) ld.geo = geo

  const mapUrl = buildMapUrl(settings?.latitude, settings?.longitude, [
    settings?.address, settings?.city, settings?.region, settings?.postal_code, settings?.country,
  ])
  if (mapUrl) ld.hasMap = mapUrl

  if (settings?.price_range?.trim()) ld.priceRange = settings.price_range.trim()

  if (settings?.logo_url) {
    ld.image = settings.logo_url
    ld.logo = settings.logo_url
  }

  if (settings?.business_type) {
    ld.servesCuisine = settings.business_type
  }

  if (settings?.business_hours) {
    const specs = buildOpeningHours(settings.business_hours)
    if (specs.length) ld.openingHoursSpecification = specs
  }

  const sameAs = buildSameAs(settings)
  if (sameAs.length) ld.sameAs = sameAs

  return ld
}

export function buildMenuJsonLd(
  menuName: string,
  menuUrl: string,
  categories: Category[],
  products: Product[],
  currency: string,
): object {
  const catMap = new Map(categories.map(c => [c.id, c]))

  const sections = categories
    .filter(cat => products.some(p => p.category_id === cat.id))
    .map(cat => ({
      '@type': 'MenuSection',
      name: cat.name,
      hasMenuItem: products
        .filter(p => p.category_id === cat.id)
        .slice(0, 50)
        .map(p => buildMenuItem(p, currency)),
    }))

  const uncategorized = products
    .filter(p => !p.category_id || !catMap.has(p.category_id))
    .slice(0, 50)

  if (uncategorized.length) {
    sections.push({
      '@type': 'MenuSection',
      name: 'Other',
      hasMenuItem: uncategorized.map(p => buildMenuItem(p, currency)),
    })
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: menuName,
    url: menuUrl,
    ...(sections.length ? { hasMenuSection: sections } : {}),
  }
}

// SEO-08 / Phase 43: per-branch LocalBusiness with branchOf link
export function buildBranchJsonLd(
  location: {
    name: string
    address: string | null
    city: string | null
    phone: string | null
    business_hours: Record<string, string> | null
    region?: string | null
    postal_code?: string | null
    country?: string | null
    latitude?: number | null
    longitude?: number | null
  },
  branchUrl: string,
  parentUrl: string,
  // Inherited from the parent tenant where the branch has no own value.
  inherited?: { priceRange?: string | null; sameAs?: string[] } | null,
): object {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': branchUrl,
    name: location.name,
    url: branchUrl,
    menu: branchUrl,
    hasMenu: branchUrl,
    branchOf: {
      '@type': 'Restaurant',
      '@id': parentUrl,
    },
  }

  if (location.phone) ld.telephone = location.phone

  const address = buildPostalAddress({
    streetAddress: location.address,
    city: location.city,
    region: location.region,
    postalCode: location.postal_code,
    country: location.country,
  })
  if (address) ld.address = address

  const geo = buildGeo(location.latitude, location.longitude)
  if (geo) ld.geo = geo

  const mapUrl = buildMapUrl(location.latitude, location.longitude, [
    location.address, location.city, location.region, location.postal_code, location.country,
  ])
  if (mapUrl) ld.hasMap = mapUrl

  if (inherited?.priceRange?.trim()) ld.priceRange = inherited.priceRange.trim()
  if (inherited?.sameAs && inherited.sameAs.length) ld.sameAs = inherited.sameAs

  if (location.business_hours) {
    const specs = buildOpeningHours(location.business_hours)
    if (specs.length) ld.openingHoursSpecification = specs
  }

  return ld
}

function buildMenuItem(p: Product, currency: string): object {
  const item: Record<string, unknown> = {
    '@type': 'MenuItem',
    name: p.name,
    offers: {
      '@type': 'Offer',
      price: p.price.toFixed(2),
      priceCurrency: currency,
    },
  }
  if (p.description) item.description = p.description
  if (p.image_url) item.image = p.image_url
  return item
}

// ============================================================
// SEED-014: per-tenant SEO resolution helpers
// Prefer explicit tenant overrides (seo_*), then derive from existing
// branding/AI-copy fields, then fall back to a sensible default.
// ============================================================

type SeoTenant = { name: string }
type SeoSettings = Pick<
  TenantSettings,
  'seo_title' | 'seo_description' | 'seo_keywords' | 'seo_og_image_url' |
  'seo_noindex' | 'tagline' | 'about' | 'logo_url' | 'banner_url'
> | null

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

export function resolveSeoTitle(tenant: SeoTenant, settings: SeoSettings, suffix?: string): string {
  const base = clean(settings?.seo_title) ?? tenant.name
  return suffix ? `${suffix} | ${base}` : base
}

export function resolveSeoDescription(tenant: SeoTenant, settings: SeoSettings, fallbackLabel?: string): string {
  return (
    clean(settings?.seo_description) ??
    clean(settings?.tagline) ??
    clean(settings?.about)?.slice(0, 160) ??
    `${fallbackLabel ?? 'View the full menu'} of ${tenant.name}`
  )
}

/** Comma-separated keyword list, normalized into an array (max 12). Empty when unset. */
export function resolveSeoKeywords(settings: SeoSettings): string[] {
  const raw = clean(settings?.seo_keywords)
  if (!raw) return []
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 12)
}

/** Explicit social-share image override (https). null means "use the generated branded card". */
export function resolveOgImageOverride(settings: SeoSettings): string | null {
  const url = clean(settings?.seo_og_image_url)
  return url && /^https:\/\//.test(url) ? url : null
}

export function isTenantNoindex(settings: SeoSettings): boolean {
  return settings?.seo_noindex === true
}

/** schema.org BreadcrumbList for richer SERP breadcrumbs. */
export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

// ============================================================
// SEED-014: platform-level structured data (marketing landing)
// ============================================================

export function buildPlatformOrganizationJsonLd(opts: {
  name: string
  url: string
  description?: string | null
  logoUrl?: string | null
  sameAs?: string[]
}): object {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: opts.name,
    url: opts.url,
  }
  if (clean(opts.description)) ld.description = opts.description
  if (clean(opts.logoUrl)) ld.logo = opts.logoUrl
  if (opts.sameAs && opts.sameAs.length) ld.sameAs = opts.sameAs
  return ld
}

export function buildWebSiteJsonLd(opts: { name: string; url: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: opts.name,
    url: opts.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${opts.url.replace(/\/$/, '')}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildSoftwareApplicationJsonLd(opts: { name: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: opts.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free during beta',
    },
  }
}
