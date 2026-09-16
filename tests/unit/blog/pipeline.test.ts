// tests/unit/blog/pipeline.test.ts
// Auto-blog parity XM-10 — the pure parts of the generation pipeline: the
// editorial rotation, the HTML allowlist, the retry classifier, the RSS ranker
// and the Telegram callback encoding.
//
// These are the pieces where a silent regression is expensive: a frozen pillar
// makes every post the same shape, a missing allowlist puts a <script> on a live
// page, a wrong classifier turns one provider blip into a lost day.
import { describe, it, expect } from 'vitest'

import {
  BLOG_PILLARS,
  BLOG_TITLE_STYLES,
  assignPillar,
  availablePillars,
  buildKeywordDedupSection,
  buildPillarSection,
  pickNextPillar,
  sanitizeGeneratedLinks,
  type BlogPillar,
} from '@/lib/blog/prompt'
import {
  AiEmptyResponseError,
  AiTimeoutError,
  getPlainTextLength,
  sanitizeBlogHtml,
  slugifyTitle,
} from '@/lib/blog/content-validator'
import { RETRY_DELAYS_MS, isTransientError, withAiRetry } from '@/lib/blog/ai-retry'
import { MIN_RSS_SCORE, scoreItem } from '@/lib/blog/rss'
import { buildApprovalCallbackData, parseApprovalCallbackData, resolveApprovalsChatIds } from '@/lib/blog/telegram'

const WITH_RSS = { hasRssItem: true }
const WITHOUT_RSS = { hasRssItem: false }

describe('editorial rotation', () => {
  it('prefers a pillar never used', () => {
    const a = { ...BLOG_PILLARS[0], id: 'a' } as BlogPillar
    const b = { ...BLOG_PILLARS[0], id: 'b' } as BlogPillar
    const c = { ...BLOG_PILLARS[0], id: 'c' } as BlogPillar
    expect(pickNextPillar(['a', 'c'], [a, b, c]).id).toBe('b')
  })

  it('otherwise picks the least recently used', () => {
    const a = { ...BLOG_PILLARS[0], id: 'a' } as BlogPillar
    const b = { ...BLOG_PILLARS[0], id: 'b' } as BlogPillar
    // Newest-first history: "b" ran most recently, so "a" is due.
    expect(pickNextPillar(['b', 'a'], [a, b]).id).toBe('a')
  })

  it('walks the whole catalogue before repeating', () => {
    const available = availablePillars(WITH_RSS)
    const history: string[] = []
    for (let i = 0; i < available.length; i++) history.unshift(pickNextPillar(history, available).id)
    expect(new Set(history).size).toBe(available.length)
  })

  it('still has pillars with no RSS item — that is what makes RSS optional', () => {
    const withoutRss = availablePillars(WITHOUT_RSS)
    expect(withoutRss.length).toBeGreaterThan(0)
    expect(withoutRss.some((p) => p.id === 'industry-reaction')).toBe(false)
    expect(availablePillars(WITH_RSS).some((p) => p.id === 'industry-reaction')).toBe(true)
  })

  it('is deterministic for the same history and seed', () => {
    const a = assignPillar([], WITH_RSS, 42)
    const b = assignPillar([], WITH_RSS, 42)
    expect([a.pillar.id, a.titleStyleId, a.length.id]).toEqual([b.pillar.id, b.titleStyleId, b.length.id])
  })

  it('only ever picks a title shape and length the pillar allows', () => {
    for (let seed = 0; seed < 40; seed++) {
      const a = assignPillar([], WITH_RSS, seed)
      expect(a.pillar.titleStyles).toContain(a.titleStyleId)
      expect(BLOG_TITLE_STYLES[a.titleStyleId]).toBeTruthy()
      expect(a.pillar.lengths).toContain(a.length.id)
    }
  })

  it('does not freeze a pillar onto one title shape across runs', () => {
    // The trap: the rotation cycles N pillars in a stable order, so one pillar's
    // seeds form an arithmetic sequence. Indexing by the raw seed locks it to a
    // single shape forever whenever gcd(N, shapes) > 1.
    const target = BLOG_PILLARS.find((p) => p.titleStyles.length > 1)!
    const others = BLOG_PILLARS.filter((p) => p.id !== target.id).map((p) => p.id)
    const shapes = new Set<string>()
    for (let run = 0; run < 25; run++) {
      shapes.add(assignPillar(others, WITH_RSS, 100 + run * BLOG_PILLARS.length).titleStyleId)
    }
    expect(shapes.size).toBeGreaterThan(1)
  })

  it('names the pillar, the shape and the length in the assignment section', () => {
    const section = buildPillarSection(assignPillar([], WITH_RSS, 7))
    // The section is written in pt-BR here: this blog's reader is a Brazilian
    // restaurant owner, so the prompt speaks their language too.
    expect(section).toMatch(/PAUTA DESTE POST/)
    expect(section).toMatch(/FORMATO DO TÍTULO/)
    expect(section).toMatch(/TAMANHO ALVO/)
    expect(section).toMatch(/UM POST, UM ASSUNTO/)
  })

  it('deduplicates focus keywords case-insensitively', () => {
    expect(buildKeywordDedupSection(['Cardápio', 'cardápio', ' Margem ', ''])).toMatch(/cardápio, margem/)
    expect(buildKeywordDedupSection([])).toBe('')
  })
})

