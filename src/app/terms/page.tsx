import LegalPage, { getLegalDoc, legalTitle } from '@/components/legal/LegalPage'

// Matches the marketing pages: edits published from the admin panel appear
// within a minute even without the explicit revalidate on save.
export const revalidate = 60

export async function generateMetadata() {
  // Bare title on purpose: the root layout's '%s | XmartMenu' template appends
  // the brand, so adding it here too would double the suffix.
  return { title: legalTitle('terms', await getLegalDoc('terms')) }
}

export default function TermsPage() {
  return <LegalPage docKey="terms" />
}
