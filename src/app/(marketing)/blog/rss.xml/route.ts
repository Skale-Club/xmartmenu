import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { buildFeedXml } from '@/lib/blog/feed'
import { listPublishedPosts } from '@/lib/blog/public-queries'

/** O feed do blog da PLATAFORMA. */
export const revalidate = 3600

export async function GET(): Promise<Response> {
  const posts = await listPublishedPosts(createServiceClient(), null, 50)

  return new Response(
    buildFeedXml({
      title: 'Blog | Xmartmenu',
      description:
        'Cardápio, margem, delivery e operação — o que aprendemos ajudando restaurantes a vender mais.',
      blogUrl: `${PLATFORM_BASE}/blog`,
      posts,
    }),
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
  )
}
