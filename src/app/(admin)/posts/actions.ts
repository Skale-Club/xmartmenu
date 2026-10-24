'use server'
/**
 * Blog do restaurante — ações do admin do tenant (autoblog-parity XM-14).
 *
 * TODA ação passa por `requireBlogTenant()`, que faz três coisas em ordem:
 * resolve o tenant da sessão, confere que o plano dele carrega a capacidade
 * `blog`, e devolve o escopo. É ele que impede o caso que importa — um
 * restaurante mexendo no blog de outro — porque o escopo NUNCA vem do corpo da
 * requisição, sempre da sessão.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantPlan } from '@/lib/tenant-plan'
import { createServiceClient } from '@/lib/supabase/server'
import { encryptApiKey, decryptApiKey } from '@/lib/crypto'
import { randomBytes } from 'node:crypto'
import { generateBlogPost } from '@/lib/blog/generator'
import { fetchAllRssSources } from '@/lib/blog/rss'
import { nextScheduledRun } from '@/lib/blog/schedule'
import { scopeColumn, scopeFilter } from '@/lib/blog/scope'
import { parseTelegramTarget } from '@/lib/blog/contract'
import {
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  setTelegramWebhook,
  webhookUrl,
} from '@/lib/blog/telegram'
import { sanitizeBlogHtml } from '@/lib/blog/content-validator'

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? Record<string, never> : { data: T }))
  | { ok: false; message: string }

const MASKED = '********'

interface BlogTenant {
  tenantId: string
  slug: string
  name: string
}

/**
 * Revalida as páginas DESTE restaurante.
 *
 * Era `revalidatePath('/blog')`, que é o blog da PLATAFORMA. O dono aprovava um
 * post, via "ok", e não encontrava nada no site dele até o cache expirar
 * sozinho — enquanto a página do blog da Xmartmenu era revalidada sem razão
 * nenhuma. O caminho tem de levar o slug porque é isso que o URL público tem.
 */
function revalidateTenantBlog(slug: string): void {
  revalidatePath('/posts')
  revalidatePath(`/${slug}/blog`)
  revalidatePath(`/${slug}/blog/[postSlug]`, 'page')
}

/**
 * O tenant da sessão, se ele pode usar o blog.
 *
 * O escopo vem daqui e de mais lugar nenhum. Aceitar um tenantId do cliente
 * seria entregar o blog de qualquer restaurante a quem soubesse editar uma
 * requisição.
 */
async function requireBlogTenant(): Promise<BlogTenant | { error: string }> {
  const effective = await getEffectiveTenant()
  if (!effective) return { error: 'Sessão sem restaurante.' }

  const plan = await getTenantPlan(effective.tenantId).catch(() => null)
  if (!plan?.features.includes('blog')) {
    return { error: 'O blog não está incluído no seu plano.' }
  }
  return { tenantId: effective.tenantId, slug: effective.slug, name: effective.name }
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  postsPerDay: z.number().int().min(0).max(4),
  postingHour: z.number().int().min(0).max(23).nullable(),
  timezone: z.string().min(1).max(100),
  seoKeywords: z.string().max(2000),
  promptStyle: z.string().max(4000),
  systemPrompt: z.string().max(8000),
  enableTrendAnalysis: z.boolean(),
  rssEnabled: z.boolean(),
  autoPublish: z.boolean(),
  textModel: z.string().max(200),
  imageModel: z.string().max(200),
  /** O sentinela mascarado (ou omitido) preserva a chave guardada. */
  openrouterApiKey: z.string().max(400).optional(),
})

export type TenantBlogSettingsInput = z.infer<typeof settingsSchema>

/**
 * O que o painel sabe do Telegram deste restaurante.
 *
 * Os tokens NUNCA saem do servidor — só a indicação de que estão configurados.
 * O mesmo desenho do console da plataforma, e pela mesma razão: um token que
 * chega ao browser fica no histórico do RSC, no devtools e em qualquer captura
 * de ecrã que o dono faça a pedir ajuda.
 */
export interface TenantTelegramState {
  enabled: boolean
  approvalsEnabled: boolean
  hasBotToken: boolean
  hasApprovalsBotToken: boolean
  chatIds: string[]
  approvalsChatIds: string[]
}

export interface TenantBlogState {
  settings: Record<string, unknown> | null
  telegram: TenantTelegramState
  hasOpenrouterKey: boolean
  nextScheduledRunAt: string | null
  publicPath: string
  drafts: Array<Record<string, unknown>>
  published: Array<Record<string, unknown>>
  jobs: Array<Record<string, unknown>>
  sources: Array<Record<string, unknown>>
  pendingItems: number
}

