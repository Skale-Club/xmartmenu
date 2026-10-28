/**
 * Public contact details shown at the end of a restaurant's menu that are not
 * stored in its settings (the settings hold the phone, Instagram and address).
 * Keyed by the restaurant's slug.
 */
const CONTACT_EMAIL_BY_SLUG: Record<string, string> = {
  'celes-confections': 'hello@celesconfections.com',
}

export function contactEmailFor(slug: string | null | undefined): string | null {
  return (slug && CONTACT_EMAIL_BY_SLUG[slug]) || null
}
