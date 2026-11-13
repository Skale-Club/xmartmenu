/**
 * Dish tags: the one place that says how a tag looks and which tag wins.
 *
 * Rule (docs/product/dish-tags.md): a dish has ONE tag, shown as one pill
 * everywhere (card, feed, dish sheet, admin), so it never takes much space.
 * The admin lets the owner pick one; saves keep only the most important tag
 * when more arrive (old data, API/MCP callers). Each known tag has its own
 * colour; a free-text tag the restaurant typed is neutral grey.
 *
 * To add a tag: give it a colour and a rank here, and its translations in
 * TAG_COPY (src/components/menu/menu-i18n.ts).
 */

export interface TagColor {
  /** Pill background. */
  background: string
  /** Pill text, dark enough to read on `background`. */
  text: string
}

/** Known tags in priority order: highlights first, then heat, then diet. */
const KNOWN_TAGS: ReadonlyArray<{ tag: string; color: TagColor }> = [
  { tag: "Chef's special", color: { background: '#f3e8ff', text: '#7e22ce' } }, // purple
  { tag: 'Recommended', color: { background: '#e0f2fe', text: '#0369a1' } },    // sky
  { tag: 'Spicy', color: { background: '#fee2e2', text: '#b91c1c' } },          // red
  { tag: 'Vegan', color: { background: '#d1fae5', text: '#047857' } },          // emerald
  { tag: 'Vegetarian', color: { background: '#dcfce7', text: '#15803d' } },     // green
  { tag: 'Gluten-Free', color: { background: '#fef3c7', text: '#b45309' } },    // amber
]

const NEUTRAL: TagColor = { background: '#f4f4f5', text: '#52525b' } // zinc

const RANK = new Map(KNOWN_TAGS.map((t, i) => [t.tag.toLowerCase(), i]))
const COLOR = new Map(KNOWN_TAGS.map(t => [t.tag.toLowerCase(), t.color]))

/** The colour of a tag; unknown (free-text) tags are neutral. */
export function tagColor(tag: string): TagColor {
  return COLOR.get(tag.trim().toLowerCase()) ?? NEUTRAL
}

/** Inline style for a tag pill. */
export function tagStyle(tag: string): { backgroundColor: string; color: string } {
  const c = tagColor(tag)
  return { backgroundColor: c.background, color: c.text }
}

/**
 * The single tag a compact surface shows: the highest-ranked known tag, else
 * the dish's first free-text tag, else null.
 */
export function primaryTag(tags: ReadonlyArray<string> | null | undefined): string | null {
  const list = (tags ?? []).filter(t => typeof t === 'string' && t.trim())
  if (!list.length) return null
  let best: string | null = null
  let bestRank = Infinity
  for (const tag of list) {
    const rank = RANK.get(tag.trim().toLowerCase())
    if (rank !== undefined && rank < bestRank) {
      best = tag
      bestRank = rank
    }
  }
  return best ?? list[0]
}

/** Every tag of a dish, known tags first in priority order, then free-text ones as typed. */
export function sortTags(tags: ReadonlyArray<string> | null | undefined): string[] {
  const list = (tags ?? []).filter(t => typeof t === 'string' && t.trim())
  return list
    .map((tag, i) => ({ tag, i, rank: RANK.get(tag.trim().toLowerCase()) ?? KNOWN_TAGS.length }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(t => t.tag)
}

/**
 * The ONE feature pill a dish shows anywhere (owner rule 2026-11-12: one
 * feature per dish, system-wide): its tag; with no tag, a dish marked as
 * featured shows "Chef's special"; otherwise none. `is_featured` itself is a
 * placement (the featured row), never a second pill.
 */
export function dishFeature(product: { tags?: ReadonlyArray<string> | null; is_featured?: boolean | null }): string | null {
  return primaryTag(product.tags) ?? (product.is_featured ? "Chef's special" : null)
}

/** What gets saved: at most one tag, the most important of those given. */
export function normalizeTags(tags: ReadonlyArray<string> | null | undefined): string[] {
  const tag = primaryTag(tags)
  return tag ? [tag.trim()] : []
}