export async function loadTenantBlogState(): Promise<ActionResult<TenantBlogState>> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const svc = createServiceClient()
  const scope = ctx.tenantId

  const [settingsRes, telegramRes, draftsRes, publishedRes, jobsRes, sourcesRes, pendingRes] =
    await Promise.all([
    scopeFilter(svc.from('blog_settings').select('*'), scope).maybeSingle(),
    scopeFilter(svc.from('telegram_settings').select('*'), scope).maybeSingle(),
    scopeFilter(
      svc.from('blog_posts').select('id, title, excerpt, created_at'),
      scope,
    )
      .eq('status', 'draft')
      .eq('ai_generated', true)
      .order('created_at', { ascending: false })
      .limit(50),
    scopeFilter(
      svc.from('blog_posts').select('id, title, slug, published_at'),
      scope,
    )
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20),
    scopeFilter(
      svc
        .from('blog_generation_jobs')
        .select('id, status, source, pillar_id, topic, error_message, durations_ms, created_at'),
      scope,
    )
      .order('created_at', { ascending: false })
      .limit(20),
    scopeFilter(
      svc
        .from('blog_rss_sources')
        .select('id, name, url, enabled, last_fetched_at, last_fetched_status, error_message'),
      scope,
    ).order('created_at', { ascending: true }),
    scopeFilter(svc.from('blog_rss_items').select('id', { count: 'exact', head: true }), scope).eq(
      'status',
      'pending',
    ),
  ])

  const settingsRow = settingsRes.data as (Record<string, unknown> & {
    openrouter_api_key: string | null
    posting_hour: number | null
    posts_per_day: number
    timezone: string
  }) | null

  // Destruturada para fora, não filtrada: o ciphertext da chave não pode chegar
  // ao payload RSC, e renomear a coluna tem que quebrar ESTA linha.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { openrouter_api_key: _omitted, ...safeSettings } = settingsRow ?? { openrouter_api_key: null }

  return {
    ok: true,
    data: {
      settings: settingsRow ? (safeSettings as Record<string, unknown>) : null,
      hasOpenrouterKey: Boolean(settingsRow?.openrouter_api_key),
      // Calculado pelo MESMO helper que o portão do cron usa, então a hora que
      // a tela promete é a hora em que o job dispara.
      nextScheduledRunAt: settingsRow
        ? (nextScheduledRun({
            now: new Date(),
            timeZone: settingsRow.timezone || 'America/Sao_Paulo',
            postingHour: settingsRow.posting_hour,
            postsPerDay: settingsRow.posts_per_day,
          })?.toISOString() ?? null)
        : null,
      telegram: describeTelegram(telegramRes.data as Record<string, unknown> | null),
      publicPath: `/${ctx.slug}/blog`,
      drafts: (draftsRes.data ?? []) as Array<Record<string, unknown>>,
      published: (publishedRes.data ?? []) as Array<Record<string, unknown>>,
      jobs: (jobsRes.data ?? []) as Array<Record<string, unknown>>,
      sources: (sourcesRes.data ?? []) as Array<Record<string, unknown>>,
      pendingItems: pendingRes.count ?? 0,
    },
  }
}

export async function saveTenantBlogSettings(input: TenantBlogSettingsInput): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }

  const svc = createServiceClient()
  const scope = ctx.tenantId
  const { data: existing } = await scopeFilter(
    svc.from('blog_settings').select('id, openrouter_api_key'),
    scope,
  ).maybeSingle()
  const prev = existing as { id: string; openrouter_api_key: string | null } | null

  const incoming = parsed.data.openrouterApiKey?.trim()
  const apiKey =
    !incoming || incoming === MASKED
      ? (prev?.openrouter_api_key ?? null)
      : // Criptografada em repouso, como toda credencial deste repo.
        encryptApiKey(incoming)

  const row = {
    ...scopeColumn(scope),
    enabled: parsed.data.enabled,
    posts_per_day: parsed.data.postsPerDay,
    posting_hour: parsed.data.postingHour,
    timezone: parsed.data.timezone,
    seo_keywords: parsed.data.seoKeywords,
    prompt_style: parsed.data.promptStyle,
    system_prompt: parsed.data.systemPrompt,
    enable_trend_analysis: parsed.data.enableTrendAnalysis,
    rss_enabled: parsed.data.rssEnabled,
    auto_publish: parsed.data.autoPublish,
    text_model: parsed.data.textModel,
    image_model: parsed.data.imageModel,
    openrouter_api_key: apiKey,
    updated_at: new Date().toISOString(),
  }

  // Update quando a linha existe, insert quando não: um upsert por tenant_id
  // não funcionaria, porque o índice único é PARCIAL (WHERE tenant_id IS NOT
  // NULL) e o ON CONFLICT do PostgREST não o alcança.
  const { error } = prev
    ? await svc.from('blog_settings').update(row).eq('id', prev.id)
    : await svc.from('blog_settings').insert(row)
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

