// =============================================================================
// src/lib/blog/generator.ts
//
// Auto-blog generation for Xmartmenu's OWN marketing blog (autoblog-parity
// XM-06, XM-07). This is a PLATFORM feature, not a per-tenant one: restaurants
// do not get a blog, so nothing here carries a tenant_id and there is no
// super-admin gate to pass — the superadmin is the only one who can reach it.
//
// The AI key lives on blog_settings, encrypted at rest with the same envelope
// the per-tenant chat-addon key uses. There is no platform-wide credential in
// this repo to fall back on (MASTER D-05).
//
// Shape ported from xkedule/server/services/blog-generator.ts and
// skaleclub/server/lib/blog-generator.ts, which between them define what this
// pipeline has to do:
//
//   pillar (+ optional RSS item) -> topic -> content -> sanitise + length check
//   -> image (best effort) -> draft or publish -> job row with stage timings
//
// Two rules the ports exist to enforce, both learned the hard way elsewhere:
//   - The model's HTML is NEVER trusted. The prompt asks for a tag subset; the
//     allowlist is what enforces it.
//   - A run that cannot produce a good post FAILS rather than publishing a bad
//     one. Yesterday's post staying up beats two lines under our name.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'

import { withAiRetry } from '@/lib/blog/ai-retry'
import {
  AiEmptyResponseError,
  getPlainTextLength,
  sanitizeBlogHtml,
  slugifyTitle,
} from '@/lib/blog/content-validator'
import { isRunDue } from '@/lib/blog/schedule'
import { generateCoverImage } from '@/lib/blog/cover-image'
import {
  assignPillar,
  TENANT_BLOG_PILLARS,
  buildInternalLinksSection,
  buildKeywordDedupSection,
  buildPillarSection,
  sanitizeGeneratedLinks,
  todaySection,
  type InternalLink,
  type PillarAssignment,
} from '@/lib/blog/prompt'
import { selectNextRssItem, type RssItemRow } from '@/lib/blog/rss'
import { logAiUsage } from '@/lib/blog/ai-usage-log'
import {
  sendDraftForApproval,
  type ApprovalCardTarget,
  type TelegramSettingsRow,
} from '@/lib/blog/telegram'
import {
  MAX_PLAIN_TEXT_CHARS,
  MIN_PLAIN_TEXT_CHARS,
  STALE_LOCK_MS,
  type BlogJobSource,
  type BlogSkipReason,
  type DurationsMs,
} from '@/lib/blog/contract'
import { scopeColumn, scopeFilter, type BlogScope } from '@/lib/blog/scope'
import {
  buildBusinessSection,
  buildChannelsSection,
  buildLocationSection,
  buildMenuSection,
  loadTenantBlogContext,
  type TenantBlogContext,
} from '@/lib/blog/tenant-context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, any, any>

export interface BlogSettingsRow {
  enabled: boolean
  posts_per_day: number
  posting_hour: number | null
  timezone: string
  last_run_at: string | null
  seo_keywords: string
  prompt_style: string
  system_prompt: string
  enable_trend_analysis: boolean
  rss_enabled: boolean
  auto_publish: boolean
  text_model: string
  image_model: string
  /** Encrypted at rest; decrypted by loadBlogSettings, never returned to a client. */
  openrouter_api_key: string | null
}

export type GenerationResult =
  | { status: 'generated'; postId: string; jobId: string; title: string }
  | { status: 'skipped'; reason: BlogSkipReason }
  | { status: 'failed'; error: string; jobId?: string }

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/** House model when none is configured, matching the chat addon's default. */
const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-5'

const SITE_HEADERS = {
  'HTTP-Referer': 'https://xmartmenu.com',
  'X-Title': 'Xmartmenu',
}

const WORDS_PER_MINUTE = 200

/** The internal links a generated post may use. */
const INTERNAL_LINKS: InternalLink[] = [
  { label: 'Como funciona o Xmartmenu', path: '/#como-funciona' },
  { label: 'Planos e preços', path: '/pricing' },
  { label: 'Ver uma demonstração', path: '/demo' },
]

/**
 * The settings row, with the API key decrypted.
 *
 * A key that fails to decrypt yields null rather than throwing: that reads as
 * "not configured" and skips the run, which is the same outcome as no key at
 * all and strictly better than an exception with no context. A rotated
 * ENCRYPTION_KEY is the usual cause, and the superadmin panel says so.
 */
