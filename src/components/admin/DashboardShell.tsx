'use client'

import { ReactNode, useEffect, useState } from 'react'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'

export default function DashboardShell({
  children,
  sidebar,
  appName,
  contextName,
  logoUrl,
  eyebrow,
  backgroundClassName = 'bg-zinc-100',
}: {
  children: ReactNode
  sidebar: ReactNode
  appName: string
  contextName: string
  logoUrl?: string | null
  eyebrow?: string
  backgroundClassName?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  return (
    <div className={`min-h-dvh ${backgroundClassName} lg:flex lg:h-dvh lg:overflow-hidden`}>
      <header className="fixed inset-x-0 top-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 border-b border-zinc-200/80 bg-white/95 px-3 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex size-11 flex-shrink-0 items-center justify-center rounded-xl text-zinc-700 transition-[background-color,scale] duration-150 active:scale-96 hover:bg-zinc-100"
        >
          <Menu className="size-5" />
        </button>
        <Image
          src={logoUrl ?? '/icon.png'}
          alt=""
          width={32}
          height={32}
          className="size-8 rounded-lg object-contain outline outline-1 -outline-offset-1 outline-black/10"
        />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">{eyebrow ?? appName}</p>
          <p className="truncate text-sm font-black text-zinc-900">{contextName}</p>
        </div>
      </header>

      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-zinc-950/55 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      <div
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false)
        }}
        className={`fixed inset-y-0 left-0 z-50 w-[min(20rem,calc(100vw-3rem))] transform shadow-2xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:flex-shrink-0 lg:translate-x-0 lg:shadow-none ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-xl bg-white/10 text-white transition-[background-color,scale] duration-150 active:scale-96 hover:bg-white/15 lg:hidden"
        >
          <X className="size-5" />
        </button>
        {sidebar}
      </div>

      <main data-dashboard-content className={`dashboard-content min-w-0 flex-1 overflow-x-hidden pt-[calc(4rem+env(safe-area-inset-top))] lg:overflow-y-auto lg:pt-0 ${backgroundClassName}`}>
        {children}
      </main>
    </div>
  )
}