export async function generateTenantPostNow(): Promise<ActionResult<{ status: string }>> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const result = await generateBlogPost({ trigger: 'manual', scope: ctx.tenantId })
  if (result.status === 'failed') return { ok: false, message: result.error }

  revalidateTenantBlog(ctx.slug)
  return { ok: true, data: { status: result.status } }
}

const decisionSchema = z.object({ postId: z.string().uuid(), reason: z.string().max(1000).optional() })

export async function approveTenantDraft(postId: string): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }
  if (!decisionSchema.shape.postId.safeParse(postId).success) {
    return { ok: false, message: 'Post inválido' }
  }

  const svc = createServiceClient()
  // O filtro de escopo é o que impede aprovar o rascunho de outro restaurante:
  // um postId adivinhado não resolve fora do próprio tenant.
  const { data } = await scopeFilter(
    svc.from('blog_posts').select('id, title, excerpt, status'),
    ctx.tenantId,
  )
    .eq('id', postId)
    .maybeSingle()
  const post = data as { id: string; title: string; excerpt: string | null; status: string } | null
  if (!post) return { ok: false, message: 'Post não encontrado' }
  // Já publicado é um segundo clique, ou duas pessoas decidindo ao mesmo tempo.
  // Idempotente, não erro.
  if (post.status === 'published') return { ok: true } as ActionResult

  const now = new Date().toISOString()
  const { error } = await svc
    .from('blog_posts')
    .update({ status: 'published', published_at: now, updated_at: now })
    .eq('id', post.id)
  if (error) return { ok: false, message: error.message }

  await svc
    .from('blog_post_feedback')
    .insert({
      ...scopeColumn(ctx.tenantId),
      post_id: post.id,
      post_title: post.title,
      post_excerpt: post.excerpt,
      verdict: 'approved',
      decided_by: 'admin',
    })
    .then(undefined, () => undefined)

  revalidateTenantBlog(ctx.slug)
  revalidatePath(`/${ctx.slug}/blog`)
  return { ok: true } as ActionResult
}

export async function rejectTenantDraft(postId: string, reason?: string): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const svc = createServiceClient()
  const { data } = await scopeFilter(
    svc.from('blog_posts').select('id, title, excerpt'),
    ctx.tenantId,
  )
    .eq('id', postId)
    .maybeSingle()
  const post = data as { id: string; title: string; excerpt: string | null } | null
  if (!post) return { ok: false, message: 'Post não encontrado' }

  // Feedback ANTES da exclusão: a linha guarda título e resumo, então o sinal
  // sobrevive ao post. Na ordem inversa, uma falha entre as duas perde a lição.
  await svc
    .from('blog_post_feedback')
    .insert({
      ...scopeColumn(ctx.tenantId),
      post_id: post.id,
      post_title: post.title,
      post_excerpt: post.excerpt,
      verdict: 'rejected',
      reason: reason?.trim() || null,
      decided_by: 'admin',
    })
    .then(undefined, () => undefined)

  const { error } = await svc.from('blog_posts').delete().eq('id', post.id)
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

const rssSchema = z.object({ name: z.string().min(1).max(200), url: z.string().url().max(2000) })

export async function addTenantRssSource(input: z.infer<typeof rssSchema>): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }
  const parsed = rssSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

  const svc = createServiceClient()
  const { error } = await svc.from('blog_rss_sources').insert({
    ...scopeColumn(ctx.tenantId),
    name: parsed.data.name,
    url: parsed.data.url,
    enabled: true,
  })
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

/** Pausa sem perder o feed — apagar e recadastrar descarta tudo que já entrou. */
export async function toggleTenantRssSource(id: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const svc = createServiceClient()
  const { error } = await scopeFilter(
    svc.from('blog_rss_sources').update({ enabled, updated_at: new Date().toISOString() }),
    ctx.tenantId,
  ).eq('id', id)
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

export async function deleteTenantRssSource(id: string): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const svc = createServiceClient()
  const { error } = await scopeFilter(svc.from('blog_rss_sources').delete(), ctx.tenantId).eq('id', id)
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

export async function fetchTenantRssNow(): Promise<
  ActionResult<{ sources: number; upserted: number; errors: string[] }>
> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const summary = await fetchAllRssSources(createServiceClient(), ctx.tenantId)
  revalidateTenantBlog(ctx.slug)
  return {
    ok: true,
    data: {
      sources: summary.sourcesProcessed,
      upserted: summary.itemsUpserted,
      errors: summary.errors.map((e) => `${e.sourceName}: ${e.message}`),
    },
  }
}

