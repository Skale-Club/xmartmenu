import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { BlogPostList } from '@/components/blog/post-list'
import { listArchive, listPostsByMonth, listTags } from '@/lib/blog/public-queries'

export const revalidate = 300

type Props = { params: Promise<{ year: string }> }

/**
 * Estreito de propósito: `/blog/archive/99999` e `/blog/archive/abc` são ambos
 * URLs que qualquer pessoa escreve, e um intervalo de datas inválido devolve o
 * blog inteiro sob um URL que promete um ano.
 */
function parseYear(raw: string): number | null {
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null
  return year
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const year = parseYear((await params).year)
  if (!year) return {}
  return {
    title: `Arquivo de ${year} | Blog Xmartmenu`,
    alternates: { canonical: `${PLATFORM_BASE}/blog/archive/${year}` },
  }
}

export default async function PlatformBlogYearPage({ params }: Props) {
  const year = parseYear((await params).year)
  if (!year) notFound()

  const svc = createServiceClient()
  // A contagem decide: um ano sem posts é 404, não uma página vazia.
  const archive = await listArchive(svc, null)
  if (!archive.some((entry) => entry.year === year)) notFound()

  const [posts, tags] = await Promise.all([
    listPostsByMonth(svc, null, year),
    listTags(svc, null),
  ])
  if (posts.length === 0) notFound()

  return (
    <BlogPostList
      heading={`Arquivo de ${year}`}
      posts={posts}
      basePath="/blog"
      archive={archive}
      tags={tags}
    />
  )
}
