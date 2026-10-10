// Website launch checklist — the catalog of everything a tenant site needs
// before (and right after) it goes live: indexing, analytics, on-page SEO,
// local presence, domain/security, quality and legal/conversion.
//
// The catalog lives in code; only the per-tenant ticks live in the database
// (`launch_checklist_items`, one row per tenant × item that a super-admin has
// touched). A missing row means "pending". Adding an item here is all it takes
// to show it for every tenant — no migration. Removing one leaves its old rows
// orphaned but harmless: the API only reports keys that are still in the
// catalog.
//
// The same catalog ships in the Xkedule and Websites super-admins; keep the
// keys aligned so the three panels speak the same language.

export const LAUNCH_CHECKLIST_CATEGORIES = [
  'indexing',
  'analytics',
  'seo',
  'local',
  'infra',
  'quality',
  'legal',
] as const
export type LaunchChecklistCategory = (typeof LAUNCH_CHECKLIST_CATEGORIES)[number]

export const LAUNCH_CHECKLIST_CATEGORY_LABELS: Record<LaunchChecklistCategory, string> = {
  indexing: 'Search & indexing',
  analytics: 'Analytics & tracking',
  seo: 'On-page SEO',
  local: 'Local presence',
  infra: 'Domain & security',
  quality: 'Performance & quality',
  legal: 'Legal & conversion',
}

/** Stored statuses. A tenant × item with no row is 'pending'. */
export const LAUNCH_CHECKLIST_STATUSES = ['pending', 'done', 'na'] as const
export type LaunchChecklistStatus = (typeof LAUNCH_CHECKLIST_STATUSES)[number]

export interface LaunchChecklistItemDef {
  key: string
  category: LaunchChecklistCategory
  label: string
  description: string
  /**
   * Optional "open this tool" link. `{url}` is replaced by the site's public
   * origin (https://domain) and `{domain}` by the bare hostname; a template
   * that needs one of them is hidden while the tenant has no domain.
   */
  link?: string
}

