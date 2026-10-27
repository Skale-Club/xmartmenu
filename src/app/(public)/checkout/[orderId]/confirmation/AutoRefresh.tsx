'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * While a payment is still being confirmed, re-render the page from the server
 * every few seconds, a bounded number of times. The server reads the order (and
 * the PaymentIntent from Stripe), so the page moves on as soon as the payment
 * is confirmed even if the webhook is late.
 */
export default function AutoRefresh({ everyMs = 3000, maxTimes = 20 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter()
  const count = useRef(0)
  useEffect(() => {
    const timer = setInterval(() => {
      count.current += 1
      if (count.current > maxTimes) {
        clearInterval(timer)
        return
      }
      router.refresh()
    }, everyMs)
    return () => clearInterval(timer)
  }, [router, everyMs, maxTimes])
  return null
}