const editSchema = z.object({
  postId: z.string().uuid(),
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  excerpt: z.string().max(1000).optional(),
})

/** Editar um rascunho antes de aprovar. O HTML é re-sanitizado: veio de um
 *  browser, então é entrada de usuário comum na volta. */
export async function updateTenantDraft(input: z.infer<typeof editSchema>): Promise<ActionResult> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }
  const parsed = editSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

  const svc = createServiceClient()
  const { error } = await scopeFilter(
    svc.from('blog_posts').update({
      title: parsed.data.title,
      content: sanitizeBlogHtml(parsed.data.content),
      excerpt: parsed.data.excerpt || null,
      updated_at: new Date().toISOString(),
    }),
    ctx.tenantId,
  ).eq('id', parsed.data.postId)
  if (error) return { ok: false, message: error.message }

  revalidateTenantBlog(ctx.slug)
  return { ok: true } as ActionResult
}

/** Só para validar chat ids no formulário de Telegram do tenant. */
export async function validateTelegramChatIds(ids: string[]): Promise<ActionResult<{ invalid: string[] }>> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }
  return { ok: true, data: { invalid: ids.filter((id) => id.trim() && !parseTelegramTarget(id.trim())) } }
}


// ─── Telegram (autoblog-parity XM-16) ────────────────────────────────────────
//
// O restaurante recebe o rascunho no Telegram e decide ali: Aprovar publica no
// site dele, Rejeitar apaga e guarda o motivo. É o mesmo circuito da plataforma,
// com a diferença que importa — o registo do webhook acontece AQUI, ao gravar,
// porque ninguém vai pedir ao dono de uma pizzaria que faça um pedido à API do
// Telegram com curl.

/** Só o que o browser pode saber: tem token ou não, e para onde vão os cartões. */
function describeTelegram(row: Record<string, unknown> | null): TenantTelegramState {
  return {
    enabled: Boolean(row?.enabled),
    approvalsEnabled: Boolean(row?.approvals_enabled),
    hasBotToken: Boolean(row?.bot_token),
    hasApprovalsBotToken: Boolean(row?.approvals_bot_token),
    chatIds: (row?.chat_ids as string[] | null) ?? [],
    approvalsChatIds: (row?.approvals_chat_ids as string[] | null) ?? [],
  }
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xmartmenu.com').replace(/\/+$/, '')
}

const telegramSchema = z.object({
  enabled: z.boolean(),
  approvalsEnabled: z.boolean(),
  // A sentinela mantém o token guardado; vazio apaga-o.
  botToken: z.string().max(400).optional(),
  approvalsBotToken: z.string().max(400).optional(),
  chatIds: z.array(z.string().max(120)).max(20),
  approvalsChatIds: z.array(z.string().max(120)).max(20),
})
export type TenantTelegramInput = z.infer<typeof telegramSchema>