export async function loadBlogSettings(
  svc: ServiceClient,
  scope: BlogScope = null,
): Promise<BlogSettingsRow | null> {
  const { data } = await scopeFilter(svc.from('blog_settings').select('*'), scope).maybeSingle()
  if (!data) return null
  const row = data as BlogSettingsRow
  if (!row.openrouter_api_key) return row
  try {
    return { ...row, openrouter_api_key: decryptApiKey(row.openrouter_api_key) }
  } catch {
    return { ...row, openrouter_api_key: null }
  }
}

/**
 * Take the generation lock, if it is free or stale.
 *
 * One conditional UPDATE, so two concurrent callers cannot both win: the
 * database decides and the loser gets no row back. This has to be in the
 * database rather than in module state — Next.js runs multiple instances, and
 * the Inngest sweep and the HTTP break-glass endpoint can fire at once (XT-13).
 */
async function acquireLock(svc: ServiceClient, scope: BlogScope, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS).toISOString()
  // Scoped, so one restaurant's run never blocks another's — and never frees
  // another's lock either, which is the failure that would let two runs publish
  // into the same blog at once.
  const { data } = await scopeFilter(
    svc
      .from('blog_settings')
      .update({ lock_acquired_at: now.toISOString(), updated_at: now.toISOString() }),
    scope,
  )
    .or(`lock_acquired_at.is.null,lock_acquired_at.lt.${staleBefore}`)
    .select('id')
  return Array.isArray(data) && data.length > 0
}

async function releaseLock(svc: ServiceClient, scope: BlogScope): Promise<void> {
  await scopeFilter(
    svc
      .from('blog_settings')
      .update({ lock_acquired_at: null, updated_at: new Date().toISOString() }),
    scope,
  )
}

/** One chat call against the configured text model, retried and timed.
 *  `scope` only rides along so the cost lands on the right blog's ledger. */
async function callTextModel(
  scope: BlogScope,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
): Promise<string> {
  const startedAt = Date.now()
  try {
    const text = await withAiRetry('blog_post', async (signal) => {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...SITE_HEADERS,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          // Ask for the real upstream USD cost so the ledger is not a guess.
          usage: { include: true },
        }),
        signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => 'unknown')
        const error = new Error(`OpenRouter blog text failed (${res.status}): ${body.slice(0, 300)}`)
        // The status rides on the error because that is what the retry
        // classifier reads: a 502 is worth another attempt, a 401 never is.
        ;(error as Error & { status?: number }).status = res.status
        throw error
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
        error?: { message?: string }
      }
      if (json.error?.message) throw new Error(`OpenRouter blog text error: ${json.error.message}`)

      const content = json.choices?.[0]?.message?.content ?? ''
      // An empty completion is a provider hiccup, not a parse problem — typing
      // it is what lets the classifier retry instead of failing the run on a
      // confusing JSON error downstream.
      if (!content.trim()) throw new AiEmptyResponseError('Blog text returned an empty completion')

      void logAiUsage({
        scope,
        step: 'blog_post',
        provider: 'openrouter',
        model,
        prompt,
        inputTokens: json.usage?.prompt_tokens ?? null,
        outputTokens: json.usage?.completion_tokens ?? null,
        costUsd: json.usage?.cost ?? null,
        status: 'success',
        durationMs: Date.now() - startedAt,
      })

      return content
    })
    return text
  } catch (err) {
    void logAiUsage({
      scope,
      step: 'blog_post',
      provider: 'openrouter',
      model,
      prompt,
      status: 'failure',
      error: (err as Error).message,
      durationMs: Date.now() - startedAt,
    })
    throw err
  }
}

interface GeneratedPost {
  title: string
  content: string
  excerpt: string
  metaDescription: string
  focusKeyword: string
  tags: string
}

function parseGeneratedPost(raw: string): GeneratedPost {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    throw new Error('Blog generation returned invalid JSON')
  }

  const str = (key: string): string => (typeof parsed[key] === 'string' ? (parsed[key] as string).trim() : '')
  const title = str('title')
  const content = str('content')
  if (!title || !content) throw new Error('Blog generation returned incomplete content')

  return {
    title,
    content,
    excerpt: str('excerpt'),
    metaDescription: str('metaDescription'),
    focusKeyword: str('focusKeyword'),
    tags: str('tags'),
  }
}

