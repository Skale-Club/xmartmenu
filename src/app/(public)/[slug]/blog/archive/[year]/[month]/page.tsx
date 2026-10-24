import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/server'
import { BlogPostList, monthName } from '@/components/blog/post-list'
import { listArchive, listPostsByMonth, listTags } from '@/lib/blog/public-queries'
import { resolveTenantBlog } from '@/lib/blog/tenant-blog-gate'

export const revalidate = 300

type Props = { params: Promise<{ slug: string; year: string; month: string }> }

function parseYearMonth(rawYear: string, rawMonth: string): { year: number; month: number } | null {
  const year = Number(rawYear)
  const month = Number(rawMonth)
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, year: rawYear, month: rawMonth } = await params
  const parsed = parseYearMonth(rawYear, rawMonth)
  if (!parsed) return {}
  const blog = await resolveTenantBlog(slug)
  if (!blog) return {}
  return { title: `${monthName(parsed.month)} de ${parsed.year} | Blog ${blog.name}` }
}

export default async function TenantBlogMonthPage({ params }: Props) {
  const { slug, year: rawYear, month: rawMonth } = await params
  const parsed = parseYearMonth(rawYear, rawMonth)
  if (!parsed) notFound()

  const blog = await resolveTenantBlog(slug)
  if (!blog) notFound()

  const svc = createServiceClient()
  const archive = await listArchive(svc, blog.tenantId)
  if (!archive.some((e) => e.year === parsed.year && e.month === parsed.month)) notFound()

  const [posts, tags] = await Promise.all([
    listPostsByMonth(svc, blog.tenantId, parsed.year, parsed.month),
    listTags(svc, blog.tenantId),
  ])
  if (posts.length === 0) notFound()

  return (
    <BlogPostList
      heading={`${monthName(parsed.month)} de ${parsed.year}`}
      posts={posts}
      basePath={`/${slug}/blog`}
      archive={archive}
      tags={tags}
    />
  )
}