describe('link sanitiser', () => {
  it('drops an invented href but keeps the words', () => {
    const clean = sanitizeGeneratedLinks('<p>Veja <a href="/inventado">isto</a> e <a href="/pricing">aquilo</a>.</p>', ['/pricing'])
    expect(clean).not.toContain('/inventado')
    expect(clean).toMatch(/Veja isto e <a href="\/pricing">aquilo<\/a>\./)
  })

  it('rebuilds an allowed anchor with href only', () => {
    expect(sanitizeGeneratedLinks('<a href="/pricing" target="_blank" onclick="x()">Planos</a>', ['/pricing']))
      .toBe('<a href="/pricing">Planos</a>')
  })

  it('strips external URLs', () => {
    expect(sanitizeGeneratedLinks('<a href="https://example.com">fonte</a>', ['/pricing'])).toBe('fonte')
  })

  it('returns empty for non-string input rather than throwing', () => {
    // The caller feeds this model output, where an optional field is often
    // missing entirely. Throwing here would cost the day's post.
    expect(sanitizeGeneratedLinks(undefined, [])).toBe('')
    expect(sanitizeGeneratedLinks(null, [])).toBe('')
  })
})

describe('HTML allowlist', () => {
  it('removes script, iframe and style entirely', () => {
    const clean = sanitizeBlogHtml('<p>Safe</p><script>alert(1)</script><iframe src="//evil"></iframe><style>b{}</style>')
    expect(clean).not.toMatch(/<script|<iframe|<style|alert\(1\)/)
    expect(clean).toContain('<p>Safe</p>')
  })

  it('keeps the editorial tags the prompt asks for', () => {
    const html = '<h2>H</h2><h3>S</h3><p><strong>b</strong> <em>i</em></p><ul><li>a</li></ul>'
    expect(sanitizeBlogHtml(html)).toBe(html)
  })

  it('drops an event handler while keeping its element', () => {
    const clean = sanitizeBlogHtml('<p onclick="steal()">text</p>')
    expect(clean).not.toContain('onclick')
    expect(clean).toContain('text')
  })

  it('forces safe rel/target on a surviving anchor', () => {
    const clean = sanitizeBlogHtml('<a href="https://example.com" target="_self" rel="dofollow">x</a>')
    expect(clean).toContain('rel="noopener noreferrer nofollow"')
    expect(clean).not.toContain('dofollow')
  })

  it('measures length on the text, so markup cannot pad a stub', () => {
    expect(getPlainTextLength(`<p>${'<strong></strong>'.repeat(200)}short</p>`)).toBe('short'.length)
  })

  it('folds accents in slugs and never ends on a hyphen', () => {
    expect(slugifyTitle('Como precificar o cardápio de delivery')).toBe('como-precificar-o-cardapio-de-delivery')
    const slug = slugifyTitle(`${'a'.repeat(78)} bbbb`)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('retry classifier', () => {
  it('treats provider blips as transient', () => {
    expect(isTransientError(new AiTimeoutError())).toBe(true)
    expect(isTransientError(new AiEmptyResponseError())).toBe(true)
    expect(isTransientError(Object.assign(new Error('bad gateway'), { status: 502 }))).toBe(true)
    expect(isTransientError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true)
  })

  it('does not retry what will not fix itself', () => {
    expect(isTransientError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false)
    expect(isTransientError(Object.assign(new Error('no credit'), { status: 402 }))).toBe(false)
    expect(isTransientError(Object.assign(new Error('rate limited'), { status: 429 }))).toBe(false)
  })

  it('fails a permanent error on the first attempt', async () => {
    let attempts = 0
    await expect(
      withAiRetry('test', async () => {
        attempts++
        throw Object.assign(new Error('unauthorized'), { status: 401 })
      }),
    ).rejects.toThrow(/unauthorized/)
    expect(attempts).toBe(1)
  })

  it('stops retrying once the call recovers', async () => {
    let attempts = 0
    const result = await withAiRetry('test', async () => {
      attempts++
      if (attempts === 1) throw new AiEmptyResponseError()
      return 'recovered'
    })
    expect(result).toBe('recovered')
    expect(attempts).toBe(2)
  })

  it('hands the caller a signal it can forward to fetch', async () => {
    let seen: AbortSignal | null = null
    await withAiRetry('test', async (signal) => {
      seen = signal
      return null
    })
    expect(seen).toBeTruthy()
  })

  it('uses the backoff schedule the contract pins', () => {
    expect([...RETRY_DELAYS_MS]).toEqual([1000, 5000, 30000])
  })
})

describe('RSS ranking', () => {
  const NOW = new Date('2026-09-16T12:00:00Z')
  const DAY = 24 * 60 * 60 * 1000
  const item = (o: Partial<{ title: string; summary: string | null; published_at: string | null }> = {}) => ({
    title: 'A post',
    summary: null,
    published_at: NOW.toISOString(),
    ...o,
  })

  it('scores zero for keywords when none are configured', () => {
    // Treating "nothing to match" as "matches everything" would make every item
    // look equally good and turn the ranking into database order.
    expect(scoreItem(item(), '', NOW)).toBe(0.4)
    expect(scoreItem(item(), null, NOW)).toBe(0.4)
  })

  it('values relevance over freshness', () => {
    const onTopicOld = item({ title: 'Precificando o cardápio de delivery', published_at: new Date(NOW.getTime() - 14 * DAY).toISOString() })
    const offTopicFresh = item({ title: 'Notícia sem relação' })
    expect(scoreItem(onTopicOld, 'cardápio, delivery', NOW)).toBeGreaterThan(scoreItem(offTopicFresh, 'cardápio, delivery', NOW))
  })

  it('decays recency to zero over fourteen days and floors there', () => {
    expect(scoreItem(item(), '', NOW)).toBe(0.4)
    expect(scoreItem(item({ published_at: new Date(NOW.getTime() - 14 * DAY).toISOString() }), '', NOW)).toBe(0)
    expect(scoreItem(item({ published_at: new Date(NOW.getTime() - 400 * DAY).toISOString() }), '', NOW)).toBe(0)
  })

  it('treats a missing date as old, and a future date as fresh', () => {
    expect(scoreItem(item({ published_at: null }), '', NOW)).toBe(0)
    expect(scoreItem(item({ published_at: new Date(NOW.getTime() + 5 * DAY).toISOString() }), '', NOW)).toBe(0.4)
  })

  it('keeps stale off-topic items below the fallback floor', () => {
    const stale = item({ title: 'Sem relação', published_at: new Date(NOW.getTime() - 10 * DAY).toISOString() })
    expect(scoreItem(stale, 'cardápio', NOW)).toBeLessThan(MIN_RSS_SCORE)
    expect(scoreItem(item({ title: 'guia de cardápio' }), 'cardápio', NOW)).toBeGreaterThanOrEqual(MIN_RSS_SCORE)
  })
})

describe('telegram approvals', () => {
  it('round-trips a callback payload inside Telegram\'s 64-byte cap', () => {
    const data = buildApprovalCallbackData('approve', '0b8d3f2a-1c4e-4f77-9a6b-2d1f3e4c5a6b')
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64)
    expect(parseApprovalCallbackData(data)).toEqual({ action: 'approve', postId: '0b8d3f2a-1c4e-4f77-9a6b-2d1f3e4c5a6b' })
  })

  it('rejects anything that is not one of our callbacks', () => {
    // The body of a webhook call is attacker-controlled, so this must not be
    // lenient about shapes it did not produce.
    expect(parseApprovalCallbackData('blog:publish:1')).toBeNull()
    expect(parseApprovalCallbackData('other:approve:1')).toBeNull()
    expect(parseApprovalCallbackData('blog:approve:')).toBeNull()
    expect(parseApprovalCallbackData('nonsense')).toBeNull()
  })

  it('falls back to the alert chats only when no approvals chats are set', () => {
    const base = {
      enabled: true,
      bot_token: 't',
      approvals_enabled: true,
      approvals_bot_token: null,
      webhook_secret: 's',
    }
    expect(resolveApprovalsChatIds({ ...base, chat_ids: ['-100a'], approvals_chat_ids: [] })).toEqual(['-100a'])
    // Dedicated chats win: the alert list must not start receiving drafts.
    expect(resolveApprovalsChatIds({ ...base, chat_ids: ['-100a'], approvals_chat_ids: ['-100b'] })).toEqual(['-100b'])
  })
})
