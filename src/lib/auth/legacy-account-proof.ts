/** Exact online Supabase getUser proof, without SDK logs or claim/email fallbacks. */
export function createLegacyOwnerReader(config: { url: string; anonKey: string }, request: typeof fetch = fetch) {
  const origin = new URL(config.url)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !config.anonKey) {
    throw new Error('Legacy account proof unavailable')
  }
  return async (token: string, signal?: AbortSignal): Promise<string | null> => {
    if (!token || token.length > 16_384 || /[\r\n]/.test(token) || signal?.aborted) return null
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
    let timer: ReturnType<typeof setTimeout> | undefined
    let aborted: (() => void) | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        aborted = () => reject(new Error('Legacy account proof unavailable'))
        combined.addEventListener('abort', aborted, { once: true })
        timer = setTimeout(() => controller.abort(), 8_000)
      })
      const lookup = async () => {
        const response = await request(new URL('/auth/v1/user', origin), { method: 'GET',
          headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
          cache: 'no-store', redirect: 'error', signal: combined })
        if (!response.ok) return null
        const user: unknown = await response.json()
        if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !user.id || user.id.length > 128) return null
        return user.id
      }
      return await Promise.race([lookup(), deadline])
    } catch { return null }
    finally {
      clearTimeout(timer)
      if (aborted) combined.removeEventListener('abort', aborted)
      controller.abort()
    }
  }
}
