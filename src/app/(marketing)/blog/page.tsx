/**
 * The platform blog index (autoblog-parity XM-03).
 *
 * This is Xmartmenu's OWN marketing blog, not a per-tenant feature: it lives
 * under (marketing) beside the landing page, and `blog` is already a reserved
 * slug so no tenant can shadow it.
 *
 * Reads published posts through the service client, exactly like the landing
 * page reads platform_settings. RLS would also allow an anon read of published
 * rows, but going through the same client as the rest of this route group keeps
 * one code path.
 */
import type { Metadata } from 'next'
import Link from 'next/link'

import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Cardápio, margem, delivery e operação: o que aprendemos ajudando restaurantes a vender mais.',
  alternates: { canonical: `${PLATFORM_BASE}/blog` },
}

interface PostCard {
  slug: string
  title: string
  excerpt: string | null
  published_at: string | null
  reading_time_minutes: number | null
}

async function getPosts(): Promise<PostCard[]> {
  try {
    const service = createServiceClient()
    const { data } = await service
      .from('blog_posts')
      .select('slug, title, excerpt, published_at, reading_time_minutes')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
    return (data ?? []) as PostCard[]
  } catch {
    // An indexable page must never hard-fail on a read: an empty list still
    // renders a real page, a thrown error renders nothing a crawler can use.
    return []
  }
}

function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(value),
  )
}

export default async function BlogIndexPage() {
  const posts = await getPosts()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <header className="mb-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Blog</h1>
        <p className="mt-3 text-base text-muted-foreground">
          Cardápio, margem, delivery e operação — o que aprendemos ajudando restaurantes a vender mais.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">Nenhum post publicado ainda.</p>
      ) : (
        <ul className="space-y-10">
          {posts.map((post) => (
            <li key={post.slug}>
              <article>
                <h2 className="text-xl font-medium tracking-tight">
                  <Link href={`/blog/${post.slug}`} className="hover:underline">
                    {post.title}
                  </Link>
                </h2>
                {post.excerpt && <p className="mt-2 text-muted-foreground">{post.excerpt}</p>}
                <p className="mt-2 text-sm text-muted-foreground">
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
