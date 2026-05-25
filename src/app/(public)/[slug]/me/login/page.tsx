import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import LoginClient from './LoginClient'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function CustomerLoginPage({ params }: Props) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug, name, tenant_settings(primary_color)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) notFound()

  const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#F52323'

  return <LoginClient slug={slug} primaryColor={primaryColor} />
}
