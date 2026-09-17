import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { BlogPostList } from '@/components/blog/post-list'
import { listArchive, listPostsByTag, listTags } from '@/lib/blog/public-queries'

export const revalidate = 300

type Props = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag: slug } = await params
  const tag = (await listTags(createServiceClient(), null)).find((t) => t.slug === slug)
  if (!tag) return {}

  return {
    title: `${tag.name} | Blog Xmartmenu`,
    description: `Posts sobre ${tag.name}.`,
    alternates: { canonical: `${PLATFORM_BASE}/blog/tag/${slug}` },
  }
}

export default async function PlatformBlogTagPage({ params }: Props) {
  const { tag: slug } = await params
  const svc = createServiceClient()

  const tags = await listTags(svc, null)
  // Uma etiqueta que não existe é 404, não uma listagem vazia: senão qualquer
  // palavra escrita no URL passa a ser uma página indexável sem nada dentro.
  const tag = tags.find((t) => t.slug === slug)
  if (!tag) notFound()

  const [posts, archive] = await Promise.all([
    listPostsByTag(svc, null, slug),
    listArchive(svc, null),
  ])
  if (posts.length === 0) notFound()

  return (
    <BlogPostList
      heading={`#${tag.name}`}
      posts={posts}
      basePath="/blog"
      archive={archive}
      tags={tags}
    />
  )
}