export async function saveTenantTelegramSettings(
  input: TenantTelegramInput,
): Promise<ActionResult<{ webhook: string | null }>> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const parsed = telegramSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }

  // Validar os destinos ANTES de gravar. Um id mal escrito guardado é uma
  // notificação que nunca chega e que não se explica a ninguém: o envio conta
  // como "entregue a 0 destinos" e o dono fica à espera de um cartão.
  const allIds = [...parsed.data.chatIds, ...parsed.data.approvalsChatIds]
    .map((id) => id.trim())
    .filter(Boolean)
  const invalid = allIds.filter((id) => !parseTelegramTarget(id))
  if (invalid.length > 0) {
    return { ok: false, message: `Chat inválido: ${invalid.join(', ')}` }
  }

  const svc = createServiceClient()
  const { data: existing } = await scopeFilter(
    svc.from('telegram_settings').select('id, bot_token, approvals_bot_token, webhook_secret'),
    ctx.tenantId,
  ).maybeSingle()
  const prev = existing as {
    id: string
    bot_token: string | null
    approvals_bot_token: string | null
    webhook_secret: string | null
  } | null

  const row: Record<string, unknown> = {
    ...scopeColumn(ctx.tenantId),
    enabled: parsed.data.enabled,
    approvals_enabled: parsed.data.approvalsEnabled,
    chat_ids: parsed.data.chatIds.map((id) => id.trim()).filter(Boolean),
    approvals_chat_ids: parsed.data.approvalsChatIds.map((id) => id.trim()).filter(Boolean),
    updated_at: new Date().toISOString(),
  }

  for (const [field, column, previous] of [
    ['botToken', 'bot_token', prev?.bot_token],
    ['approvalsBotToken', 'approvals_bot_token', prev?.approvals_bot_token],
  ] as const) {
    const incoming = parsed.data[field]?.trim()
    if (incoming === undefined || incoming === MASKED) row[column] = previous ?? null
    else row[column] = incoming ? encryptApiKey(incoming) : null
  }

  // O segredo roda sempre que as aprovações são (re)ligadas, e é apagado quando
  // são desligadas: um segredo que sobrevive a um período desligado é
  // exatamente o que não se quer guardar.
  let secret = prev?.webhook_secret ?? null
  if (parsed.data.approvalsEnabled && !secret) secret = randomBytes(32).toString('hex')
  if (!parsed.data.approvalsEnabled) secret = null
  row.webhook_secret = secret

  // Registar o webhook ANTES de gravar. Se o Telegram recusar o token, o dono
  // recebe o motivo e a linha fica como estava — em vez de ficar guardada uma
  // configuração que parece ligada e nunca entrega nada.
  let webhookState: string | null = null
  const rawApprovalsToken = parsed.data.approvalsBotToken?.trim()
  const rawBotToken = parsed.data.botToken?.trim()
  const plainToken =
    (rawApprovalsToken && rawApprovalsToken !== MASKED ? rawApprovalsToken : null) ??
    (rawBotToken && rawBotToken !== MASKED ? rawBotToken : null) ??
    decryptOrNull(prev?.approvals_bot_token) ??
    decryptOrNull(prev?.bot_token)

  if (parsed.data.enabled && parsed.data.approvalsEnabled) {
    if (!plainToken) return { ok: false, message: 'Configure o token do bot para ativar aprovações.' }
    const registered = await setTelegramWebhook(plainToken, webhookUrl(siteUrl()), secret!)
    if (!registered.ok) {
      return { ok: false, message: `O Telegram recusou o registo: ${registered.message}` }
    }
    webhookState = webhookUrl(siteUrl())
  } else if (plainToken && prev?.webhook_secret) {
    // Desligou: o bot deixa de nos chamar. Falhar aqui não impede gravar — o
    // segredo já foi apagado, portanto o endpoint já recusa o que chegar.
    await deleteTelegramWebhook(plainToken)
  }

  const { error } = prev
    ? await svc.from('telegram_settings').update(row).eq('id', prev.id)
    : await svc.from('telegram_settings').insert(row)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/posts')
  return { ok: true, data: { webhook: webhookState } }
}

/**
 * Pergunta ao Telegram o que ele julga que o webhook é.
 *
 * Existe porque as duas pontas podem divergir sem ninguém dar por isso: um bot
 * partilhado com outra ferramenta, um setWebhook feito à mão, um domínio que
 * mudou. Sem esta leitura, "as aprovações não chegam" não tem diagnóstico.
 */
export async function checkTenantTelegramWebhook(): Promise<
  ActionResult<{ url: string | null; expected: string; lastError: string | null }>
> {
  const ctx = await requireBlogTenant()
  if ('error' in ctx) return { ok: false, message: ctx.error }

  const svc = createServiceClient()
  const { data } = await scopeFilter(
    svc.from('telegram_settings').select('bot_token, approvals_bot_token'),
    ctx.tenantId,
  ).maybeSingle()
  const row = data as { bot_token: string | null; approvals_bot_token: string | null } | null

  const token = decryptOrNull(row?.approvals_bot_token) ?? decryptOrNull(row?.bot_token)
  if (!token) return { ok: false, message: 'Nenhum bot configurado.' }

  const info = await getTelegramWebhookInfo(token)
  if (!info.ok) return { ok: false, message: info.message ?? 'Não foi possível consultar o Telegram.' }

  return {
    ok: true,
    data: {
      url: info.url || null,
      expected: webhookUrl(siteUrl()),
      lastError: info.lastErrorMessage || null,
    },
  }
}

/** Um token que não decifra é um token perdido, não uma exceção a propagar. */
function decryptOrNull(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null
  try {
    return decryptApiKey(encrypted) || null
  } catch {
    return null
  }
}
