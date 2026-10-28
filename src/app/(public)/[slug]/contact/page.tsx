export const revalidate = 60

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTenantBySlug, loadPublicMenuData } from '@/lib/menu/public-menu-data'
import { contactLinks } from '@/components/menu/showcase'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import ContactForm from '@/components/menu/ContactForm'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) return { title: 'Contact' }
  return { title: `Contact | ${tenant.name}`, robots: { index: false, follow: true } }
}

/**
 * "Get in touch": a short form that writes the guest's message to the
 * restaurant's public contact email, with the other ways to reach them beside
 * it. Exists once the restaurant has saved a contact email.
 */
export default async function ContactPage({ params }: Props) {
  const { slug } = await params
  const data = await loadPublicMenuData({ slug, tableId: null })
  if (data.kind !== 'menu') notFound()

  const { tenant } = data
  const settings = tenant.tenant_settings as Record<string, unknown> | null
  const contactEmail = typeof settings?.contact_email === 'string' ? settings.contact_email.trim() : ''
  if (!contactEmail) notFound()
  if (data.menu?.is_private === true && !data.privateAccess) notFound()

  const primaryColor = (settings?.primary_color as string | undefined) ?? '#F52323'
  const contacts = contactLinks(settings as { phone?: string | null; instagram?: string | null } | null)
  const address = typeof settings?.address === 'string' ? settings.address : null

  return (
    <>
      <style>{`:root{--primary:${safeCssColor(primaryColor)};--primary-foreground:${computePrimaryForeground(primaryColor)};}`}</style>
      <ContactForm
        tenantName={tenant.name}
        backHref={`/${slug}`}
        primaryColor={primaryColor}
        contactEmail={contactEmail}
        phone={contacts.phone}
        instagram={contacts.instagram}
        address={address}
        pickup={data.capabilities.pickup}
      />
    </>
  )
}
