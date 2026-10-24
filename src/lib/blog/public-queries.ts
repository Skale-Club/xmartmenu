// =============================================================================
// src/lib/blog/public-queries.ts
//
// As leituras públicas do blog — índice, etiqueta, arquivo por ano e por mês —
// para OS DOIS blogs: o da plataforma (escopo null) e o de cada restaurante.
//
// Uma camada só, parametrizada pelo escopo, e não duas quase iguais: é assim
// que uma delas acaba por esquecer o `status = 'published'` ou o filtro de
// escopo, e a que esquecesse serviria o artigo de um cliente no site de outro.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'

import { scopeFilter, type BlogScope } from '@/lib/blog/scope'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, any, any>

const SUMMARY_FIELDS =
  'slug, title, excerpt, published_at, reading_time_minutes, cover_image_url, tags'

export interface PublicPostCard {
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  reading_time_minutes: number | null
  cover_image_url: string | null
  tags: string | null
}

export interface ArchiveEntry {
  year: number
  month: number
  count: number
}

/** `tags` é texto separado por vírgulas. Divide e apara. */
export function parseTags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** `Massa Fresca` → `massa-fresca`, para o URL. */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Os posts publicados de um escopo, mais recentes primeiro. */
export async function listPublishedPosts(
  svc: ServiceClient,
  scope: BlogScope,
  limit = 50,
): Promise<PublicPostCard[]> {
  // A ordem importa e não é estilo: `from()` devolve um builder SEM métodos de
  // filtro — `.is`, `.eq` e companhia só existem depois do `.select()`. Passar
  // o `from()` cru ao scopeFilter dá um `e.is is not a function` em runtime, e
  // nenhum typecheck o apanha porque os tipos do PostgREST são permissivos.
  const { data } = await scopeFilter(svc.from('blog_posts').select(SUMMARY_FIELDS), scope)
    .eq('status', 'published')
    // Publicado com data futura é um post AGENDADO. O estado sozinho não chega.
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as PublicPostCard[]
}

/**
 * Todas as etiquetas em uso, com contagem.
 *
 * Lidas dos posts e não de uma tabela própria porque é assim que estão
 * guardadas: uma tabela nova seria um schema a mudar numa base de dados de
 * produção para uma página de listagem.
 */
export async function listTags(
  svc: ServiceClient,
  scope: BlogScope,
): Promise<Array<{ slug: string; name: string; count: number }>> {
  const { data } = await scopeFilter(svc.from('blog_posts').select('tags'), scope)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())

  const counts = new Map<string, { name: string; count: number }>()
  for (const row of (data ?? []) as Array<{ tags: string | null }>) {
    for (const tag of parseTags(row.tags)) {
      const slug = tagSlug(tag)
      if (!slug) continue
      const entry = counts.get(slug) ?? { name: tag, count: 0 }
      entry.count += 1
      counts.set(slug, entry)
    }
  }

  return Array.from(counts.entries())
    .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Os posts de uma etiqueta.
 *
 * A correspondência é EXATA, sobre a lista dividida, em memória. Um
 * `ilike '%pizza%'` no servidor seria mais barato e estaria errado: devolveria
 * "pizzaria" para a etiqueta "pizza" — uma listagem que promete uma coisa e
 * mostra outra.
 */
export async function listPostsByTag(
  svc: ServiceClient,
  scope: BlogScope,
  slug: string,
): Promise<PublicPostCard[]> {
  const posts = await listPublishedPosts(svc, scope, 500)
  return posts.filter((post) => parseTags(post.tags).some((tag) => tagSlug(tag) === slug))
}

/**
 * Quantos posts publicados por ano e por mês.
 *
 * É o que deixa um arquivo vazio dar 404 em vez de renderizar uma página vazia:
 * os anos e os meses são combinatórios, e sem esta lista cada número escrito no
 * URL viraria uma página indexável sem nada dentro.
 *
 * Agrupa em UTC — um post de dia 1 às 00:30 cairia no mês anterior numa máquina
 * a oeste de Greenwich, e a máquina muda.
 */
export async function listArchive(
  svc: ServiceClient,
  scope: BlogScope,
): Promise<ArchiveEntry[]> {
  const { data } = await scopeFilter(svc.from('blog_posts').select('published_at'), scope)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString())

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ published_at: string | null }>) {
    if (!row.published_at) continue
    const date = new Date(row.published_at)
    if (!Number.isFinite(date.getTime())) continue
    counts.set(
      `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`,
      (counts.get(`${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`) ?? 0) + 1,
    )
  }

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const [year, month] = key.split('-').map(Number)
      return { year, month, count }
    })
    .sort((a, b) => b.year - a.year || b.month - a.month)
}

/**
 * Os posts de um ano, ou de um mês desse ano.
 *
 * O limite superior é o fim do período OU AGORA, o que vier primeiro. Sem isso,
 * um post agendado apareceria no arquivo do mês corrente enquanto a contagem
 * acima, que tem a guarda, dizia outro número — duas respostas para a mesma
 * pergunta.
 */
export async function listPostsByMonth(
  svc: ServiceClient,
  scope: BlogScope,
  year: number,
  month?: number,
): Promise<PublicPostCard[]> {
  const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1))
  const periodEnd = month
    ? new Date(Date.UTC(year, month, 1))
    : new Date(Date.UTC(year + 1, 0, 1))
  const now = new Date()
  const to = periodEnd.getTime() < now.getTime() ? periodEnd : now

  const { data } = await scopeFilter(svc.from('blog_posts').select(SUMMARY_FIELDS), scope)
    .eq('status', 'published')
    .gte('published_at', from.toISOString())
    .lt('published_at', to.toISOString())
    .order('published_at', { ascending: false })

  return (data ?? []) as PublicPostCard[]
}
