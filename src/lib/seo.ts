import type { TenantSettings, BusinessHours, Category, Product } from '@/types/database'

const PLATFORM_BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://xmartmenu.skale.club'

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
  }

  if (settings?.tagline) ld.description = settings.tagline
  else if (settings?.about) ld.description = settings.about.slice(0, 300)

  if (settings?.phone) ld.telephone = settings.phone

  if (settings?.address) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: settings.address,
    }
  }

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