/** A slug nothing else already holds. */
async function uniqueSlug(svc: ServiceClient, scope: BlogScope, title: string): Promise<string> {
  const base = slugifyTitle(title) || 'post'
  let slug = base
  let suffix = 2
  for (;;) {
    // Scoped: slugs are unique WITHIN a blog, so two restaurants may both have
    // "cardapio-de-inverno". Checking globally would append -2 for no reason.
    const { data } = await scopeFilter(svc.from('blog_posts').select('id'), scope)
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
    slug = `${base}-${suffix}`
    suffix += 1
  }
}

function readingTimeMinutes(html: string): number {
  const words = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}

/** The system message for this run: voice, date, assignment, links, dedup. */
async function buildSystemMessage(
  svc: ServiceClient,
  scope: BlogScope,
  settings: BlogSettingsRow,
  assignment: PillarAssignment,
  rssItem: RssItemRow | null,
  tenant: TenantBlogContext | null,
): Promise<{ systemMessage: string; allowedLinkPaths: string[] }> {
  const { data: recentPosts } = await scopeFilter(
    svc.from('blog_posts').select('title, slug, status, focus_keyword'),
    scope,
  )
    .order('created_at', { ascending: false })
    .limit(12)

  const posts = (recentPosts ?? []) as Array<{
    title: string
    slug: string
    status: string
    focus_keyword: string | null
  }>

  // Os links internos de um restaurante são as páginas DELE — o cardápio e os
  // posts dele. Oferecer os links da plataforma mandaria o cliente do
  // restaurante para o site de quem vende o software para ele.
  const blogBase = tenant ? `/${tenant.slug}/blog` : '/blog'
  const links: InternalLink[] = [
    ...(tenant
      ? [{ label: `Cardápio do ${tenant.name}`, path: `/${tenant.slug}` }]
      : INTERNAL_LINKS),
    ...posts
      .filter((p) => p.status === 'published' && p.slug)
      .slice(0, 4)
      .map((p) => ({ label: p.title, path: `${blogBase}/${p.slug}` })),
  ]

  const sections: string[] = [
    tenant
      ? `Você escreve o blog do ${tenant.name}${tenant.businessType ? `, ${tenant.businessType}` : ''}. Seu leitor é um CLIENTE em potencial: alguém decidindo onde comer, o que pedir ou se vale a pena ir até lá. Escreva em português brasileiro, na voz da casa ("a gente", "aqui"), como alguém que trabalha lá escreveria — não como uma agência escrevendo sobre um restaurante. Você NUNCA inventa: prato, prêmio, chef, história ou endereço que não esteja nos dados abaixo simplesmente não existe, e escrever sobre ele faz um cliente ir até a porta pedir algo que não há.`
      : 'Você escreve o blog do Xmartmenu, uma plataforma brasileira de cardápio digital e pedidos para restaurantes. Seu leitor é o DONO ou gerente do restaurante — quem monta o cardápio, negocia com fornecedor, olha a margem e aguenta o pico do sábado. Escreva em português brasileiro, para ele, e nunca troque algo útil por propaganda do produto: o Xmartmenu aparece como ferramenta quando ajuda, nunca como assunto.',
    todaySection(new Date(), settings.timezone || 'UTC'),
    buildPillarSection(assignment),
  ]

  // O aterramento do restaurante entra logo após a pauta, antes de qualquer
  // preferência editorial: é o que o modelo pode afirmar, e tem que estar no
  // prompt antes de ele começar a escolher o que dizer.
  if (tenant) {
    for (const section of [
      buildBusinessSection(tenant),
      buildLocationSection(tenant.address),
      buildMenuSection(tenant),
      buildChannelsSection(tenant),
    ]) {
      if (section) sections.push(section)
    }
  }

  if (rssItem) {
    sections.push(
      [
        'FONTE. O assunto de hoje vem deste item. Use-o como PONTO DE PARTIDA de um post original para o nosso leitor — reaja a ele, explique o que muda na operação dele, acrescente o que sabemos. NÃO resuma nem parafraseie a fonte, e não se apresente como autor dela.',
        `- Manchete: ${rssItem.title}`,
        `- Resumo: ${rssItem.summary ?? '(sem resumo)'}`,
        `- Origem: ${rssItem.url}`,
      ].join('\n'),
    )
  }

  if (settings.seo_keywords.trim()) {
    sections.push(`PALAVRAS-CHAVE DE SEO. Otimize naturalmente para: ${settings.seo_keywords.trim()}`)
  }
  if (settings.system_prompt.trim()) {
    sections.push(`GUIA EDITORIAL (siga à risca):\n${settings.system_prompt.trim()}`)
  }
  if (settings.prompt_style.trim()) {
    sections.push(`ESTILO E TOM:\n${settings.prompt_style.trim()}`)
  }

  sections.push(buildInternalLinksSection(links))

  const keywordDedup = buildKeywordDedupSection(posts.map((p) => p.focus_keyword ?? '').filter(Boolean))
  if (keywordDedup) sections.push(keywordDedup)

  if (posts.length > 0) {
    sections.push(
      `POSTS EXISTENTES. NÃO repita nem reformule estes temas:\n${posts
        .map((p) => `- "${p.title}"`)
        .join('\n')}`,
    )
  }

  // Feedback loop: the editor's past decisions steer the next post.
  const { data: feedback } = await scopeFilter(
    svc.from('blog_post_feedback').select('post_title, verdict, reason'),
    scope,
  )
    .order('created_at', { ascending: false })
    .limit(16)

  const decisions = (feedback ?? []) as Array<{ post_title: string; verdict: string; reason: string | null }>
  const approved = decisions.filter((f) => f.verdict === 'approved').slice(0, 8)
  const rejected = decisions.filter((f) => f.verdict === 'rejected').slice(0, 8)

  if (approved.length > 0) {
    sections.push(
      `APRENDA COM AS APROVAÇÕES. Estes foram aprovados; produza mais nessa direção:\n${approved
        .map((f) => `- "${f.post_title}"`)
        .join('\n')}`,
    )
  }
  if (rejected.length > 0) {
    sections.push(
      `APRENDA COM AS REJEIÇÕES. Estes foram rejeitados; evite o que levou a isso:\n${rejected
        .map((f) => `- "${f.post_title}"${f.reason ? ` (motivo: ${f.reason})` : ''}`)
        .join('\n')}`,
    )
  }

  return { systemMessage: sections.join('\n\n'), allowedLinkPaths: links.map((l) => l.path) }
}

