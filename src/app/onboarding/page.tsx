import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { selfServiceOnboardingEnabled, teamWhatsAppNumber } from '@/lib/access-requests/switch'
import AccessRequestFlow from '@/components/access-request/AccessRequestFlow'
import OnboardingForm from './OnboardingForm'

export const dynamic = 'force-dynamic'
export default function OnboardingPage() {
  if (selfServiceOnboardingEnabled()) return <OnboardingForm owned={ownedAuthSelected()} />
  return <AccessRequestFlow teamWhatsApp={teamWhatsAppNumber()} />
}
