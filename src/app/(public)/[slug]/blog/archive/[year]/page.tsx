import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/server'
import { BlogPostList } from '@/components/blog/post-list'
import { listArchive, listPostsByMonth, listTags } from '@/lib/blog/public-queries'
import { resolveTenantBlog } from '@/lib/blog/tenant-blog-gate'

export const revalidate = 300

type Props = { params: Promise<{ slug: string; year: string }> }

function parseYear(raw: string): number | null {
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null
  return year
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, year: rawYear } = await params
  const year = parseYear(rawYear)
  if (!year) return {}
  const blog = await resolveTenantBlog(slug)
  if (!blog) return {}
  return { title: `Arquivo de ${year} | Blog ${blog.name}` }
}

export default async function TenantBlogYearPage({ params }: Props) {
  const { slug, year: rawYear } = await params
  const year = parseYear(rawYear)
  if (!year) notFound()

  const blog = await resolveTenantBlog(slug)
  if (!blog) notFound()

  const svc = createServiceClient()
  const archive = await listArchive(svc, blog.tenantId)
  if (!archive.some((entry) => entry.year === year)) notFound()

  const [posts, tags] = await Promise.all([
    listPostsByMonth(svc, blog.tenantId, year),
    listTags(svc, blog.tenantId),
  ])
  if (posts.length === 0) notFound()

  return (
    <BlogPostList
      heading={`Arquivo de ${year}`}
      posts={posts}
      basePath={`/${slug}/blog`}
      archive={archive}
      tags={tags}
    />
  )
}
