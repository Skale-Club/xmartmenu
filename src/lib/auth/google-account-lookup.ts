export type GoogleLookupIdentity = { projectId: string; subject: string };
export type GoogleLookupStatus = { disabled: boolean; validSince: number };
const unavailable = () => new Error("Identity provider account status unavailable");

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 65_536) { void reader.cancel().catch(() => {}); throw unavailable(); }
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

/** One cancellable deadline covers credentials, STS, IAM and the complete lookup body. */
export function createGoogleAccountLookup(
  accessToken: (identity: GoogleLookupIdentity, signal: AbortSignal) => Promise<string>, request: typeof fetch = fetch, timeoutMs = 8_000,
) {
  return async (identity: GoogleLookupIdentity): Promise<GoogleLookupStatus> => {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(identity.projectId) || typeof identity.subject !== "string"
      || !identity.subject || identity.subject.length > 128) throw new Error("Invalid provider identity");
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const signal = controller.signal;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); },
          Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 8_000)) : 8_000);
      });
      const lookup = async () => {
        const token = await accessToken(identity, signal); signal.throwIfAborted();
        if (typeof token !== "string" || !token || token.length > 16_384 || /[\r\n]/.test(token)) throw unavailable();
        const response = await request(`https://identitytoolkit.googleapis.com/v1/projects/${identity.projectId}/accounts:lookup`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ localId: [identity.subject] }), signal, cache: "no-store", redirect: "error",
        });
        if (!response.ok || response.redirected) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
        const body = await readJson(response);
        if (!body || typeof body !== "object" || !("users" in body) || !Array.isArray(body.users) || body.users.length !== 1) throw unavailable();
        const account: unknown = body.users[0];
        if (!account || typeof account !== "object" || !("localId" in account) || account.localId !== identity.subject
          || ("tenantId" in account) || ("disabled" in account && typeof account.disabled !== "boolean")
          || ("validSince" in account && (typeof account.validSince !== "string" || !/^\d+$/.test(account.validSince)))) throw unavailable();
        const validSince = "validSince" in account ? Number(account.validSince) : 0;
        if (!Number.isSafeInteger(validSince) || validSince < 0) throw unavailable();
        return { disabled: "disabled" in account && account.disabled === true, validSince };
      };
      return await Promise.race([lookup(), deadline]);
    } catch { throw unavailable(); }
    finally { clearTimeout(timer); controller.abort(); }
  };
}
