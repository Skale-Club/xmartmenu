/**
 * O XML de um feed RSS, para os dois blogs.
 *
 * Uma função parametrizada pela base e pelos posts, e não duas: o formato é o
 * mesmo, e duas cópias seriam dois sítios onde o escape ou o guid divergem.
 */
import type { PublicPostCard } from '@/lib/blog/public-queries'

const MAX_ITEMS = 50

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildFeedXml(args: {
  title: string
  description: string
  /** Base ABSOLUTA do blog, ex. `https://xmartmenu.com/blog`. */
  blogUrl: string
  posts: PublicPostCard[]
}): string {
  const base = args.blogUrl.replace(/\/+$/, '')

  const items = args.posts
    .slice(0, MAX_ITEMS)
    .map((post) => {
      const url = `${base}/${post.slug}`
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        // isPermaLink: o URL é estável e é o identificador. Um guid sintético
        // mudaria a cada reconstrução e reapresentaria posts antigos como novos
        // em todos os leitores.
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        post.published_at
          ? `      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`
          : '',
        post.excerpt ? `      <description>${escapeXml(post.excerpt)}</description>` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(args.title)}</title>`,
    `    <link>${escapeXml(base)}</link>`,
    `    <description>${escapeXml(args.description)}</description>`,
    `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    items,
    '  </channel>',
    '</rss>',
  ].join('\n')
}
