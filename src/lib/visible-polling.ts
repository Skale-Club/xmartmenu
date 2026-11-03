/** Single in-flight authenticated request; pause hidden tabs and abort on exit. */
export function startVisiblePolling(
  load: (signal: AbortSignal) => Promise<boolean>,
  visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document,
  intervalMs = 5_000,
): () => void {
  let stopped = false
  let running = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined }
  const run = async () => {
    clear()
    if (stopped || running || visibility.hidden) return
    running = true
    controller = new AbortController()
    // Bound hung requests too; no second request until this one settles.
    const timeout = setTimeout(() => controller?.abort(), 15_000)
    try { failures = await load(controller.signal) ? 0 : failures + 1 }
    catch { failures++ }
    finally {
      clearTimeout(timeout)
      running = false
      if (!stopped && !visibility.hidden) timer = setTimeout(() => void run(), Math.min(intervalMs * 2 ** Math.min(failures, 3), 30_000))
    }
  }
  const onVisibility = () => {
    clear()
    if (visibility.hidden) controller?.abort()
    else void run()
  }
  visibility.addEventListener('visibilitychange', onVisibility)
  void run()
  return () => {
    stopped = true
    clear()
    controller?.abort()
    visibility.removeEventListener('visibilitychange', onVisibility)
  }
}
