import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { identityRuntimeConfig } from '@/lib/auth/identity-runtime-config'
import { verifyPublicProject } from '@/lib/auth/public-project-proof'
import IdentityPilot from '@/app/identity/IdentityPilot'

export default async function IdentityEntry(props: { continueToApp?: boolean; existingAccountLink?: boolean; next?: string; customerFlow?: boolean; linkCurrentAccount?: boolean; staffAccess?: { kind:'invite'|'recovery';code:string } }) {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') notFound()
  let config: ReturnType<typeof identityRuntimeConfig>
  try { config = identityRuntimeConfig() }
  catch { return <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-white"><p>Sign-in is temporarily unavailable. Please try again later.</p></main> }
  if ((await headers()).get('host')?.toLowerCase() !== new URL(config.origin).host.toLowerCase()) notFound()
  try { await verifyPublicProject({ ...config.web, projectNumber: config.projectNumber, origin: config.origin }) }
  catch { return <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-white"><p>Sign-in is temporarily unavailable. Please try again later.</p></main> }
  return <IdentityPilot key={props.existingAccountLink ? 'existing' : props.linkCurrentAccount ? 'link' : 'login'} config={config.web} {...props} />
}
