import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import IdentityEntry from '@/components/auth/IdentityEntry'
import LegacyLogin from './LegacyLogin'
import { guestBrandFor } from '@/lib/auth/guest-brand'

export const dynamic = 'force-dynamic'
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  if (!ownedAuthSelected()) return <LegacyLogin />
  const params = await searchParams
  // embed=1: shown inside a popup (the menu's guest sign-in, or the marketing site's sign-in).
  const embedded = params.embed === '1'
  // Inside a restaurant's menu: its banner, logo, colour, country and language (public menu facts only).
  const brand = embedded && params.flow === 'customer' ? await guestBrandFor(params.tenant, params.lang) : null
  return <IdentityEntry continueToApp existingAccountLink={params.action === 'existing-account-link'}
    next={typeof params.from === 'string' ? params.from : '/'} customerFlow={params.flow === 'customer'}
    embedded={embedded} brand={brand} />
}
