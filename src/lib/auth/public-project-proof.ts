export type PublicProjectProof = { projectId: string; projectNumber: string; apiKey: string; origin: string }

/**
 * Identity Toolkit's official public getProjects endpoint selects its project
 * from the API key. Never pass the deprecated projectNumber override in query.
 * The legacy projectId response can be the numeric project identifier; match
 * the explicitly reviewed ID/number pair and its default Firebase domain.
 */
export async function verifyPublicProject(config: PublicProjectProof, request: typeof fetch = fetch): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error()); controller.abort() }, 8_000)
    })
    const lookup = async () => {
      const response = await request('https://identitytoolkit.googleapis.com/v1/projects', {
        method: 'GET', headers: { 'X-Goog-Api-Key': config.apiKey, Referer: `${new URL(config.origin).origin}/identity` },
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      })
      if (!response.ok) throw new Error()
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || !('projectId' in body) || !('authorizedDomains' in body)
        || typeof body.projectId !== 'string' || ![config.projectId, config.projectNumber].includes(body.projectId)
        || !Array.isArray(body.authorizedDomains) || !body.authorizedDomains.every(domain => typeof domain === 'string')
        || !body.authorizedDomains.includes(`${config.projectId}.firebaseapp.com`)
        || !body.authorizedDomains.includes(new URL(config.origin).hostname)) throw new Error()
    }
    await Promise.race([lookup(), deadline])
  } catch { throw new Error('Identity project configuration could not be verified') }
  finally { clearTimeout(timer); controller.abort() }
}
