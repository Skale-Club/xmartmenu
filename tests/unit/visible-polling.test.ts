import { afterEach, describe, expect, it, vi } from 'vitest'
import { startVisiblePolling } from '@/lib/visible-polling'

function visibility() {
  const target = new EventTarget()
  return Object.assign(target, { hidden: false })
}
afterEach(() => vi.useRealTimers())
describe('bounded authenticated polling', () => {
  it('never overlaps slow requests and aborts/cleans up on exit', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let finish: (value: boolean) => void = () => {}
    const load = vi.fn((s: AbortSignal) => { signal = s; return new Promise<boolean>(resolve => { finish = resolve }) })
    const stop = startVisiblePolling(load, visibility())
    await vi.advanceTimersByTimeAsync(20_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
    stop(); finish(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('pauses hidden tabs and fetches immediately on return', async () => {
    vi.useFakeTimers()
    const tab = visibility()
    tab.hidden = true
    const load = vi.fn(async () => true)
    const stop = startVisiblePolling(load, tab)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).not.toHaveBeenCalled()
    tab.hidden = false; tab.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    tab.hidden = true; tab.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(1)
    stop()
  })
  it('backs off on failed responses and resets after recovery', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(true)
    const stop = startVisiblePolling(load, visibility())
    await vi.advanceTimersByTimeAsync(9_999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(load).toHaveBeenCalledTimes(3)
    stop()
  })
})