/**
 * Generate one post.
 *
 * `trigger: 'cron'` applies the cadence gates; 'manual' bypasses them, so a
 * failure at 09:00 is fixable at 09:05 rather than tomorrow. The lock applies to
 * both — that is what stops two callers producing two posts for one slot.
 */
export async function generateBlogPost(opts: {
  trigger: 'cron' | 'manual'
  /** Which blog to write. Defaults to the platform's own (autoblog-parity XM-14). */
  scope?: BlogScope
  svc?: ServiceClient
  now?: Date
}): Promise<GenerationResult> {
  const svc = opts.svc ?? createServiceClient()
  const now = opts.now ?? new Date()
  const scope = opts.scope ?? null

  const settings = await loadBlogSettings(svc, scope)
  if (!settings) return { status: 'skipped', reason: 'no_settings' }

  // A restaurant's context is read once, up front: the pillar catalogue, the
  // grounding sections and the public URLs all depend on it, and a tenant that
  // has gone inactive must not generate at all (its blog is already off the
  // air — see the read policy in migration 058).
  const tenantContext = scope === null ? null : await loadTenantBlogContext(svc, scope)
  if (scope !== null && !tenantContext) return { status: 'skipped', reason: 'tenant_unavailable' }

  // An unconfigured model is a blank to fill in, not a reason to refuse: fall
  // back to the house model. A missing KEY is still a hard stop — there is no
  // platform credential in this repo to fall back on.
  const textModel = settings.text_model || DEFAULT_TEXT_MODEL

  if (opts.trigger === 'cron') {
    if (!settings.enabled) return { status: 'skipped', reason: 'disabled' }
    if (settings.posts_per_day <= 0) return { status: 'skipped', reason: 'posts_per_day_zero' }

    if (settings.posting_hour !== null && settings.posting_hour !== undefined) {
      // A pinned hour beats the elapsed-time cadence: the old rule only said
      // "at least N hours since the last run", so the time of day drifted
      // forward with every run and nothing could promise a publishing time.
      const decision = isRunDue({
        now,
        timeZone: settings.timezone || 'UTC',
        postingHour: settings.posting_hour,
        postsPerDay: settings.posts_per_day,
        lastRunAt: settings.last_run_at ? new Date(settings.last_run_at) : null,
      })
      if (!decision.due) return { status: 'skipped', reason: 'outside_posting_hour' }
    } else if (settings.last_run_at) {
      const hoursSince = (now.getTime() - new Date(settings.last_run_at).getTime()) / 36e5
      if (hoursSince < 24 / settings.posts_per_day) return { status: 'skipped', reason: 'too_soon' }
    }
  }

  const apiKey = settings.openrouter_api_key
  if (!apiKey) return { status: 'skipped', reason: 'not_configured' }

  if (!(await acquireLock(svc, scope, now))) return { status: 'skipped', reason: 'locked' }

  const timings: Partial<DurationsMs> = {}
  const runStartedAt = Date.now()
  let jobId: string | undefined

  try {
    // RSS is optional (MASTER D-02): a selection supplies the subject, the
    // pillar still decides the treatment, and nothing pending means the pillar
    // rotation runs on its own.
    let rssItem: RssItemRow | null = null
    if (settings.rss_enabled) {
      try {
        rssItem = (await selectNextRssItem(svc, settings.seo_keywords, now, scope))?.item ?? null
      } catch {
        // A missing table or a transient read must never cost the day's post.
      }
    }

    const { data: recentJobs } = await scopeFilter(
      svc.from('blog_generation_jobs').select('pillar_id'),
      scope,
    )
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(12)

    const recentPillarIds = ((recentJobs ?? []) as Array<{ pillar_id: string | null }>)
      .map((j) => j.pillar_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    const source: BlogJobSource = rssItem ? 'rss' : 'pillar'

    const { data: jobRow, error: jobError } = await svc
      .from('blog_generation_jobs')
      .insert({
        ...scopeColumn(scope),
        status: 'running',
        trigger: opts.trigger,
        source,
        rss_item_id: rssItem?.id ?? null,
        model: textModel,
        started_at: now.toISOString(),
      })
      .select('id')
      .single()
    if (jobError) throw new Error(jobError.message)
    jobId = (jobRow as { id: string }).id

    // The rotation seed varies per run but is stable for a given job, so a test
    // with a fixed id is deterministic.
    // Two audiences, two catalogues. The platform writes for restaurant OWNERS
    // it is selling to; a restaurant writes for DINERS, and "engenharia de
    // cardápio" is a subject no diner has ever searched for.
    const assignment = assignPillar(
      recentPillarIds,
      {
        hasRssItem: !!rssItem,
        hasMenu: (tenantContext?.dishes.length ?? 0) > 0,
        hasAddress: Boolean(tenantContext?.address?.trim()),
      },
      hashSeed(jobId),
      tenantContext ? TENANT_BLOG_PILLARS : undefined,
    )
    await svc.from('blog_generation_jobs').update({ pillar_id: assignment.pillar.id }).eq('id', jobId)

    // The cadence clock advances on ATTEMPT, not on success: a persistently
    // failing configuration retries at its posts-per-day rate instead of
    // burning the AI budget every time the sweep runs.
    if (opts.trigger === 'cron') {
      await scopeFilter(
        svc
          .from('blog_settings')
          .update({ last_run_at: now.toISOString(), updated_at: now.toISOString() }),
        scope,
      )
    }

    const { systemMessage, allowedLinkPaths } = await buildSystemMessage(
      svc,
      scope,
      settings,
      assignment,
      rssItem,
      tenantContext,
    )

    const topicStartedAt = Date.now()
    const topic = (
      await callTextModel(
        scope,
        apiKey,
        textModel,
        systemMessage,
        rssItem
          ? 'Transforme a FONTE em UMA ideia de pauta, no formato que a PAUTA DESTE POST determina. A pauta tem que ser sobre o que a fonte significa para o nosso leitor, não um recontar dela. Devolva APENAS a pauta, nada mais.'
          : 'Proponha UMA ideia de pauta que cumpra a PAUTA DESTE POST: seu pilar, seu formato de título, um único assunto. Devolva APENAS a pauta, nada mais.',
      )
    ).trim()
    timings.topic = Date.now() - topicStartedAt

    const contentStartedAt = Date.now()
    const raw = await callTextModel(
      scope,
      apiKey,
      textModel,
      systemMessage,
      [
        `Escreva o post sobre "${topic}", cumprindo a PAUTA DESTE POST (pilar, formato do título, tamanho alvo).`,
        settings.enable_trend_analysis
          ? 'Onde for natural, ancore o texto na estação ou no calendário implicados pelo HOJE É acima.'
          : '',
        'Devolva JSON estritamente válido com exatamente estes campos, todos em português:',
        '{"title":"","content":"","excerpt":"","metaDescription":"","focusKeyword":"","tags":""}',
        'content é HTML pronto para publicação usando SOMENTE <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>. Sem <h1>, sem <html>/<body>, sem imagens, sem scripts.',
        'tags é uma lista separada por vírgulas com 3 a 5 tags. metaDescription tem menos de 160 caracteres.',
        'Não envolva o JSON em bloco de código markdown.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    timings.content = Date.now() - contentStartedAt

    const generated = parseGeneratedPost(raw)

    // Link sanitising runs first because it needs the anchors intact; the
    // allowlist then drops every tag outside the editorial set. The prompt only
    // ASKS for that set — this is what enforces it.
    generated.content = sanitizeGeneratedLinks(generated.content, allowedLinkPaths)
    generated.content = sanitizeBlogHtml(generated.content)

    // Length is measured AFTER stripping tags, so markup cannot pad a stub into
    // looking like an article.
    const plainTextLength = getPlainTextLength(generated.content)
    if (plainTextLength < MIN_PLAIN_TEXT_CHARS || plainTextLength > MAX_PLAIN_TEXT_CHARS) {
      throw new Error(
        `content_length_out_of_bounds: ${plainTextLength} plain-text chars, expected ${MIN_PLAIN_TEXT_CHARS}-${MAX_PLAIN_TEXT_CHARS}`,
      )
    }

    const slug = await uniqueSlug(svc, scope, generated.title)
    const publish = settings.auto_publish

    // Autoblog-parity XM-05. Best-effort por construção: um post sem capa é um
    // post pior, mas uma geração que MORREU porque o modelo de imagem estava
    // ocupado é uma publicação perdida, o que é pior. generateCoverImage nunca
    // lança — null só significa sem capa desta vez.
    //
    // As etapas de imagem e upload não são separadas aqui porque são uma
    // chamada só: reportar uma fronteira inventada entre elas seria pior do que
    // reportar o total honesto em `image`.
    const coverStartedAt = Date.now()
    const cover = await generateCoverImage({
      // Escopo na CHAVE do storage: as capas de um restaurante ficam sob a
      // pasta dele, não misturadas com as da plataforma.
      scope,
      apiKey: settings.openrouter_api_key,
      model: settings.image_model,
      title: generated.title,
      focusKeyword: generated.focusKeyword || null,
      slug,
    })
    // null quando a etapa foi PULADA (sem modelo configurado) — que não é o
    // mesmo que uma imagem que levou 0ms, e o contrato distingue os dois.
    timings.image = settings.image_model?.trim() ? Date.now() - coverStartedAt : null
    timings.upload = 0

    const { data: postRow, error: postError } = await svc
      .from('blog_posts')
      .insert({
        ...scopeColumn(scope),
        title: generated.title,
        slug,
        content: generated.content,
        excerpt: generated.excerpt || null,
        meta_description: generated.metaDescription || null,
        focus_keyword: generated.focusKeyword || null,
        tags: generated.tags || null,
        // The byline is the business the post belongs to, not the platform:
        // a restaurant's post signed "Xmartmenu" reads as someone else's page.
        author_name: tenantContext?.name ?? 'Xmartmenu',
        cover_image_url: cover?.url ?? null,
        reading_time_minutes: readingTimeMinutes(generated.content),
        ai_generated: true,
        status: publish ? 'published' : 'draft',
        published_at: publish ? now.toISOString() : null,
      })
      .select('id')
      .single()
    if (postError) throw new Error(postError.message)
    const postId = (postRow as { id: string }).id

    // Only AFTER the insert succeeds. Marking earlier would burn the item on a
    // run that then failed, and the subject would never be covered.
    if (rssItem) {
      await scopeFilter(
        svc
          .from('blog_rss_items')
          .update({ status: 'used', used_at: now.toISOString(), used_post_id: postId }),
        scope,
      )
        .eq('id', rssItem.id)
        .then(undefined, () => undefined)
    }

    await svc
      .from('blog_generation_jobs')
      .update({
        status: 'completed',
        post_id: postId,
        topic,
        completed_at: new Date().toISOString(),
        durations_ms: { ...timings, total: Date.now() - runStartedAt },
      })
      .eq('id', jobId)

    // A draft used to land in the admin with nobody told about it. Push it to
    // the approval chats when the site opted in. Fire-and-forget: the post is
    // already saved, and a notification problem must never fail the run.
    if (!publish) {
      // O link do cartão aponta para o painel de QUEM DECIDE, não para a página
      // pública. Passava o URL público e o cartão colava-lhe "/superadmin/blog"
      // no fim, o que dava um link que não existia em lado nenhum; e para um
      // restaurante teria mandado o dono para o painel da plataforma.
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xmartmenu.com').replace(/\/+$/, '')
      void notifyDraftAwaitingApproval(
        svc,
        scope,
        {
          id: postId,
          title: generated.title,
          excerpt: generated.excerpt || null,
          pillarLabel: assignment.pillar.label,
        },
        tenantContext
          ? { panelUrl: `${siteUrl}/posts`, audience: 'tenant', label: tenantContext.name }
          : { panelUrl: `${siteUrl}/admin/blog`, audience: 'platform' },
      )
    }

    return { status: 'generated', postId, jobId, title: generated.title }
  } catch (err) {
    const message = (err as Error).message
    if (jobId) {
      await svc
        .from('blog_generation_jobs')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
          // Whatever finished before the failure: "the content call took 90s and
          // then we died" is the difference between diagnosing and guessing.
          durations_ms: { ...timings, total: Date.now() - runStartedAt },
        })
        .eq('id', jobId)
        .then(undefined, () => undefined)
    }
    return { status: 'failed', error: message, jobId }
  } finally {
    // Releasing must not throw out of the generator: the post is already saved,
    // and a stuck lock expires on its own in ten minutes.
    await releaseLock(svc, scope).then(undefined, () => undefined)
  }
}


/**
 * Push a generated draft to Telegram, if approvals are configured. Every failure
 * is swallowed: this runs after the post is saved, and the post is what matters.
 */
async function notifyDraftAwaitingApproval(
  svc: ServiceClient,
  scope: BlogScope,
  draft: { id: string; title: string; excerpt: string | null; pillarLabel: string },
  target: ApprovalCardTarget,
): Promise<void> {
  try {
    // Scoped: a restaurant's draft goes to THAT restaurant's chat, never to the
    // platform's ops group — and vice versa.
    const { data } = await scopeFilter(svc.from('telegram_settings').select('*'), scope).maybeSingle()
    if (!data) return

    // Both bot tokens are encrypted at rest here, like every other credential
    // in this repo. Decrypt at the moment of use and never anywhere else — a
    // token that will not decrypt means no notification, not a crash after the
    // post was already saved.
    const raw = data as TelegramSettingsRow
    const settings: TelegramSettingsRow = {
      ...raw,
      bot_token: raw.bot_token ? decryptApiKey(raw.bot_token) : null,
      approvals_bot_token: raw.approvals_bot_token ? decryptApiKey(raw.approvals_bot_token) : null,
    }

    const result = await sendDraftForApproval(settings, draft, target)
    if (result && result.failures.length > 0) {
      console.warn(
        `[autoblog] draft notification: ${result.delivered} delivered, failures: ` +
          result.failures.map((f) => `${f.chatId}: ${f.message}`).join('; '),
      )
    }
  } catch (err) {
    console.warn('[autoblog] draft notification failed (non-fatal):', (err as Error).message)
  }
}

/** A stable numeric seed from a uuid, for the deterministic pillar rotation. */
function hashSeed(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = (h * 33) ^ id.charCodeAt(i)
  return Math.abs(h | 0)
}
