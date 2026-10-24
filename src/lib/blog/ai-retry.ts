// src/lib/blog/ai-retry.ts
//
// SOURCE OF TRUTH: skaleclub/server/blog/ai-retry.ts — sync changes back.
// Ported here from Skale Club (see
// .planning/initiatives/autoblog-parity/MASTER.md §5).
//
// Timeout + backoff around a single AI call. Extracted verbatim from
// blog-generator.ts (Phase 36 D-07, Phase 38 BLOG2-16) so every product in the
// org retries the same way instead of each inventing its own loop.
//
// Pure module: no DB, no storage, no provider import. The caller supplies the
// work as `(signal) => Promise<T>` and is responsible for forwarding the
// AbortSignal to its HTTP client — a timeout that does not abort the underlying
// request only stops waiting, it does not stop paying.

import { AiEmptyResponseError, AiTimeoutError } from './content-validator';

/**
 * Per-attempt ceiling. BLOG_GEMINI_TIMEOUT_MS is honored for backward
 * compatibility with deploys that still set the old Gemini-era variable.
 */
export const BLOG_AI_TIMEOUT_MS: number =
  Number(process.env.BLOG_AI_TIMEOUT_MS) ||
  Number(process.env.BLOG_GEMINI_TIMEOUT_MS) ||
  30_000;

/** Phase 38 BLOG2-16: backoff schedule — fixed per spec, no jitter. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 5000, 30000];

/**
 * Race the AI call against BLOG_AI_TIMEOUT_MS. The AbortSignal is handed to the
 * caller so the timeout actually cancels the underlying request.
 */
export async function withAiTimeout<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiTimeoutError(`AI ${label} exceeded ${BLOG_AI_TIMEOUT_MS}ms`));
    }, BLOG_AI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Transient = worth retrying. A 4xx (auth, quota, malformed request) is NOT:
 * retrying it burns the backoff schedule and still fails.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof AiTimeoutError) return true;
  if (err instanceof AiEmptyResponseError) return true;
  // OpenRouter (fetch wrapper) and OpenAI-SDK errors carry a numeric HTTP status.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status >= 500 && status < 600;
  // Network errors surfaced by undici/fetch.
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;
    if (/fetch failed|network|socket hang up/i.test(err.message)) return true;
  }
  return false;
}

/**
 * Composes over withAiTimeout. On a transient error, sleeps
 * RETRY_DELAYS_MS[attempt] and retries. After 3 retries (4 total attempts),
 * re-throws the LAST error so the caller's typed-error mapping still classifies
 * the failure.
 */
export async function withAiRetry<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await withAiTimeout(label, run);
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      const delayMs = RETRY_DELAYS_MS[attempt];
      console.warn(`[blog-ai-retry] ${label} attempt ${attempt + 1} failed; retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
