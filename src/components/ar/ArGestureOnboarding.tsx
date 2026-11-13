'use client'

/* eslint-disable react-hooks/set-state-in-effect -- The hint sequence follows the external XR lifecycle (stage changes). */

/**
 * The only two gesture animations in the AR camera (owner, 2026-11-12):
 *
 *   tap   while a surface is found: a white touch dot pressing with a ripple and
 *         "Tap to place". Every time; it goes away with the tap.
 *   move  right after the dish lands, the first time ever in this browser:
 *         the touch dot sliding sideways and "Drag to move" (~3.5 s). Never again
 *         for another dish, restaurant or visit (claimGestureOnboarding).
 *
 * No "real size" notice: the owner found it obvious (2026-11-12). There is no
 * resize, so there is no pinch animation.
 * Nothing here captures touches: placing and closing stay possible.
 */

import { useEffect, useRef, useState } from 'react'
import { claimGestureOnboarding } from '@/lib/ar/gesture-onboarding'
import type { ArCopy } from './ar-copy'

interface Props {
  active: boolean
  stage: 'scanning' | 'surface' | 'placed'
  copy: ArCopy
  /** A positive, changing token lets the review preview show the move hint again (memory only). */
  replayToken?: number
}

const MOVE_MS = 3500

export default function ArGestureOnboarding({ active, stage, copy, replayToken = 0 }: Props) {
  const [after, setAfter] = useState<'move' | null>(null)
  const forceMove = useRef(false)
  useEffect(() => { if (replayToken > 0) forceMove.current = true }, [replayToken])
  const placed = active && stage === 'placed'

  useEffect(() => {
    if (!placed) { setAfter(null); return }
    let storage: Storage | undefined
    try { storage = window.localStorage } catch { /* Use the shared memory fallback. */ }
    const showMove = forceMove.current || claimGestureOnboarding(storage)
    forceMove.current = false
    const timers: number[] = []
    if (showMove) {
      setAfter('move')
      timers.push(window.setTimeout(() => setAfter(null), MOVE_MS))
    }
    return () => timers.forEach(window.clearTimeout)
  }, [placed])

  const tap = active && stage === 'surface'
  if (!tap && !after) return null
  return <div className="xmm-ar-hints" aria-live="polite">
    <style>{`
      .xmm-ar-hints, .xmm-ar-hints * { pointer-events:none!important; box-sizing:border-box; }
      .xmm-ar-hints .hint { position:absolute; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:10px;
        color:#fff; font:600 15px/1.3 Inter,system-ui,sans-serif; animation:xmm-hint-in 220ms ease-out both; }
      .xmm-ar-hints .hint.is-tap { top:54%; }
      .xmm-ar-hints .hint.is-move { top:56%; animation:xmm-hint-in 220ms ease-out both, xmm-hint-out 300ms ease-in ${MOVE_MS - 300}ms forwards; }
      .xmm-ar-hints p { margin:0; padding:8px 14px; border-radius:999px; background:rgb(21 24 25 / 82%); text-align:center; }
      .xmm-ar-hints .stage { position:relative; width:56px; height:56px; display:flex; align-items:center; justify-content:center; }
      .xmm-ar-hints .stage.is-wide { width:120px; }
      .xmm-ar-hints .touch-dot { display:block; width:26px; height:26px; border-radius:999px; background:rgb(255 255 255 / 92%);
        box-shadow:1px 2px 4px rgb(0 0 0 / 35%), 0 0 0 6px rgb(255 255 255 / 18%); }
      .xmm-ar-hints .ripple { position:absolute; left:50%; top:50%; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:999px;
        border:2px solid rgb(255 255 255 / 85%); animation:xmm-ripple 1.6s ease-out infinite; }
      .xmm-ar-hints .is-tap .touch { animation:xmm-press 1.6s ease-in-out infinite; }
      .xmm-ar-hints .is-move .touch { animation:xmm-drag 1.7s ease-in-out 2; }
      .xmm-ar-hints .track { position:absolute; left:14px; right:14px; top:50%; height:2px; margin-top:-1px; border-radius:2px;
        background:linear-gradient(90deg, transparent, rgb(255 255 255 / 55%), transparent); }
      .xmm-ar-hints .chev { position:absolute; top:50%; width:8px; height:8px; margin-top:-4px; border:solid rgb(255 255 255 / 80%); border-width:2px 2px 0 0; }
      .xmm-ar-hints .chev.left { left:2px; transform:rotate(-135deg); }
      .xmm-ar-hints .chev.right { right:2px; transform:rotate(45deg); }
      @keyframes xmm-hint-in { from { opacity:0; transform:translate(-50%, 6px); } to { opacity:1; transform:translate(-50%, 0); } }
      @keyframes xmm-hint-out { to { opacity:0; } }
      @keyframes xmm-press { 0%,100% { transform:scale(1); } 28% { transform:scale(.8); } 42% { transform:scale(1); } }
      @keyframes xmm-ripple { 0%,26% { opacity:0; transform:scale(.6); } 34% { opacity:1; } 100% { opacity:0; transform:scale(2.2); } }
      @keyframes xmm-drag { 0%,100% { transform:translateX(-30px); } 50% { transform:translateX(30px); } }
      @media (prefers-reduced-motion: reduce) {
        .xmm-ar-hints .hint, .xmm-ar-hints .touch, .xmm-ar-hints .ripple { animation:none!important; }
        .xmm-ar-hints .ripple { opacity:.6; transform:scale(1.6); }
      }
    `}</style>
    {tap && <div className="hint is-tap" role="status">
      <div className="stage" aria-hidden="true">
        <span className="ripple" />
        <span className="touch"><span className="touch-dot" aria-hidden="true" /></span>
      </div>
      <p>{copy.tapToPlace}</p>
    </div>}
    {after === 'move' && <div className="hint is-move" role="status">
      <div className="stage is-wide" aria-hidden="true">
        <span className="track" /><span className="chev left" /><span className="chev right" />
        <span className="touch"><span className="touch-dot" aria-hidden="true" /></span>
      </div>
      <p>{copy.dragToMove}</p>
    </div>}
  </div>
}
