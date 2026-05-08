'use client'

import { useEffect, useRef, useState } from 'react'

function computeMinutes(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
}

export function useElapsedTime(
  createdAt: string,
  amberMinutes: number = 10,
  redMinutes: number = 20,
) {
  const [minutes, setMinutes] = useState(() => computeMinutes(createdAt))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Re-compute immediately in case server render used a stale value
    setMinutes(computeMinutes(createdAt))

    intervalRef.current = setInterval(() => {
      setMinutes(computeMinutes(createdAt))
    }, 30_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [createdAt])

  const chipClass =
    minutes >= redMinutes
      ? 'bg-red-100 text-red-700'
      : minutes >= amberMinutes
        ? 'bg-amber-100 text-amber-700'
        : 'bg-zinc-100 text-zinc-600'

  return { minutes, chipClass }
}
