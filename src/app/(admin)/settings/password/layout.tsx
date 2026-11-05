import { redirect } from 'next/navigation'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'

export const dynamic = 'force-dynamic'

// Owned login has no password to change (phone/Google only), and this page's
// client would call Supabase Auth. The page itself is untouched in legacy mode.
export default function PasswordLayout({ children }: { children: React.ReactNode }) {
  if (ownedAuthSelected()) redirect('/dashboard')
  return children
}
