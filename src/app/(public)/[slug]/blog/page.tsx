export const revalidate = 300

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'

interface Props {
  params: Promise<{ slug: string }>
}

interface PostCard {
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  reading_time_minutes: number | null
  cover_image_url: string | null
}

/**
 * The restaurant's own blog (autoblog-parity XM-14).
 *
 * The whole point is local SEO: a menu that can rank for "melhor pizza no
 * <bairro>" is worth more than a menu that cannot. So this page is indexable,
 * server-rendered, and linked from the menu.
 *
 * It 404s when the tenant's plan does not carry the `blog` capability — not a
 * redirect and not an empty page, because an indexable URL that exists for a
 * customer who is not paying for it is a URL Google will keep coming back to.
 */
async function loadBlog(slug: string): Promise<{ tenantId: string; name: string; posts: PostCard[] } | null> {
  const svc = createServiceClient()
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, name, is_active')
    .eq('slug', slug)
    .maybeSingle()
  const tenant = tenantRow as { id: string; name: string; is_active: boolean } | null
  if (!tenant || !tenant.is_active) return null

  const plan = await getTenantPlan(tenant.id).catch(() => null)
  if (!plan?.features.includes('blog')) return null

  const { data } = await svc
    .from('blog_posts')
    .select('slug, title, excerpt, published_at, reading_time_minutes, cover_image_url')
    .eq('tenant_id', tenant.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50)

  return { tenantId: tenant.id, name: tenant.name, posts: (data ?? []) as PostCard[] }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const blog = await loadBlog(slug)
  if (!blog) return { title: 'Blog' }
  return {
    title: `Blog · ${blog.name}`,
    description: `Novidades, pratos e dicas do ${blog.name}.`,
  }
}

function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(value),
  )
}

export default async function TenantBlogIndex({ params }: Props) {
  const { slug } = await params
  const blog = await loadBlog(slug)
  if (!blog) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-10">
        <p className="text-sm text-zinc-500">
          <Link href={`/${slug}`} className="hover:underline">
            ← Cardápio
          </Link>
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Blog</h1>
        <p className="mt-2 text-zinc-600">Novidades, pratos e dicas do {blog.name}.</p>
      </header>

      {blog.posts.length === 0 ? (
        <p className="text-zinc-500">Nenhum post publicado ainda.</p>
      ) : (
        <ul className="space-y-10">
          {blog.posts.map((post) => (
            <li key={post.slug}>
              <article>
                {/* Sem <Image> do Next: a URL vem do Supabase Storage e não está
                    no remotePatterns, então o otimizador recusaria em produção.
                    O aspect-ratio fixo é o que evita o layout shift. */}
                {post.cover_image_url && (
                  <Link href={`/${slug}/blog/${post.slug}`} className="mb-4 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.cover_image_url}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-full rounded-xl object-cover"
                    />
                  </Link>
                )}
                <h2 className="text-xl font-medium tracking-tight">
                  <Link href={`/${slug}/blog/${post.slug}`} className="hover:underline">
                    {post.title}
                  </Link>
                </h2>
                {post.excerpt && <p className="mt-2 text-zinc-600">{post.excerpt}</p>}
                <p className="mt-2 text-sm text-zinc-500">
                  {formatDate(post.published_at)}
                  {post.reading_time_minutes ? ` · ${post.reading_time_minutes} min de leitura` : ''}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
