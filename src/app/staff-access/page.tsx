import { notFound } from 'next/navigation'
import IdentityEntry from '@/components/auth/IdentityEntry'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { accountAdministrationSelected } from '@/lib/data/account-administration'

export const dynamic = 'force-dynamic'
export const metadata = { title:'Staff access',robots:{index:false,follow:false},referrer:'no-referrer' as const }
export default async function StaffAccessPage({ searchParams }: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if (!ownedAuthSelected() || !accountAdministrationSelected()) notFound()
  const params = await searchParams,raw = params.invite ?? params.recovery
  if (raw !== undefined && (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw))) notFound()
  if (params.invite && params.recovery) notFound()
  const principal = await getOwnedPrincipal()
  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <h1 className="text-2xl font-bold">{params.recovery ? 'Restore your staff access' : raw ? 'Accept staff invitation' : 'Your verified account'}</h1>
    {principal && <section className="rounded-xl border p-5"><p>Share this account ID with your store administrator.</p><code className="mt-3 block break-all select-all">{principal.userId}</code></section>}
    <p>{params.recovery ? 'Your earlier local sessions were revoked. Verify the phone or Google sign-in method already linked to this account to complete this exact reset. If you lost every sign-in method, request independent reviewed recovery.' : raw ? 'Verify the phone or Google sign-in method already linked to the exact invited account. The invitation grants access only to its original store.' : 'Register and verify your own account before requesting an invitation. Administrators cannot create a password or claim ownership through an email address.'}</p>
    {raw ? <IdentityEntry continueToApp staffAccess={{kind:params.recovery ? 'recovery' : 'invite',code:raw}} /> : <nav className="flex gap-5"><a href="/auth/register?from=%2Fstaff-access" className="underline">Register your own account</a><a href="/identity?from=%2Fstaff-access&flow=customer" className="underline">Sign in</a></nav>}
    {raw&&<p><a className="underline" href="/identity?from=%2Fdashboard">Already completed this access link? Sign in to your account.</a></p>}
  </main>
}
