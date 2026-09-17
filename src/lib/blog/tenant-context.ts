// =============================================================================
// src/lib/blog/tenant-context.ts
//
// O que o gerador sabe sobre um restaurante (autoblog-parity XM-11).
//
// Tudo aqui vem das PRÓPRIAS linhas do restaurante. Nada é inferido, nada tem
// valor padrão inventado: o post sai no nome do cliente, e um prato que ele não
// serve ou um bairro em que ele não fica é ele mentindo para o público dele —
// e, pior, atraindo alguém que vai chegar na porta e ir embora.
//
// Por isso toda seção devolve "" quando o dado não existe. Um prompt sem a
// seção de endereço faz o modelo não falar de localização; um prompt com a
// seção vazia faz ele preencher a lacuna.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TenantBlogContext {
  tenantId: string
  slug: string
  name: string
  businessType: string | null
  tagline: string | null
  about: string | null
  address: string | null
  /** Nomes de categoria do cardápio ativo. */
  categories: string[]
  /** Pratos reais, com descrição quando há. */
  dishes: Array<{ name: string; description: string | null; category: string | null }>
  /** Canais que o restaurante realmente oferece — o pilar "como pedir" só pode citar estes. */
  channels: { delivery: boolean; pickup: boolean; dineIn: boolean; whatsapp: boolean }
  timezone: string
}

/**
 * Lê o contexto de um restaurante.
 *
 * Cada leitura degrada sozinha: um cardápio vazio, uma categoria a menos ou um
 * settings ausente reduzem o prompt, nunca derrubam a geração. Um blog que para
 * de publicar porque uma tabela auxiliar respondeu devagar é pior do que um
 * post com menos contexto.
 */
export async function loadTenantBlogContext(
  svc: SupabaseClient,
  tenantId: string,
): Promise<TenantBlogContext | null> {
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, slug, name, is_active')
    .eq('id', tenantId)
    .maybeSingle()
  const tenant = tenantRow as { id: string; slug: string; name: string; is_active: boolean } | null
  // Um restaurante suspenso não publica: o blog dele sai do ar junto com o
  // cardápio (ver a policy de leitura em 058), então gerar seria gastar
  // dinheiro num post que ninguém veria.
  if (!tenant || !tenant.is_active) return null

  const { data: settingsRow } = await svc
    .from('tenant_settings')
    .select('address, business_type, tagline, about, whatsapp, delivery_enabled, pickup_enabled, dine_in_enabled, whatsapp_orders_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const settings = (settingsRow ?? {}) as Record<string, unknown>

  let categories: string[] = []
  try {
    const { data } = await svc
      .from('categories')
      .select('name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('position', { ascending: true })
      .limit(30)
    categories = ((data ?? []) as Array<{ name: string }>).map((c) => c.name).filter(Boolean)
  } catch {
    // Sem categorias o prompt só perde uma seção.
  }

  let dishes: TenantBlogContext['dishes'] = []
  try {
    const { data } = await svc
      .from('products')
      .select('name, description, is_available, categories(name)')
      .eq('tenant_id', tenantId)
      .eq('is_available', true)
      .limit(60)
    // PostgREST types an embedded one-to-one as an ARRAY, so the category
    // arrives either shape depending on how the relation is inferred. Normalise
    // both rather than casting one away and being wrong half the time.
    type ProductRow = {
      name: string
      description: string | null
      categories: { name: string } | Array<{ name: string }> | null
    }
    dishes = ((data ?? []) as unknown as ProductRow[])
      .filter((d) => Boolean(d.name))
      .map((d) => ({
        name: d.name,
        description: d.description,
        category: Array.isArray(d.categories) ? d.categories[0]?.name ?? null : d.categories?.name ?? null,
      }))
  } catch {
    // Idem.
  }

  return {
    tenantId,
    slug: tenant.slug,
    name: tenant.name,
    businessType: (settings.business_type as string | null) ?? null,
    tagline: (settings.tagline as string | null) ?? null,
    about: (settings.about as string | null) ?? null,
    address: (settings.address as string | null) ?? null,
    categories,
    dishes,
    channels: {
      delivery: settings.delivery_enabled === true,
      pickup: settings.pickup_enabled === true,
      dineIn: settings.dine_in_enabled !== false,
      whatsapp: settings.whatsapp_orders_enabled === true && Boolean(settings.whatsapp),
    },
    // O fuso vem das configurações do blog, não daqui; este é só o fallback
    // para o caso de a linha de blog_settings ainda não existir.
    timezone: 'America/Sao_Paulo',
  }
}

/** A identidade do restaurante. Vazio quando só há o nome — o nome sozinho já
 *  está na primeira linha do system message. */
export function buildBusinessSection(ctx: TenantBlogContext): string {
  const lines = [`NEGÓCIO: ${ctx.name}.`]
  if (ctx.businessType) lines.push(`Tipo: ${ctx.businessType}.`)
  if (ctx.tagline) lines.push(`Como se descreve: ${ctx.tagline}`)
  if (ctx.about) lines.push(`Sobre a casa: ${ctx.about}`)
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * Onde o restaurante fica.
 *
 * Vazio quando não há endereço, e nunca um "perto de você" genérico: o modelo
 * que não sabe a região tem que ficar calado sobre ela, não preencher.
 */
export function buildLocationSection(address: string | null): string {
  const value = address?.trim()
  if (!value) return ''
  return [
    'LOCALIZAÇÃO (do cadastro do próprio restaurante):',
    value,
    'Cite o bairro e a cidade onde couber naturalmente — é o que faz a busca local funcionar. NUNCA invente ponto de referência, rua ou bairro que não esteja acima.',
  ].join('\n')
}

/**
 * O cardápio.
 *
 * Esta é a seção que impede o erro mais caro do recurso: um post bonito sobre
 * um prato que a casa não serve. Quem lê vai até lá pedir.
 */
export function buildMenuSection(ctx: TenantBlogContext): string {
  if (ctx.dishes.length === 0) return ''
  const byCategory = new Map<string, string[]>()
  for (const dish of ctx.dishes.slice(0, 40)) {
    const key = dish.category ?? 'Outros'
    const label = dish.description?.trim()
      ? `${dish.name} — ${dish.description.trim().slice(0, 140)}`
      : dish.name
    byCategory.set(key, [...(byCategory.get(key) ?? []), label])
  }
  return [
    'CARDÁPIO (o que a casa REALMENTE serve hoje):',
    ...[...byCategory.entries()].map(([category, items]) => `${category}: ${items.join('; ')}`),
    'Só escreva sobre pratos desta lista. Um prato inventado leva o cliente até a porta para pedir algo que não existe.',
  ].join('\n')
}

/** Os canais que existem. O pilar "como pedir" não pode prometer um que não há. */
export function buildChannelsSection(ctx: TenantBlogContext): string {
  const available: string[] = []
  if (ctx.channels.dineIn) available.push('atendimento no salão')
  if (ctx.channels.delivery) available.push('delivery')
  if (ctx.channels.pickup) available.push('retirada no balcão')
  if (ctx.channels.whatsapp) available.push('pedido por WhatsApp')
  if (available.length === 0) return ''
  return [
    `CANAIS DISPONÍVEIS: ${available.join(', ')}.`,
    'Não prometa nenhum canal fora desta lista.',
  ].join('\n')
}
