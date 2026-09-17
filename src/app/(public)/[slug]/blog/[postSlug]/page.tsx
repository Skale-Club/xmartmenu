export const revalidate = 300

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'

interface Props {
  params: Promise<{ slug: string; postSlug: string }>
}

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

/**
 * One post on a restaurant's blog (autoblog-parity XM-11).
 *
 * `content` is rendered with dangerouslySetInnerHTML, and that is safe for a
 * specific reason: every path that writes this column runs it through
 * sanitizeBlogHtml first — the generator, the from-preview save, and the admin
 * editor all share that allowlist. Sanitising on WRITE rather than on read is
 * what keeps a stored post from having to be re-sanitised by every renderer,
 * and it is the only reason this line is acceptable.
 */
async function loadPost(
  slug: string,
  postSlug: string,
): Promise<{ tenantName: string; post: PostRow } | null> {
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
    .select(
      'slug, title, content, excerpt, meta_description, author_name, published_at, reading_time_minutes, cover_image_url',
    )
    .eq('tenant_id', tenant.id)
    .eq('slug', postSlug)
    .eq('status', 'published')
    .maybeSingle()

  return data ? { tenantName: tenant.name, post: data as PostRow } : null
}

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xmartmenu.com').replace(/\/+$/, '')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, postSlug } = await params
  const found = await loadPost(slug, postSlug)
  if (!found) return { title: 'Post não encontrado' }

  const { post, tenantName } = found
  const canonical = `${siteOrigin()}/${slug}/blog/${post.slug}`
  return {
    title: `${post.title} · ${tenantName}`,
    description: post.meta_description ?? post.excerpt ?? undefined,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.meta_description ?? post.excerpt ?? undefined,
      publishedTime: post.published_at ?? undefined,
      url: canonical,
      // Um link compartilhado sem imagem rende um card cinza em toda rede
      // social. A URL precisa ser ABSOLUTA: o crawler não tem a origem do site.
      ...(post.cover_image_url
        ? {
            images: [
              post.cover_image_url.startsWith('http')
                ? post.cover_image_url
                : `${siteOrigin()}${post.cover_image_url}`,
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

export default async function TenantBlogPost({ params }: Props) {
  const { slug, postSlug } = await params
  const found = await loadPost(slug, postSlug)
  if (!found) notFound()

  const { post, tenantName } = found
  const canonical = `${siteOrigin()}/${slug}/blog/${post.slug}`

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="mb-6 flex gap-3 text-sm text-zinc-500">
        <Link href={`/${slug}`} className="hover:underline">
          Cardápio
        </Link>
        <span>·</span>
        <Link href={`/${slug}/blog`} className="hover:underline">
          Blog
        </Link>
      </p>

      {/* BlogPosting JSON-LD. O motivo do recurso existir é busca, então a
          marcação estruturada não é enfeite — é o que faz o post aparecer com
          data e autor no resultado. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.meta_description ?? post.excerpt ?? undefined,
            datePublished: post.published_at ?? undefined,
            author: { '@type': 'Organization', name: post.author_name ?? tenantName },
            publisher: { '@type': 'Organization', name: tenantName },
            mainEntityOfPage: canonical,
            ...(post.cover_image_url ? { image: post.cover_image_url } : {}),
          }),
        }}
      />

      <article>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
        <p className="mt-3 text-sm text-zinc-500">
          {formatDate(post.published_at)}
          {post.reading_time_minutes ? ` · ${post.reading_time_minutes} min de leitura` : ''}
        </p>

        {/* Alt vazio de propósito: é uma imagem decorativa, e o <h1> logo acima
            já diz do que o post trata. */}
        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            className="mt-8 aspect-video w-full rounded-xl object-cover"
          />
        )}

        <div
          className="prose prose-zinc mt-10 max-w-none"
          // Sanitizado na ESCRITA — ver o comentário no topo deste arquivo.
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>
    </main>
  )
}
