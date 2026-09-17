/**
 * O portão de acesso ao blog de um restaurante (autoblog-parity XM-18).
 *
 * Três verificações, nesta ordem, e todas devolvem null em vez de lançar: o
 * restaurante existe, está ativo, e o plano dele carrega a capacidade `blog`.
 *
 * Extraído para aqui porque passou a ser precisado em CINCO páginas — índice,
 * post, etiqueta e os dois arquivos — mais o feed. Copiá-lo seria seis sítios
 * onde o gate de plano pode ser esquecido, e esquecê-lo num deles é servir uma
 * funcionalidade paga a quem não a comprou.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'

export interface TenantBlogAccess {
  tenantId: string
  name: string
  slug: string
}

export async function resolveTenantBlog(slug: string): Promise<TenantBlogAccess | null> {
  const svc = createServiceClient()

  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, name, is_active')
    .eq('slug', slug)
    .maybeSingle()

  const tenant = tenantRow as { id: string; name: string; is_active: boolean } | null
  if (!tenant || !tenant.is_active) return null

  const plan = await getTenantPlan(tenant.id).catch(() => null)
  if (!plan?.features.includes('blog')) return null

  return { tenantId: tenant.id, name: tenant.name, slug }
}
