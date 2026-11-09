'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import ModalPortal from './ModalPortal'
import { useVisibleBox } from './keyboard-fields'

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const

/**
 * The admin's titled dialog: centred on every screen size with a margin, the
 * header pinned and the body scrolling inside, never taller than the screen.
 * Forms don't close on a stray backdrop tap (typed data would be lost);
 * Escape and the X do.
 */
export default function Modal({
  open,
  title,
  onClose,
  size = 'md',
  closeOnBackdrop = false,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  size?: keyof typeof SIZES
  closeOnBackdrop?: boolean
  children: ReactNode
}) {
  const box = useVisibleBox()
  if (!open) return null
  return (
    <ModalPortal onClose={onClose}>
      <div className="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-sm" onClick={closeOnBackdrop ? onClose : undefined}>
        {/* Centred in what the phone keyboard leaves visible, so the field being typed in stays above it. */}
        <div className="fixed inset-x-0 flex items-center justify-center p-3 sm:p-4" style={box.style}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl ${SIZES[size]}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-8 sm:py-5">
            <h2 className="min-w-0 truncate text-lg font-black tracking-tight text-zinc-950 sm:text-xl">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-zinc-100"
            >
              <X className="h-5 w-5 text-zinc-600" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">{children}</div>
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
