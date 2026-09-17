import { createServiceClient } from '@/lib/supabase/server'
import { buildFeedXml } from '@/lib/blog/feed'
import { listPublishedPosts } from '@/lib/blog/public-queries'
import { resolveTenantBlog } from '@/lib/blog/tenant-blog-gate'

/** O feed do blog de UM restaurante. */
export const revalidate = 3600

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xmartmenu.com').replace(/\/+$/, '')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params

  // O mesmo portão das páginas: existe, está ativo, e o plano carrega a
  // capacidade. Um feed não pode ser a porta das traseiras de uma
  // funcionalidade paga.
  const blog = await resolveTenantBlog(slug)
  if (!blog) return new Response('Not found', { status: 404 })

  const posts = await listPublishedPosts(createServiceClient(), blog.tenantId, 50)

  return new Response(
    buildFeedXml({
      title: `Blog | ${blog.name}`,
      description: `Novidades e histórias do ${blog.name}.`,
      blogUrl: `${siteUrl()}/${slug}/blog`,
      posts,
    }),
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
  )
}
