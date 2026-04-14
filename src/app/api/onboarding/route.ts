import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { slugify } from '@/lib/utils'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await request.json()
  const { name } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Nome do restaurante é obrigatório' }, { status: 400 })

  const service = await createServiceClient()

  // Gera slug único
  let slug = slugify(name)
  const { data: existing } = await service.from('tenants').select('id').eq('slug', slug).single()
  if (existing) slug = `${slug}-${Date.now().toString(36)}`

  // Cria tenant
  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({ name: name.trim(), slug, plan: 'free' })
    .select()
    .single()

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Erro ao criar restaurante' }, { status: 500 })
  }

  // Cria tenant_settings padrão
  await service.from('tenant_settings').insert({ tenant_id: tenant.id })

  // Atribui tenant e role ao perfil do usuário
  await service.from('profiles').upsert({
    id: user.id,
    tenant_id: tenant.id,
    role: 'store-admin',
    full_name: user.user_metadata?.full_name ?? null,
  })

  return NextResponse.json({ slug: tenant.slug })
}