export const LAUNCH_CHECKLIST_ITEMS: readonly LaunchChecklistItemDef[] = [
  // Search & indexing
  {
    key: 'site_published',
    category: 'indexing',
    label: 'Site published for search engines',
    description: 'Restaurant is active and the menu is not set to noindex.',
  },
  {
    key: 'robots_txt',
    category: 'indexing',
    link: '{url}/robots.txt',
    label: 'robots.txt',
    description: 'robots.txt allows crawling and points to the sitemap.',
  },
  {
    key: 'sitemap_xml',
    category: 'indexing',
    link: '{url}/sitemap.xml',
    label: 'sitemap.xml',
    description: 'sitemap.xml loads and lists every public page.',
  },
  {
    key: 'gsc_verified',
    category: 'indexing',
    link: 'https://search.google.com/search-console',
    label: 'Google Search Console verified',
    description: 'A Search Console property exists for the domain and ownership is verified.',
  },
  {
    key: 'gsc_sitemap',
    category: 'indexing',
    link: 'https://search.google.com/search-console/sitemaps',
    label: 'Sitemap submitted to Search Console',
    description: 'sitemap.xml submitted in Search Console → Sitemaps, status Success.',
  },
  {
    key: 'gsc_index_request',
    category: 'indexing',
    link: 'https://search.google.com/search-console/inspect',
    label: 'Homepage indexing requested',
    description: 'URL Inspection run on the homepage and "Request indexing" clicked.',
  },
  {
    key: 'bing_webmaster',
    category: 'indexing',
    link: 'https://www.bing.com/webmasters',
    label: 'Bing Webmaster Tools',
    description: 'Site added to Bing Webmaster Tools (import from Search Console) with the sitemap submitted.',
  },

  // Analytics & tracking
  {
    key: 'ga4',
    category: 'analytics',
    link: 'https://analytics.google.com',
    label: 'Google Analytics 4',
    description: 'GA4 installed and showing visits in the Realtime report (no per-restaurant setting yet — mark N/A if not used).',
  },
  {
    key: 'gtm',
    category: 'analytics',
    link: 'https://tagmanager.google.com',
    label: 'Google Tag Manager',
    description: 'GTM container installed and published (when the site uses GTM).',
  },
  {
    key: 'clarity',
    category: 'analytics',
    link: 'https://clarity.microsoft.com',
    label: 'Microsoft Clarity',
    description: 'Clarity project created and recording sessions and heatmaps (no per-restaurant setting yet — mark N/A if not used).',
  },
  {
    key: 'meta_pixel',
    category: 'analytics',
    link: 'https://business.facebook.com/events_manager2',
    label: 'Meta Pixel',
    description: 'Meta (Facebook/Instagram) Pixel installed and receiving PageView events.',
  },
  {
    key: 'conversions',
    category: 'analytics',
    label: 'Conversion events',
    description: 'Key actions tracked as conversions: WhatsApp click, order, call click.',
  },
  {
    key: 'ga4_gsc_link',
    category: 'analytics',
    label: 'GA4 linked to Search Console',
    description: 'Search Console linked in GA4 → Admin → Product links.',
  },
  {
    key: 'ads_conversion',
    category: 'analytics',
    link: 'https://ads.google.com',
    label: 'Google Ads conversion tracking',
    description: 'Conversion tracking configured in Google Ads (when the client runs ads).',
  },

  // On-page SEO
  {
    key: 'meta_titles',
    category: 'seo',
    label: 'Titles and meta descriptions',
    description: 'Every main page has a unique title and meta description.',
  },
  {
    key: 'og_image',
    category: 'seo',
    link: 'https://www.opengraph.xyz/url/{url}',
    label: 'Social share preview (Open Graph)',
    description: 'Sharing the link on WhatsApp/Facebook shows the right image, title and description.',
  },
  {
    key: 'favicon',
    category: 'seo',
    label: 'Favicon and app icons',
    description: "The restaurant's own icon shows in the browser tab and on phone home screens.",
  },
  {
    key: 'structured_data',
    category: 'seo',
    link: 'https://search.google.com/test/rich-results?url={url}',
    label: 'Structured data validated',
    description: 'Rich Results Test passes for the homepage (LocalBusiness / Organization).',
  },
  {
    key: 'canonical_host',
    category: 'seo',
    label: 'Single canonical address',
    description: 'www and non-www (and http) redirect to one address, and canonical tags point to it.',
  },

  // Local presence
  {
    key: 'gbp',
    category: 'local',
    link: 'https://business.google.com',
    label: 'Google Business Profile',
    description: 'Business profile verified and linking to the website.',
  },
  {
    key: 'bing_places',
    category: 'local',
    link: 'https://www.bingplaces.com',
    label: 'Bing Places',
    description: 'Listing claimed on Bing Places (can be imported from Google Business Profile).',
  },
  {
    key: 'nap',
    category: 'local',
    label: 'Consistent name, address and phone',
    description: 'Business name, address and phone match across the site, Google and directories.',
  },

  // Domain & security
  {
    key: 'custom_domain',
    category: 'infra',
    label: 'Custom domain connected',
    description: "The restaurant's own domain points to the menu and is verified (or mark N/A for a slug-only menu).",
  },
  {
    key: 'https',
    category: 'infra',
    link: 'https://www.ssllabs.com/ssltest/analyze.html?d={domain}',
    label: 'HTTPS everywhere',
    description: 'Valid SSL certificate on the domain and on www, no mixed-content warnings.',
  },
  {
    key: 'email_dns',
    category: 'infra',
    link: 'https://mxtoolbox.com/SuperTool.aspx?action=dmarc%3a{domain}',
    label: 'Email DNS (SPF, DKIM, DMARC)',
    description: "Domain email is authenticated so messages from the site don't land in spam.",
  },
  {
    key: 'uptime',
    category: 'infra',
    label: 'Uptime monitoring',
    description: 'Someone is alerted if the site goes down.',
  },

  // Performance & quality
  {
    key: 'pagespeed',
    category: 'quality',
    link: 'https://pagespeed.web.dev/analysis?url={url}',
    label: 'PageSpeed / Core Web Vitals',
    description: 'PageSpeed Insights on mobile scores 90+ (or the gaps are understood).',
  },
  {
    key: 'mobile_check',
    category: 'quality',
    label: 'Checked on a phone',
    description: 'Every page reviewed on a real phone (375px): menu, forms, buttons, text size.',
  },
  {
    key: 'broken_links',
    category: 'quality',
    link: 'https://www.brokenlinkcheck.com',
    label: 'No broken links',
    description: 'No links to missing pages or 404s across the site.',
  },
  {
    key: 'image_alt',
    category: 'quality',
    label: 'Images optimized with alt text',
    description: 'Images are compressed and have descriptive alt text.',
  },

  // Legal & conversion
  {
    key: 'privacy_terms',
    category: 'legal',
    label: 'Privacy policy and terms',
    description: 'Privacy policy and terms of use published and linked in the footer.',
  },
  {
    key: 'cookie_consent',
    category: 'legal',
    label: 'Cookie consent',
    description: 'Consent banner on where the law requires it (EU/UK, Brazil), otherwise mark N/A.',
  },
  {
    key: 'forms_tested',
    category: 'legal',
    label: 'Ordering tested end to end',
    description: 'A real test order went through end to end: menu → cart → checkout/WhatsApp → kitchen.',
  },
  {
    key: 'notifications',
    category: 'legal',
    label: 'Order notifications',
    description: 'The restaurant is notified of every new order (dashboard, WhatsApp, kitchen display).',
  },
]

