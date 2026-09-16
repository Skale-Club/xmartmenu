// =============================================================================
// src/lib/blog/rss.ts
//
// SOURCE OF TRUTH: skaleclub/server/blog/rss-fetcher.ts and rss-selector.ts —
// sync changes back. Ported here as part of the auto-blog parity work
// (autoblog-parity XM-05, MASTER §5), with the Drizzle storage layer replaced by
// the Supabase service client this repo uses.
//
// RSS is an OPTIONAL topic source (MASTER D-02). With it off, or with nothing
// pending worth using, the editorial pillar rotation runs on its own and needs
// no input at all — a stale feed can never stop the blog publishing.
// =============================================================================
import { createHash } from 'node:crypto'
import Parser from 'rss-parser'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_ITEMS_PER_SOURCE = 20
const MAX_SUMMARY_CHARS = 1000
const MAX_TITLE_CHARS = 1000
const MAX_ERROR_MESSAGE_CHARS = 500
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'Xmartmenu RSS Fetcher/1.0'

const parser = new Parser({
  headers: { 'User-Agent': USER_AGENT },
  timeout: FETCH_TIMEOUT_MS,
})

type ParsedItem = Parser.Item & {
  // rss-parser does not type these but emits them on many feeds.
  id?: string
  summary?: string
}

export interface RssSourceRow {
  id: string
  name: string
  url: string
  enabled: boolean
  last_fetched_at: string | null
}

export interface RssItemRow {
  id: string
  source_id: string
  guid: string
  url: string
  title: string
  summary: string | null
  published_at: string | null
  status: string
}

