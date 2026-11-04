import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import OnboardingForm from './OnboardingForm'

export const dynamic = 'force-dynamic'
export default function OnboardingPage() {
  return <OnboardingForm owned={ownedAuthSelected()} />
}