export const LAUNCH_CHECKLIST_KEYS: ReadonlySet<string> = new Set(LAUNCH_CHECKLIST_ITEMS.map((i) => i.key))

export function isLaunchChecklistKey(key: string): boolean {
  return LAUNCH_CHECKLIST_KEYS.has(key)
}

export function isLaunchChecklistStatus(value: unknown): value is LaunchChecklistStatus {
  return typeof value === 'string' && (LAUNCH_CHECKLIST_STATUSES as readonly string[]).includes(value)
}

/** One tenant × item tick as served by the API. */
export interface LaunchChecklistEntry {
  status: LaunchChecklistStatus
  note: string
  updatedBy: string | null
  updatedAt: string | null
}

/**
 * What the server could infer from data it already has (tracking ids, SEO
 * fields, domains, the publish gate). Advisory only — it never ticks an item
 * by itself, but the UI shows it next to the checkbox so ticking is a glance,
 * and flags an item ticked "done" that the data contradicts.
 */
export interface LaunchChecklistSignal {
  ok: boolean
  /** Reason code, worded for humans by LAUNCH_CHECKLIST_REASON_LABELS. */
  reason?: LaunchChecklistSignalReason
  /** A literal value worth showing as-is (a tracking id, a hostname, a count). */
  value?: string
}

export const LAUNCH_CHECKLIST_REASON_LABELS = {
  noDomain: 'no custom domain (menu served at the platform slug)',
  domainUnverified: 'domain not verified',
  tenantNotActive: 'restaurant is inactive',
  robotsNoindex: 'SEO settings say noindex',
  robotsAllow: 'auto-generated, allows crawling',
  robotsInactive: 'inactive restaurants are not served',
  autoGenerated: 'auto-generated',
  usingFallback: 'no custom value, falls back to name/tagline',
  ogGenerated: 'a branded card is generated automatically',
  noFavicon: 'no logo uploaded',
  localSeoSet: 'city and coordinates set',
  noLocalSeo: 'no city/coordinates for local SEO',
  noPhone: 'no phone',
  noAddress: 'no address',
} as const
export const LAUNCH_CHECKLIST_SIGNAL_REASONS = Object.keys(LAUNCH_CHECKLIST_REASON_LABELS) as (keyof typeof LAUNCH_CHECKLIST_REASON_LABELS)[]
export type LaunchChecklistSignalReason = keyof typeof LAUNCH_CHECKLIST_REASON_LABELS

export interface LaunchChecklistTenant {
  id: string
  name: string
  slug: string
  status: string
  primaryDomain: string | null
  /** Public address of the menu: the verified custom domain, else the platform slug URL. */
  siteUrl: string
  entries: Record<string, LaunchChecklistEntry>
  signals: Record<string, LaunchChecklistSignal>
}

export interface LaunchChecklistResponse {
  tenants: LaunchChecklistTenant[]
  /** True when launch_checklist_items does not exist yet (migration not applied). */
  setupRequired: boolean
}

/**
 * Fills `{url}` (the menu's public address — custom domain or platform slug
 * URL) and `{domain}` (custom domain only; templates needing it are hidden
 * while the restaurant has none).
 */
export function resolveLaunchChecklistLink(template: string | undefined, siteUrl: string, domain: string | null): string | null {
  if (!template) return null
  if (template.includes('{domain}') && !domain) return null
  // A template that STARTS with {url} is the site itself (robots.txt, …);
  // anywhere else the address is a parameter to a third-party tool.
  const urlValue = template.startsWith('{url}') ? siteUrl : encodeURIComponent(siteUrl)
  return template.replace('{url}', urlValue).replace('{domain}', domain ?? '')
}

export interface LaunchChecklistProgress {
  done: number
  na: number
  pending: number
  total: number
  /** done + na over total, 0–100. */
  percent: number
}

export function summarizeLaunchChecklist(entries: Record<string, LaunchChecklistEntry>): LaunchChecklistProgress {
  let done = 0
  let na = 0
  for (const item of LAUNCH_CHECKLIST_ITEMS) {
    const status = entries[item.key]?.status
    if (status === 'done') done += 1
    else if (status === 'na') na += 1
  }
  const total = LAUNCH_CHECKLIST_ITEMS.length
  const pending = total - done - na
  return { done, na, pending, total, percent: total === 0 ? 100 : Math.round(((done + na) / total) * 100) }
}
