'use client'

import Image from 'next/image'
import { m } from 'framer-motion'
import { ArrowRight, Camera, MessageCircle } from 'lucide-react'
import { PRICING_PATH } from '@/lib/marketing/pricing'

// Shared by the marketing home and /pricing. Render inside a <LazyMotion strict>.

export interface FooterData {
  copyright?: string
}

export function Nav({ appName, logoUrl, onLoginOpen, startHref }: { appName?: string | null; logoUrl?: string | null; onLoginOpen?: () => void; startHref?: string }) {
  return (
    <m.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 inset-x-0 z-50 h-16 border-b border-white/10 bg-zinc-950/50 backdrop-blur-xl flex items-center px-4 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between px-0 sm:px-8">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <Image src={logoUrl ?? '/icon.png'} alt="Logo" width={32} height={32} className="w-8 h-8 object-contain object-center" />
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-200">{appName ?? 'XmartMenu'}</span>
          </a>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href={PRICING_PATH}
            className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors px-2 py-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Pricing
          </a>
          {startHref ? (
            <a href={startHref} className="relative group overflow-hidden bg-primary text-primary-foreground px-5 py-2 rounded-full text-sm font-bold transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2">
              <span className="relative z-10">Start</span>
              <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
            </a>
          ) : (
            <button onClick={onLoginOpen} className="relative group overflow-hidden bg-primary text-primary-foreground px-5 py-2 rounded-full text-sm font-bold transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2">
              <span className="relative z-10">Start</span>
              <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
            </button>
          )}
        </div>
      </div>
    </m.nav>
  )
}

export function Footer({ data, appName, logoUrl }: { data?: FooterData | null; appName?: string | null; logoUrl?: string | null }) {
  const brandName = appName ?? 'XmartMenu'
  const copyright = data?.copyright ? `© ${data.copyright}` : '© 2026 XmartMenu. All rights reserved.'

  return (
    <footer className="border-t border-white/10 bg-zinc-950 px-4 pt-16 md:pt-32 lg:pt-16 pb-8">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          {/* Logo + tagline */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Image src={logoUrl ?? '/icon.png'} alt="Logo" width={24} height={24} className="w-6 h-6 object-contain object-center" />
              <span className="text-lg font-bold text-white">{brandName}</span>
            </div>
            <p className="text-zinc-400 text-sm whitespace-nowrap">
              Digital menu for restaurants. Modernize the way your customers order.
            </p>
            {/* Social icons */}
            <div className="flex gap-4 mt-6">
              <a
                href="#"
                aria-label="Instagram"
                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors"
              >
                <Camera className="w-5 h-5" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            </div>
          </div>
          {/* Legal links */}
          <div className="md:text-right">
            <p className="text-sm font-bold text-white uppercase tracking-wider mb-4">Links</p>
            <ul className="flex flex-col md:items-end gap-3">
              <li>
                <a href={PRICING_PATH} className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="/privacy" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-zinc-500">
            {copyright}
          </p>
        </div>
      </div>
    </footer>
  )
}
