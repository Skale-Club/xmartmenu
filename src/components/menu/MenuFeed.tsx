'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Play, ShoppingBag, Sparkles } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import type { Product, ProductMedia } from '@/types/database'
import { getProductImages } from './menu-utils'

interface FeedProps {
  products: Product[]
  productMediaByProductId: Record<string, ProductMedia[]>
  currency: string
  primaryColor: string
  accentColor: string
  autoplayVideos: boolean
  directOrdersEnabled: boolean
  hasCustomization: (productId: string) => boolean
  quantityFor: (productId: string) => number
  onOpen: (product: Product) => void
  onAdd: (product: Product) => void
  onIncrement: (product: Product) => void
  onDecrement: (product: Product) => void
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', product: Product, mediaType: 'image' | 'video', mediaIndex: number) => void
}

export default function MenuFeed({
  products,
  productMediaByProductId,
  currency,
  primaryColor,
  accentColor,
  autoplayVideos,
  directOrdersEnabled,
  hasCustomization,
  quantityFor,
  onOpen,
  onAdd,
  onIncrement,
  onDecrement,
  onMediaEvent,
}: FeedProps) {
  return (
    <section className="mx-auto max-w-2xl space-y-7 pb-6" aria-label="Visual menu feed">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: primaryColor }}><Sparkles className="size-3.5" /> Discover</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950">Made to tempt. Ready to order.</h2>
        </div>
        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">{products.length} dishes</span>
      </div>

      {products.map((product, index) => {
        const quantity = quantityFor(product.id)
        const customizable = hasCustomization(product.id)
        return (
          <article
            key={product.id}
            data-analytics-product-id={product.id}
            data-analytics-source="feed"
            className="group snap-start overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-[0_24px_70px_-40px_rgba(9,9,11,0.55)]"
          >
            <FeedMedia
              product={product}
              media={productMediaByProductId[product.id] ?? []}
              priority={index === 0}
              autoplay={autoplayVideos}
              onOpen={() => onOpen(product)}
              onMediaEvent={(event, mediaType, mediaIndex) => onMediaEvent(event, product, mediaType, mediaIndex)}
            />

            <div className="p-5 sm:p-7">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {product.is_featured ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-amber-800">Chef pick</span> : null}
                    {product.tags?.slice(0, 3).map(tag => <span key={tag} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-zinc-600">{tag}</span>)}
                  </div>
                  <h3 className="text-2xl font-black leading-tight tracking-tight text-zinc-950">{product.name}</h3>
                </div>
                <p className="shrink-0 text-xl font-black tracking-tight" style={{ color: accentColor }}>{formatPrice(product.price, currency)}</p>
              </div>

              {product.description ? <p className="mt-3 line-clamp-3 text-sm font-medium leading-relaxed text-zinc-500">{product.description}</p> : null}

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(product)}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-zinc-200 px-5 text-xs font-black uppercase tracking-widest text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50"
                >
                  <Eye className="size-4" /> Details
                </button>
                {directOrdersEnabled && quantity === 0 ? (
                  <button
                    type="button"
                    onClick={() => customizable ? onOpen(product) : onAdd(product)}
                    className="inline-flex min-h-12 flex-[1.25] items-center justify-center gap-2 rounded-full px-5 text-xs font-black uppercase tracking-widest text-white shadow-lg transition hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <ShoppingBag className="size-4" /> {customizable ? 'Customize' : 'Order now'}
                  </button>
                ) : null}
                {directOrdersEnabled && quantity > 0 ? (
                  <div className="flex min-h-12 flex-[1.25] items-center justify-between overflow-hidden rounded-full border border-zinc-200 bg-zinc-950 text-white">
                    <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => onDecrement(product)} className="flex h-12 w-12 items-center justify-center hover:bg-white/10"><ChevronLeft className="size-4" /></button>
                    <span className="text-sm font-black tabular-nums">{quantity} in order</span>
                    <button type="button" aria-label={`Add one ${product.name}`} onClick={() => onIncrement(product)} className="flex h-12 w-12 items-center justify-center hover:bg-white/10"><ChevronRight className="size-4" /></button>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        )
      })}
    </section>
  )
}

function FeedMedia({
  product,
  media,
  priority,
  autoplay,
  onOpen,
  onMediaEvent,
}: {
  product: Product
  media: ProductMedia[]
  priority: boolean
  autoplay: boolean
  onOpen: () => void
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', mediaType: 'image' | 'video', index: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const [nearViewport, setNearViewport] = useState(priority)
  const [active, setActive] = useState(false)
  const [mediaIndex, setMediaIndex] = useState(0)
  const orderedMedia = [...media].sort((a, b) => a.display_order - b.display_order)
  const images = getProductImages(product)
  const slides: Array<{ type: 'image' | 'video'; url: string }> = orderedMedia.length > 0
    ? orderedMedia.map(item => ({ type: item.type, url: item.url }))
    : images.map(url => ({ type: 'image' as const, url }))
  const current = slides[mediaIndex] ?? null
  const directVideo = current?.type === 'video' && /\.(mp4|webm|ogg)(?:$|\?)/i.test(current.url)
  const imageUrl = current?.type === 'image' ? current.url : null

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      if (entry.isIntersecting) setNearViewport(true)
      setActive(entry.isIntersecting && entry.intersectionRatio >= 0.65)
    }, { threshold: [0, 0.65], rootMargin: '300px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (active && autoplay && !reducedMotion) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [active, autoplay, nearViewport, mediaIndex])

  function moveMedia(direction: -1 | 1) {
    if (slides.length < 2) return
    const nextIndex = (mediaIndex + direction + slides.length) % slides.length
    const next = slides[nextIndex]
    startedRef.current = false
    completedRef.current = false
    setMediaIndex(nextIndex)
    onMediaEvent('media_swiped', next.type, nextIndex)
  }

  return (
    <div ref={containerRef} className="relative aspect-[4/5] overflow-hidden bg-zinc-950 sm:aspect-[5/4]">
      {directVideo && nearViewport ? (
        <video
          key={current.url}
          ref={videoRef}
          src={current.url}
          poster={images[0]}
          muted
          loop
          playsInline
          controls={!autoplay}
          preload="metadata"
          className="h-full w-full object-cover"
          aria-label={`${product.name} video`}
          onPlay={() => {
            if (startedRef.current) return
            startedRef.current = true
            onMediaEvent('media_started', 'video', mediaIndex)
          }}
          onTimeUpdate={event => {
            const video = event.currentTarget
            if (completedRef.current || !Number.isFinite(video.duration) || video.duration <= 0) return
            if (video.currentTime / video.duration >= 0.9) {
              completedRef.current = true
              onMediaEvent('media_completed', 'video', mediaIndex)
            }
          }}
        />
      ) : imageUrl ? (
        <Image src={imageUrl} alt={product.name} fill priority={priority} className="object-cover transition-transform duration-700 group-hover:scale-[1.025]" sizes="(max-width: 768px) 100vw, 672px" />
      ) : (
        <button type="button" onClick={onOpen} className="flex h-full w-full flex-col items-center justify-center gap-3 text-white/60">
          <span className="text-6xl">🍽️</span><span className="text-[10px] font-black uppercase tracking-[0.24em]">View dish</span>
        </button>
      )}
      {current?.type === 'video' && !directVideo ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center bg-black/15" aria-label={`Open ${product.name} video in details`}><span className="flex size-14 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur"><Play className="ml-1 size-5 fill-current" /></span></button>
      ) : null}
      {slides.length > 1 ? (
        <>
          <button type="button" onClick={() => moveMedia(-1)} aria-label={`Previous media for ${product.name}`} className="absolute left-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55"><ChevronLeft className="size-5" /></button>
          <button type="button" onClick={() => moveMedia(1)} aria-label={`Next media for ${product.name}`} className="absolute right-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55"><ChevronRight className="size-5" /></button>
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-2 backdrop-blur" aria-label={`Media ${mediaIndex + 1} of ${slides.length}`}>
            {slides.map((slide, index) => <span key={`${slide.url}-${index}`} className={`h-1.5 rounded-full transition-all ${index === mediaIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/45'}`} />)}
          </div>
        </>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/45 to-transparent" />
    </div>
  )
}
