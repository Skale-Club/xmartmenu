import { redirect } from 'next/navigation'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function CustomerLoginPage({ params }: Props) {
  const { slug } = await params
  if (ownedAuthSelected()) redirect(`/auth/login?flow=customer&from=${encodeURIComponent(`/${slug}/me`)}`)
  redirect(`/${slug}`)
}