export interface FetchSummary {
  sourcesProcessed: number
  itemsUpserted: number
  errors: Array<{ sourceId: string; sourceName: string; message: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, any, any>

/**
 * Fetch every enabled source. Never throws: a per-source failure is isolated,
 * recorded on the source row, and the sweep continues.
 *
 * Sources are processed sequentially, never in parallel: twenty feeds would
 * otherwise open twenty sockets and twenty writes at once for no benefit — this
 * runs on a schedule, not on a request path.
 */
export async function fetchAllRssSources(svc: ServiceClient): Promise<FetchSummary> {
  const summary: FetchSummary = { sourcesProcessed: 0, itemsUpserted: 0, errors: [] }

  const { data: sources } = await svc
    .from('blog_rss_sources')
    .select('id, name, url, enabled, last_fetched_at')
    .eq('enabled', true)

  for (const source of (sources ?? []) as RssSourceRow[]) {
    try {
      const upserted = await processSource(svc, source)
      summary.itemsUpserted += upserted

      await svc
        .from('blog_rss_sources')
        .update({
          last_fetched_at: new Date().toISOString(),
          last_fetched_status: 'ok',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', source.id)
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_MESSAGE_CHARS)

      // Recording the failure must not itself take the sweep down. A feed is
      // RECORDED as failing, never auto-disabled: a publisher's hour of downtime
      // must not silently unsubscribe us.
      await svc
        .from('blog_rss_sources')
        .update({
          last_fetched_at: new Date().toISOString(),
          last_fetched_status: 'error',
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', source.id)
        .then(undefined, () => undefined)

      summary.errors.push({ sourceId: source.id, sourceName: source.name, message })
    } finally {
      summary.sourcesProcessed += 1
    }
  }

  return summary
}

async function processSource(svc: ServiceClient, source: RssSourceRow): Promise<number> {
  const feed = await parser.parseURL(source.url)
  const items = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SOURCE)
  const lastFetchedAt = source.last_fetched_at ? new Date(source.last_fetched_at) : null

  let upserted = 0

  for (const raw of items) {
    const item = raw as ParsedItem
    const publishedAt = parsePublishedAt(item)

    // Older than our last successful sweep means a prior run already saw it.
    if (publishedAt && lastFetchedAt && publishedAt < lastFetchedAt) continue

    const url = item.link && isHttpUrl(item.link) ? item.link : null
    // An item with no usable link is skipped rather than stored in a shape the
    // rest of the pipeline cannot honour.
    if (!url) continue

    const summary = stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? '').slice(
      0,
      MAX_SUMMARY_CHARS,
    )

    // ignoreDuplicates, NOT merge: once an item is 'used' or 'skipped', a later
    // sweep of the same feed must not resurrect it as 'pending'. The
    // (source_id, guid) unique index is the whole de-duplication strategy, which
    // is also why this fetcher needs no lock of its own.
    const { error } = await svc.from('blog_rss_items').upsert(
      {
        source_id: source.id,
        guid: resolveGuid(item, source.id),
        url,
        title: (item.title ?? '(untitled)').slice(0, MAX_TITLE_CHARS),
        summary: summary.length > 0 ? summary : null,
        published_at: publishedAt?.toISOString() ?? null,
        status: 'pending',
      },
      { onConflict: 'source_id,guid', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
    upserted += 1
  }

  return upserted
}

/**
 * Always returns a non-empty string:
 *   1. <guid> / Atom <id> (rss-parser unifies both into item.guid)
 *   2. the link URL
 *   3. SHA-256(sourceId|title|pubDate) — deterministic, so the same item
 *      synthesizes the same id every run and the unique index still works.
 */
function resolveGuid(item: ParsedItem, sourceId: string): string {
  const guidCandidate = (item.guid ?? item.id ?? '').trim()
  if (guidCandidate) return guidCandidate

  const linkCandidate = (item.link ?? '').trim()
  if (linkCandidate) return linkCandidate

  const seed = `${sourceId}|${item.title ?? ''}|${item.pubDate ?? item.isoDate ?? ''}`
  return createHash('sha256').update(seed).digest('hex')
}

function parsePublishedAt(item: ParsedItem): Date | null {
  for (const value of [item.isoDate, item.pubDate]) {
    if (!value) continue
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

/**
 * Strip tags and decode the handful of entities RSS feeds actually use. The
 * result is prompt input, not rendered HTML, so a full entity library would be
 * weight for no gain.
 */
function stripHtml(input: string | null | undefined): string {
  if (!input) return ''

  let text = input.replace(/<[^>]*>/g, ' ')

  const entityMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  }
  for (const [entity, literal] of Object.entries(entityMap)) {
    text = text.split(entity).join(literal)
  }

  text = text.replace(/&#(\d+);/g, (_, code: string) => {
    const num = Number(code)
    return Number.isFinite(num) ? String.fromCodePoint(num) : ''
  })

  return text.replace(/\s+/g, ' ').trim()
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

// ─── Selection ───────────────────────────────────────────────────────────────

/** Items older than this contribute nothing to recency. */
const RECENCY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Keyword overlap outweighs recency 60/40: a two-week-old article about menu pricing
 * is a better post than today's article about something the reader does not do.
 */
const KEYWORD_WEIGHT = 0.6
const RECENCY_WEIGHT = 0.4

const PENDING_BATCH_SIZE = 50

/**
 * Below this, an item is not worth displacing the editorial pillar rotation. A
 * feed that has drifted off-topic should leave the blog on its own plan rather
 * than drag it along, which is exactly what picking the least bad of fifty
 * irrelevant items would do.
 */
export const MIN_RSS_SCORE = 0.25

function parseSeoKeywords(seoKeywords: string | null | undefined): string[] {
  return (seoKeywords ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
}

/** Pure ranker: 0.6 * keyword overlap + 0.4 * recency. */
export function scoreItem(
  item: Pick<RssItemRow, 'title' | 'summary' | 'published_at'>,
  seoKeywords: string | null | undefined,
  now: Date = new Date(),
): number {
  const keywords = parseSeoKeywords(seoKeywords)

  // An empty keyword list scores 0, not 1: no configuration is no signal, not a
  // perfect match — otherwise every item looks equally good and the ranking
  // becomes whatever order the database returned.
  let keywordScore = 0
  if (keywords.length > 0) {
    const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase()
    keywordScore = Math.min(keywords.filter((k) => haystack.includes(k)).length / keywords.length, 1)
  }

  // 1 - clamp(age / 14 days, 0, 1). Today ≈ 1, two weeks old = 0, a future date
  // clamps to 1, and a missing date scores 0 (treated as old, no signal).
  let recencyScore = 0
  if (item.published_at) {
    const ageMs = now.getTime() - new Date(item.published_at).getTime()
    recencyScore = 1 - Math.max(0, Math.min(ageMs / RECENCY_WINDOW_MS, 1))
  }

  return KEYWORD_WEIGHT * keywordScore + RECENCY_WEIGHT * recencyScore
}

export interface RssSelection {
  item: RssItemRow
  score: number
}

/**
 * Pick the item the generator should use, or null to fall back to the pillar
 * rotation. Candidates arrive newest-first and the comparison is a strict `>`,
 * so a score tie keeps the more recent item without a second sort key.
 *
 * No side effects. Marking the item used belongs to the generator, AFTER the
 * post insert succeeds, so a failed run leaves it pending for the next one.
 */
export async function selectNextRssItem(
  svc: ServiceClient,
  seoKeywords: string | null | undefined,
  now: Date = new Date(),
): Promise<RssSelection | null> {
  const { data } = await svc
    .from('blog_rss_items')
    .select('id, source_id, guid, url, title, summary, published_at, status')
    .eq('status', 'pending')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(PENDING_BATCH_SIZE)

  const candidates = (data ?? []) as RssItemRow[]
  if (candidates.length === 0) return null

  let best: RssItemRow | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const score = scoreItem(candidate, seoKeywords, now)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  if (!best || bestScore < MIN_RSS_SCORE) return null
  return { item: best, score: bestScore }
}
