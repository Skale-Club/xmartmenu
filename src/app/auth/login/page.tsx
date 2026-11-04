import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import IdentityEntry from '@/components/auth/IdentityEntry'
import LegacyLogin from './LegacyLogin'

export const dynamic = 'force-dynamic'
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  if (!ownedAuthSelected()) return <LegacyLogin />
  const params = await searchParams
  return <IdentityEntry continueToApp existingAccountLink={params.action === 'existing-account-link'}
    next={typeof params.from === 'string' ? params.from : '/'} customerFlow={params.flow === 'customer'} />
}
