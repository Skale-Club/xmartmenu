/**
 * Renderer for superadmin-authored legal copy (/terms, /privacy).
 *
 * Returns React nodes, never HTML. There is no `dangerouslySetInnerHTML` on
 * this path, so authored copy cannot inject markup or script and the read path
 * needs no sanitizer dependency. Anything the grammar does not recognise is
 * emitted as plain text.
 *
 * Supported subset (enough for a legal document, deliberately no more):
 *   ## Heading            -> h2
 *   ### Heading           -> h3
 *   - item                -> ul/li
 *   1. item               -> ol/li
 *   blank-line separated  -> p
 *   **bold**              -> strong
 *   [label](url)          -> a, restricted to http/https/mailto
 *
 * Single newlines inside a paragraph are treated as soft wraps (joined with a
 * space), matching how people paste text out of a word processor.
 */
import type { ReactNode } from 'react'

export interface LegalDoc {
  title?: string
  body?: string
  updated_at?: string
}

/** Only these schemes may become an href. Blocks javascript:/data: entirely. */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i

/** Splits a line into bold / link / text tokens without consuming the rest. */
const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0

  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const start = match.index

    if (start > last) out.push(text.slice(last, start))

    if (token.startsWith('**')) {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{token.slice(2, -2)}</strong>)
    } else {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)

      // Unsafe scheme: keep the author's text visible, drop the link.
      if (SAFE_HREF.test(href)) {
        out.push(
          <a
            key={`${keyPrefix}-a${i}`}
            href={href}
            className="text-zinc-900 underline underline-offset-2 hover:text-zinc-600 transition-colors"
            {...(href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            {label}
          </a>,
        )
      } else {
        out.push(label)
      }
    }

    last = start + token.length
    i++
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Parses the Markdown subset into React nodes. */
export function renderLegalBody(body: string): ReactNode[] {
  // Normalise CRLF so blocks split identically regardless of where the copy
  // was pasted from.
  const blocks = body.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const nodes: ReactNode[] = []

  blocks.forEach((raw, bi) => {
    const block = raw.trim()
    if (!block) return

    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)

    if (block.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${bi}`} className="text-lg font-bold text-zinc-900 mt-8 mb-2">
          {renderInline(block.slice(4), `h3-${bi}`)}
        </h3>,
      )
      return
    }

    if (block.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${bi}`} className="text-xl font-bold text-zinc-900 mt-10 mb-3">
          {renderInline(block.slice(3), `h2-${bi}`)}
        </h2>,
      )
      return
    }

    if (lines.every(l => l.startsWith('- '))) {
      nodes.push(
        <ul key={`ul-${bi}`} className="list-disc pl-5 space-y-1.5 my-4 text-zinc-600">
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.slice(2), `ul-${bi}-${li}`)}</li>
          ))}
        </ul>,
      )
      return
    }

    if (lines.every(l => /^\d+\.\s/.test(l))) {
      nodes.push(
        <ol key={`ol-${bi}`} className="list-decimal pl-5 space-y-1.5 my-4 text-zinc-600">
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.replace(/^\d+\.\s/, ''), `ol-${bi}-${li}`)}</li>
          ))}
        </ol>,
      )
      return
    }

    nodes.push(
      <p key={`p-${bi}`} className="text-base text-zinc-600 leading-relaxed my-4">
        {renderInline(lines.join(' '), `p-${bi}`)}
      </p>,
    )
  })

  return nodes
}

/** Reads one document out of the `legal` jsonb blob, tolerating any shape. */
export function pickLegalDoc(legal: unknown, key: 'terms' | 'privacy'): LegalDoc | null {
  if (!legal || typeof legal !== 'object') return null
  const doc = (legal as Record<string, unknown>)[key]
  if (!doc || typeof doc !== 'object') return null

  const { title, body, updated_at } = doc as Record<string, unknown>
  const text = typeof body === 'string' ? body.trim() : ''
  if (!text) return null

  return {
    title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
    body: text,
    updated_at: typeof updated_at === 'string' && updated_at.trim() ? updated_at.trim() : undefined,
  }
}
