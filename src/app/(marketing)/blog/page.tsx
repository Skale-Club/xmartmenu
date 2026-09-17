/**
 * O blog da PLATAFORMA (autoblog-parity XM-18).
 *
 * `/blog` na Xmartmenu. O de cada restaurante vive em `/<slug>/blog` e partilha
 * a mesma camada de consultas e o mesmo componente de listagem — o que muda é o
 * escopo e o `basePath`.
 */
import type { Metadata } from 'next'

import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { BlogPostList } from '@/components/blog/post-list'
import { listArchive, listPublishedPosts, listTags } from '@/lib/blog/public-queries'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Blog | Xmartmenu',
  description:
    'Cardápio, margem, delivery e operação — o que aprendemos ajudando restaurantes a vender mais.',
  alternates: { canonical: `${PLATFORM_BASE}/blog` },
}

export default async function BlogIndexPage() {
  const svc = createServiceClient()
  const [posts, archive, tags] = await Promise.all([
    listPublishedPosts(svc, null),
    listArchive(svc, null),
    listTags(svc, null),
  ])

  return (
    <BlogPostList
      heading="Blog"
      lead="Cardápio, margem, delivery e operação — o que aprendemos ajudando restaurantes a vender mais."
      posts={posts}
      basePath="/blog"
      archive={archive}
      tags={tags}
    />
  )
}
