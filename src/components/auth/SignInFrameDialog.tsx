'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import { useVisibleViewport } from '@/components/ui/use-visible-viewport'

/** Paths that are still part of signing in; leaving them means the person is signed in. */
const SIGN_IN_PATHS = ['/auth/', '/identity']
const isSignInPath = (path: string) => SIGN_IN_PATHS.some(prefix => path.startsWith(prefix))

/**
 * The platform's own sign-in (/auth/login?embed=1…) in a same-origin frame,
 * as a card over the current page, so nobody is sent to another page to sign
 * in: the guest popup on a menu (light, restaurant card) and the sign-in on
 * the marketing site (dark, platform card). The page inside draws the whole
 * card; this only holds it, sizes it to its content, keeps it in what the
 * phone keyboard leaves visible, and notices when the sign-in finished: the
 * frame then navigates off the sign-in pages, and `onSignedIn` gets that path
 * (where the sign-in wanted to go).
 */
export default function SignInFrameDialog({ src, unavailable, title, closeLabel, onClose, onSignedIn, tone = 'light', closeTop = 12 }: {
  /** Null while the sign-in mode is still being read. */
  src: string | null
  unavailable: boolean
  title: string
  closeLabel: string
  onClose: () => void
  onSignedIn: (path: string) => void
  tone?: 'light' | 'dark'
  /** Where the close button sits, to centre it on the card's own header. */
  closeTop?: number
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const view = useVisibleViewport()
  const [height, setHeight] = useState(440)
  const [ready, setReady] = useState(false)
  const dark = tone === 'dark'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!src) return
    let finished = false
    const check = () => {
      const frame = frameRef.current
      if (finished || !frame) return
      let location: Location | undefined
      try { location = frame.contentWindow?.location } catch { return }
      const path = location?.pathname ?? ''
      if (path && path !== 'blank' && !isSignInPath(path)) {
        finished = true
        const destination = `${path}${location?.search ?? ''}`
        frame.src = 'about:blank'
        onSignedIn(destination)
      }
    }
    const timer = window.setInterval(check, 200)
    return () => window.clearInterval(timer)
  }, [src, onSignedIn])

  const onLoad = () => {
    const frame = frameRef.current
    const doc = (() => { try { return frame?.contentDocument ?? null } catch { return null } })()
    if (!frame || !doc?.body) return
    setReady(true)
    // The sign-in itself, not the frame document (which can report a taller box: a blank strip).
    const content = doc.querySelector('main') ?? doc.body
    const measure = () => setHeight(Math.ceil(content.getBoundingClientRect().height))
    measure()
    new ResizeObserver(measure).observe(content)
  }

  return (
    <ModalPortal closeOnEscape={false}>
      <div className="fixed inset-0 z-50" onClick={onClose}>
        <div className={`absolute inset-0 backdrop-blur-sm ${dark ? 'bg-black/70' : 'bg-black/60'}`} />
        <div
          className="absolute inset-x-0 flex items-center justify-center p-4"
          style={view.height ? { top: view.top, height: view.height } : { inset: 0 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative w-full max-w-[400px] overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${dark ? 'border border-white/10 bg-zinc-950' : 'bg-white'}`}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              style={{ top: closeTop }}
              className={`absolute right-3 z-10 flex size-10 items-center justify-center rounded-full transition-colors ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white/95 text-zinc-900 shadow-sm hover:bg-white'}`}
            >
              <X className="size-[18px]" />
            </button>
            {unavailable ? (
              <p className={`px-6 py-12 text-center text-[15px] leading-6 ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Sign-in is temporarily unavailable. Please try again later.</p>
            ) : (
              <>
                {!ready && (
                  <div className="flex h-[440px] items-center justify-center" aria-hidden="true">
                    <span className={`size-6 animate-spin rounded-full border-2 ${dark ? 'border-white/20 border-t-white' : 'border-zinc-200 border-t-zinc-700'}`} />
                  </div>
                )}
                {src && (
                  <iframe
                    ref={frameRef}
                    src={src}
                    title={title}
                    onLoad={onLoad}
                    className={ready ? 'block w-full border-0' : 'absolute h-0 w-full opacity-0'}
                    // Never taller than what the keyboard leaves: the sign-in then scrolls inside the frame.
                    style={ready ? { height: view.height ? Math.min(height, view.height - 32) : height, colorScheme: dark ? 'dark' : 'light' } : undefined}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
