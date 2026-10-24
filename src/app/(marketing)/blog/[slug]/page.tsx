/**
 * A published blog post (autoblog-parity XM-03).
 *
 * The body is rendered with dangerouslySetInnerHTML, which is safe ONLY because
 * of where the HTML came from: every generated post goes through the tag
 * allowlist in src/lib/blog/content-validator.ts before it is ever stored, and
 * a post that fails that check is never saved. If a future path ever writes to
 * blog_posts.content without passing it through that sanitiser, this line stops
 * being safe — sanitise on write, not here, so the rule has one home.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { scopeFilter } from '@/lib/blog/scope'

export const revalidate = 300

interface PostRow {
  slug: string
  title: string
  content: string
  excerpt: string | null
  meta_description: string | null
  author_name: string | null
  published_at: string | null
  reading_time_minutes: number | null
  cover_image_url: string | null
}

async function getPost(slug: string): Promise<PostRow | null> {
  try {
    const service = createServiceClient()
      // Escopo da PLATAFORMA. Sem este filtro, e depois de XM-14 ter dado
      // linhas próprias a cada restaurante, esta consulta listaria os posts de
      // TODOS eles no blog da Xmartmenu — e o slug é único POR ESCOPO, portanto
      // /blog/<slug> podia servir o artigo de um cliente no site da plataforma.
      const { data } = await scopeFilter(
        service
          .from('blog_posts')
          .select(
            'slug, title, content, excerpt, meta_description, author_name, published_at, reading_time_minutes, cover_image_url',
          ),
        null,
      )
        .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle()
    return (data as PostRow | null) ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Post não encontrado' }

  return {
    title: post.title,
    description: post.meta_description ?? post.excerpt ?? undefined,
    alternates: { canonical: `${PLATFORM_BASE}/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.meta_description ?? post.excerpt ?? undefined,
      publishedTime: post.published_at ?? undefined,
      // Um link compartilhado sem imagem rende um card cinza em toda rede
      // social. A URL precisa ser ABSOLUTA: o crawler não tem a origem do site.
      ...(post.cover_image_url
        ? {
            images: [
              post.cover_image_url.startsWith('http')
                ? post.cover_image_url
                : `${PLATFORM_BASE}${post.cover_image_url}`,
            ],
          }
        : {}),
    },
  }
}

function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(value),
  )
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description ?? post.excerpt ?? undefined,
    datePublished: post.published_at ?? undefined,
    author: { '@type': 'Organization', name: post.author_name ?? 'Xmartmenu' },
    mainEntityOfPage: `${PLATFORM_BASE}/blog/${post.slug}`,
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <p className="mb-8">
        <Link href="/blog" className="text-sm text-muted-foreground hover:underline">
          ← Blog
        </Link>
      </p>

      <article>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {formatDate(post.published_at)}
          {post.reading_time_minutes ? ` · ${post.reading_time_minutes} min de leitura` : ''}
        </p>

        {/* Sem <Image> do Next: a URL vem do Supabase Storage e não está no
            remotePatterns, então o otimizador recusaria em produção. O
            aspect-ratio fixo é o que evita o layout shift. Alt vazio de
            propósito — é uma imagem decorativa, e o <h1> logo acima já diz do
            que o post trata; um alt redundante só atrapalha quem usa leitor de
            tela. */}
        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            className="mt-8 aspect-video w-full rounded-xl object-cover"
          />
        )}

        <div
          className="prose prose-neutral dark:prose-invert mt-10 max-w-none"
          // Sanitised on write — see this file's header comment.
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>
    </main>
  )
}
