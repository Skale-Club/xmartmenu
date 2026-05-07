# Phase 10: Image Seeding — Research

**Researched:** 2026-05-06
**Domain:** Gemini image generation via `@google/genai`, GitHub Actions workflow dispatch, Supabase Storage upload from GH Actions, job-status polling
**Confidence:** HIGH — primary sources verified via npm registry, official Google AI docs, GitHub docs

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Image seeding is superadmin-only. Tenants never see generation buttons or loading states.
- **D-02:** `gemini-3.1-flash-image-preview` for all image generation — cover photo and per-product images. Uses `@google/genai` SDK directly (NOT `@ai-sdk/google`). Requires adding `@google/genai` as a new package dependency.
- **D-03:** All images are AI-generated via Gemini. No stock photo services (no Pexels, no Unsplash).
- **D-04:** Cover photo prompt uses `business_type` and `company_name` — warm restaurant interior, food/hospitality style. AI-seeded cover only fills the gap when no cover exists.
- **D-05:** Claude's discretion for per-product prompt construction. Additive only: skip products that already have an `image_url`.
- **D-06:** Image generation runs in a GitHub Actions workflow, NOT a Vercel serverless function. The Vercel API route only: (1) creates a job record, (2) dispatches the GH Actions workflow, (3) returns `job_id` immediately.
- **D-07:** New `ai_jobs` table tracks image seeding jobs: `(id, tenant_id, feature_key, status, created_at, completed_at, error_message)`. Status: `pending` → `running` → `complete` | `failed`.
- **D-08:** Superadmin UI polls `GET /api/superadmin/tenants/[id]/seed-status?jobId=...` every ~3 seconds until `complete` or `failed`.
- **D-09:** Additive only — skip products with `image_url`. Skip cover if tenant already has cover photo.
- **D-10:** `revalidatePath()` called after all images are uploaded.
- **D-11:** Gemini returns base64 `inline_data`. GH Actions script: base64 → Buffer → Sharp WebP → Supabase Storage upload. Paths: `{tenantId}/cover.webp`, `{tenantId}/products/{productId}.webp`.
- **D-12:** The existing `validateAndConvertToWebP()` takes a `File` object. GH Actions script needs a Buffer-based variant.
- **D-13:** `ai_usage` tracks image generation calls — `feature_key: 'image_seeding'`. Informational only.
- **D-14:** `sanitizeForPrompt()` applied to `company_name` and `business_type` before any prompt interpolation.

### Claude's Discretion

- Exact prompt text for cover photo and per-product images
- Whether to generate all products in parallel or sequentially (speed vs rate limits)
- GH Actions trigger type: `workflow_dispatch` vs `repository_dispatch`
- Exact polling interval and timeout in the UI (3–5s interval, ~5 min timeout)
- Whether `ai_jobs` is a new migration (023) or piggybacks on `ai_usage` with a status column

### Deferred Ideas (OUT OF SCOPE)

- Real restaurant photo upload as primary path (existing feature — separate)
- Content moderation check on AI-generated images before storage
- Per-tenant rate limiting on image generation (informational only in v1.2)
- Superadmin preview of generated image before it goes live
- Generating images for products that already have `image_url`
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-07 | Superadmin can trigger image seeding; system generates a restaurant cover/banner photo via Gemini, converts to WebP via Sharp pipeline, and uploads to Supabase Storage as the tenant's cover | D-06 (GH Actions), D-11 (image pipeline), D-07 (job tracking) |
| AI-08 | For each product without an image, system generates an AI image via Gemini, converts to WebP, and uploads as the product's `image_url` | D-03 (all AI-generated), D-11 (pipeline), D-05 (additive only) |
| AI-09 | Superadmin sees a "Seed image" button on each product row in the superadmin tenant view; clicking it generates an image for that single product | D-08 (polling UI), integration with TenantDetailClient.tsx AI Tools section |
</phase_requirements>

---

## Summary

Phase 10 adds AI image seeding for tenant menus. The architecture differs fundamentally from Phase 9 text seeding: instead of a single synchronous Vercel API route doing all work, Phase 10 splits the work across two boundaries. A short-lived Vercel route creates a job record in the new `ai_jobs` table and dispatches a GitHub Actions `workflow_dispatch` — returning immediately with a `job_id`. The actual image generation (multiple sequential Gemini API calls), Sharp WebP conversion, and Supabase Storage uploads all happen inside the GH Actions job, which can run for minutes without Vercel timeout pressure.

The `@google/genai` package (v1.52.0) is the required SDK — NOT `@ai-sdk/google`, which only supports text. `GoogleGenAI.models.generateContent` with `responseModalities: ['IMAGE']` returns base64-encoded PNG inside `part.inlineData.data`. That buffer is passed through `sharp().webp({ quality: 85 }).toBuffer()` (a one-liner variant; no `File` wrapper needed) and uploaded to Supabase Storage with the service role key.

The UI extension adds a "Seed images" button to the existing AI Tools section in `TenantDetailClient.tsx`. After POST triggers the job, the UI polls the new status endpoint every 3 seconds. On `complete` the page refreshes to show newly uploaded images. An AI-09-specific "Seed image" button per product row triggers a single-product variant of the same job.

**Primary recommendation:** Use `workflow_dispatch` (simpler than `repository_dispatch` — no content-type header gymnastics, structured inputs), a Fine-Grained PAT with `actions: write` scope stored as `GH_PAT` in Vercel env vars, and sequential image generation within the GH Actions script (simpler, predictable cost, avoids preview-model rate-limit bursts).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@google/genai` | 1.52.0 (latest) | Gemini image generation — `GoogleGenAI.models.generateContent` | Only official SDK that supports `gemini-3.1-flash-image-preview` image output; `@ai-sdk/google` is text-only |
| `sharp` | 0.34.5 (already installed) | Buffer → WebP conversion | Already in project — same pipeline as existing upload route |
| `@supabase/supabase-js` | 2.105.3 (already installed) | Storage upload from GH Actions Node.js script | Already in project; service role key bypasses RLS |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@octokit/core` | 7.0.6 | GitHub REST API client — `workflow_dispatch` trigger | Cleaner than raw `fetch` for the dispatch call; typed inputs |
| GitHub Actions `actions/checkout@v4` + `actions/setup-node@v4` | — | Bootstrap GH Actions job | Already used in `ci.yml` |

### New Dependency

`@google/genai` is NOT currently in `package.json`. It must be added:

```bash
npm install @google/genai
```

Verified: `npm view @google/genai version` → `1.52.0`

No other new production dependencies needed — `sharp`, `@supabase/supabase-js` are already installed.

### GH Actions Script Dependencies

The `image-seeding.yml` workflow installs from the project's existing `package.json` (via `npm ci` after `actions/checkout`) — so `@google/genai`, `sharp`, and `@supabase/supabase-js` are all available without extra install steps once `@google/genai` is added to `package.json`.

---

## Architecture Patterns

### New Files Overview

```
.github/workflows/
└── image-seeding.yml              # GH Actions workflow — does the actual generation

src/app/api/superadmin/tenants/[id]/
├── seed-images/route.ts           # POST — creates ai_jobs row, dispatches GH Actions
└── seed-status/route.ts           # GET — polls ai_jobs by jobId

src/app/(superadmin)/tenants/[id]/
└── TenantDetailClient.tsx         # Extended — "Seed images" button + polling UI

scripts/
└── seed-images.ts                 # Node.js script called by GH Actions workflow

supabase/migrations/
└── 023_ai_jobs.sql                # New ai_jobs table
```

### Pattern 1: Trigger Route (`seed-images/route.ts`)

Short-lived (maxDuration: 15). Auth-guard → insert `ai_jobs` row → dispatch `workflow_dispatch` via GitHub API → return `job_id`.

```typescript
// Source: verified against GitHub REST API docs
// POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
const ghResponse = await fetch(
  `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/image-seeding.yml/dispatches`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GH_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        job_id: jobId,
        tenant_id: tenantId,
        product_id: productId ?? '',          // empty = bulk seed
      },
    }),
  }
)
// Successful dispatch returns HTTP 204 No Content
```

**CRITICAL:** `workflow_dispatch` returns HTTP 204 with NO body. The route must NOT try to `await res.json()` — check `res.status === 204` to confirm dispatch succeeded.

### Pattern 2: GH Actions Workflow (`image-seeding.yml`)

```yaml
name: Image Seeding

on:
  workflow_dispatch:
    inputs:
      job_id:
        description: 'ai_jobs row ID'
        required: true
      tenant_id:
        description: 'Tenant UUID'
        required: true
      product_id:
        description: 'Single product UUID (empty for bulk)'
        required: false
        default: ''

jobs:
  seed-images:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx tsx scripts/seed-images.ts
        env:
          JOB_ID: ${{ inputs.job_id }}
          TENANT_ID: ${{ inputs.tenant_id }}
          PRODUCT_ID: ${{ inputs.product_id }}
          GOOGLE_GENERATIVE_AI_API_KEY: ${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          VERCEL_REVALIDATE_URL: ${{ secrets.VERCEL_REVALIDATE_URL }}
          VERCEL_REVALIDATE_SECRET: ${{ secrets.VERCEL_REVALIDATE_SECRET }}
```

### Pattern 3: `@google/genai` Image Generation

```typescript
// Source: ai.google.dev/gemini-api/docs/image-generation (official)
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })

const response = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image-preview',
  contents: prompt,
  config: {
    responseModalities: ['IMAGE'],
    imageConfig: {
      aspectRatio: '16:9',   // for cover photo
      // aspectRatio: '1:1', // for product photos
    },
  },
})

// Extract base64 inline_data
for (const part of response.candidates[0].content.parts) {
  if (part.inlineData) {
    const imageBuffer = Buffer.from(part.inlineData.data, 'base64')
    // imageBuffer is a PNG; pass to Sharp for WebP conversion
  }
}
```

**IMPORTANT NOTE:** The `imageConfig.imageSize` parameter is ignored by `gemini-3.1-flash-image-preview` — it always returns approximately 1K resolution regardless. Do not attempt to configure size; configure only `aspectRatio`.

### Pattern 4: Buffer-Based Sharp WebP Conversion

The existing `validateAndConvertToWebP()` in `src/lib/upload.ts` takes a `File` object (browser API unavailable in GH Actions). Use Sharp directly — one liner:

```typescript
// Source: Sharp official docs (sharp.pixelplumbing.com) — verified pattern
import sharp from 'sharp'

async function bufferToWebP(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .webp({ quality: 85 })
    .toBuffer()
}
```

Sharp accepts `Buffer` directly — no `File` wrapper needed. Same quality setting (85) as existing pipeline.

### Pattern 5: Supabase Storage Upload from Node.js (GH Actions)

```typescript
// Source: Supabase JS docs + createServiceClient pattern in src/lib/supabase/server.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Upload cover
await supabase.storage
  .from('tenant-assets')
  .upload(`${tenantId}/cover.webp`, webpBuffer, {
    contentType: 'image/webp',
    upsert: true,
  })

const { data: { publicUrl } } = supabase.storage
  .from('tenant-assets')
  .getPublicUrl(`${tenantId}/cover.webp`)

// Update tenant_settings.banner_url
await supabase.from('tenant_settings')
  .upsert({ tenant_id: tenantId, banner_url: publicUrl }, { onConflict: 'tenant_id' })
```

Service role key bypasses RLS — no auth headers needed. `upsert: true` enables safe reruns (additive pattern D-09).

### Pattern 6: Job Status Tracking

The `ai_jobs` table row lifecycle:

1. **Trigger route** (Vercel): INSERT row with `status: 'pending'`, returns `id` as `job_id`
2. **GH Actions script start**: UPDATE row to `status: 'running'`
3. **GH Actions script end (success)**: UPDATE row to `status: 'complete'`, set `completed_at`
4. **GH Actions script end (failure)**: UPDATE row to `status: 'failed'`, set `error_message`

```typescript
// In GH Actions script — update status
await supabase.from('ai_jobs')
  .update({ status: 'running' })
  .eq('id', process.env.JOB_ID)
```

### Pattern 7: Polling Status Endpoint

```typescript
// GET /api/superadmin/tenants/[id]/seed-status?jobId=xxx
// Returns: { status: 'pending' | 'running' | 'complete' | 'failed', error?: string }
```

UI polls every 3 seconds. Polling stops when status is `complete` or `failed`. On `complete`, trigger a page refresh or refetch tenant data to show updated images.

### Pattern 8: `revalidatePath()` from GH Actions

`revalidatePath` is a Next.js server-side function — cannot be called directly from an external Node.js script. The GH Actions script calls a lightweight Vercel endpoint at the end of the job:

```typescript
// GH Actions script calls Vercel revalidation endpoint after all uploads complete
await fetch(`${process.env.VERCEL_REVALIDATE_URL}/api/revalidate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    secret: process.env.VERCEL_REVALIDATE_SECRET,
    tenantSlug: tenantSlug,
  }),
})
```

Create a lightweight `src/app/api/revalidate/route.ts` that validates the secret and calls `revalidatePath()`. This same endpoint will be reusable for future phases.

### Anti-Patterns to Avoid

- **Calling `res.json()` after `workflow_dispatch`:** GitHub returns HTTP 204 with empty body. Parsing it as JSON throws. Check `res.status === 204` only.
- **Using `File` object in GH Actions script:** `File` is a browser API. Sharp accepts `Buffer` directly — no wrapper needed.
- **Parallel image generation for all products:** Preview model has restrictive rate limits. Sequential generation with retry on 429 is safer.
- **Storing `GITHUB_TOKEN` from inside a GH Actions job as the dispatch token:** `GITHUB_TOKEN` is scoped to the running job and cannot trigger other workflows. Use a PAT with `actions: write` stored as `GH_PAT` in Vercel env vars.
- **`repository_dispatch` over `workflow_dispatch`:** Repository dispatch requires a `client_payload` envelope and a matching `types` filter in the workflow. `workflow_dispatch` has typed `inputs` — simpler, less error-prone.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gemini image generation | Custom HTTP calls to Gemini REST API | `@google/genai` SDK `GoogleGenAI.models.generateContent` | SDK handles auth, retry, response parsing |
| WebP conversion | Custom image encoding | `sharp(buffer).webp({ quality: 85 }).toBuffer()` | Sharp already in project; battle-tested at scale |
| Supabase Storage upload from Node.js | Custom multipart HTTP upload | `@supabase/supabase-js` `storage.from().upload()` | Already in project; service role key bypasses RLS without extra setup |
| GitHub workflow dispatch | Custom fetch to GitHub REST | Direct `fetch` to GitHub API is sufficient; `@octokit/core` optional | Simple POST — not complex enough to justify Octokit unless you want TypeScript types |
| Polling UI state | WebSockets / Supabase Realtime subscription | Simple `setInterval` + REST status endpoint | Realtime adds subscription complexity for a low-frequency single-user operation |

---

## Common Pitfalls

### Pitfall 1: `workflow_dispatch` Returns 204 with Empty Body

**What goes wrong:** Route handler calls `await res.json()` on the GitHub API response — throws `SyntaxError: Unexpected end of JSON input` and the job appears to fail even though the workflow was dispatched successfully.
**Why it happens:** `workflow_dispatch` is an acknowledged fire-and-forget signal — GitHub returns 204 No Content by design.
**How to avoid:** Check `if (res.status !== 204) throw new Error(...)`. Never `.json()` the dispatch response.
**Warning signs:** Server logs show JSON parse error immediately after the dispatch POST.

### Pitfall 2: Using GITHUB_TOKEN to Dispatch Workflows from Vercel

**What goes wrong:** `GITHUB_TOKEN` is only available inside a running GH Actions job — it cannot be stored in Vercel env vars and used from outside. If you try to use it from a Vercel API route, there is no token.
**Why it happens:** Developers conflate "GitHub token used in Actions" with "token to call GitHub API from outside." They are different things.
**How to avoid:** Create a Fine-Grained PAT with `Actions: Read and Write` and `Workflows: Read and Write` permissions on the specific repo. Store as `GH_PAT` in Vercel environment variables. Use `Bearer ${process.env.GH_PAT}` in the Authorization header.
**Warning signs:** GitHub API returns HTTP 401 Unauthorized when calling dispatch from Vercel.

### Pitfall 3: `File` Object Used in GH Actions Script

**What goes wrong:** The GH Actions Node.js script tries to use `new File([buffer], 'name', { type: '...' })` — `File` is a Web Platform API, only available in browsers and Vercel Edge runtime. In a plain `tsx` Node.js script, `File` is undefined at runtime.
**Why it happens:** The existing `validateAndConvertToWebP()` in `src/lib/upload.ts` takes a `File` — the developer copies that pattern into the script.
**How to avoid:** Use `sharp(buffer).webp({ quality: 85 }).toBuffer()` directly. No `File` object needed. Sharp's input can be a plain `Buffer`.
**Warning signs:** `ReferenceError: File is not defined` in GH Actions logs.

### Pitfall 4: `imageConfig.imageSize` Is Silently Ignored

**What goes wrong:** You set `imageConfig.imageSize: '2K'` or `'4K'` hoping for higher resolution — Gemini silently ignores it and returns ~1K images. This is a known limitation of `gemini-3.1-flash-image-preview` (GitHub issue #1461 on `googleapis/js-genai`).
**Why it happens:** The parameter exists in the SDK type signature but is not honored by this preview model.
**How to avoid:** Do not set `imageSize` for `gemini-3.1-flash-image-preview`. Only configure `aspectRatio`. Accept ~1K as the output resolution.
**Warning signs:** Images are always ~1024px regardless of configured size.

### Pitfall 5: Rate Limits on Preview Model — Bursting N Parallel Requests

**What goes wrong:** Generating images for 20 products in parallel triggers 429 Too Many Requests from Gemini. Preview models have "more restrictive rate limits" than stable models — exact RPM not published by Google, but parallel bursts reliably hit limits.
**Why it happens:** Developers default to `Promise.all()` for speed. Text generation (Phase 9) used sequential calls but with fast responses; image generation is slower and the model is more restrictive.
**How to avoid:** Generate images sequentially in the GH Actions script with a short delay between calls (e.g., 1 second). GH Actions has no Vercel timeout pressure — sequential is safe.
**Warning signs:** Some product images upload successfully, others fail with 429. Images are generated inconsistently across runs.

### Pitfall 6: GH Actions Secrets Not in Repository Settings

**What goes wrong:** GH Actions workflow references `${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}` and `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` — but these secrets are only set in Vercel, not in GitHub repository secrets. The workflow run fails silently with empty env vars.
**Why it happens:** Phase 9 only needed secrets in Vercel (no GH Actions work). Phase 10 needs a parallel secret set in GitHub repository settings.
**How to avoid:** Before testing the workflow, confirm these secrets are added to GitHub → repository Settings → Secrets and variables → Actions:
  - `GOOGLE_GENERATIVE_AI_API_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `VERCEL_REVALIDATE_URL` (the Vercel app URL, e.g. `https://xmartmenu.vercel.app`)
  - `VERCEL_REVALIDATE_SECRET` (a generated secret shared with the revalidate API route)
**Warning signs:** Workflow logs show empty strings for env vars; Supabase client fails to initialize.

### Pitfall 7: `assertSuperadmin()` Cookie Dependency Fails in Polling Under Different Session

**What goes wrong:** The seed-status polling endpoint is called via `fetch` from the client every 3 seconds. If the session cookie expires mid-polling (rare but possible), `assertSuperadmin()` returns null and all status polls return 401, causing the UI to show a false failure.
**Why it happens:** `assertSuperadmin()` reads cookies from the Next.js request context — correct behavior, but polling amplifies the risk.
**How to avoid:** The status endpoint only reads from `ai_jobs` by `job_id` — it doesn't perform privileged mutations. A lighter auth check (just verify session exists + role is superadmin) is sufficient. Since this is a superadmin-only endpoint, the standard `assertSuperadmin()` pattern from Phase 9 is still appropriate — just handle 401 in the polling logic gracefully (stop polling, show "Session expired" message).

### Pitfall 8: `revalidatePath()` Cannot Be Called from GH Actions Node.js

**What goes wrong:** The GH Actions script tries `import { revalidatePath } from 'next/cache'` — fails at import because `next/cache` is a Next.js-only server module that requires the Next.js runtime context.
**Why it happens:** The seed route (Phase 9) calls `revalidatePath()` directly. The GH Actions script is not running in Next.js context.
**How to avoid:** Create a small internal API route `POST /api/revalidate` in the Next.js app that accepts a shared `VERCEL_REVALIDATE_SECRET`. The GH Actions script calls this endpoint via HTTP at the end of the job. The Next.js route calls `revalidatePath()` on the specified tenant slug.

---

## Code Examples

### Initialize `@google/genai` SDK

```typescript
// Source: ai.google.dev/gemini-api/docs/image-generation (official)
import { GoogleGenAI } from '@google/genai'

// In GH Actions script — API key from env var (same key as Phase 9)
const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
})
```

### Generate Cover Photo (16:9)

```typescript
// Source: official Google AI docs — verified pattern
const coverResponse = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image-preview',
  contents: `Professional food and hospitality photography. Restaurant interior of a ${safeBusinessType} named ${safeCompanyName}. Warm, inviting atmosphere. Soft natural lighting, bokeh background, restaurant-quality ambiance. No people, no text, no logos.`,
  config: {
    responseModalities: ['IMAGE'],
    imageConfig: { aspectRatio: '16:9' },
  },
})

for (const part of coverResponse.candidates[0].content.parts) {
  if (part.inlineData) {
    const pngBuffer = Buffer.from(part.inlineData.data, 'base64')
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer()
    // upload webpBuffer to Supabase Storage
    break
  }
}
```

### Generate Product Photo (1:1)

```typescript
const productResponse = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image-preview',
  contents: `Professional food photography. A dish called "${safeProductName}" from the "${safeCategoryName}" section of a ${safeBusinessType} restaurant. Close-up, top-down or 45-degree angle, clean white plate, soft natural lighting. Food only. No people, no text, no logos, no watermarks.`,
  config: {
    responseModalities: ['IMAGE'],
    imageConfig: { aspectRatio: '1:1' },
  },
})
```

### Dispatch `workflow_dispatch` from Vercel Route

```typescript
// Source: docs.github.com/en/rest/actions/workflows — verified
const owner = process.env.GITHUB_REPO_OWNER!   // e.g. 'Vanildo'
const repo = process.env.GITHUB_REPO_NAME!     // e.g. 'xmartmenu'

const dispatchRes = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/actions/workflows/image-seeding.yml/dispatches`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GH_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: { job_id: jobId, tenant_id: tenantId, product_id: productId ?? '' },
    }),
  }
)

if (dispatchRes.status !== 204) {
  const text = await dispatchRes.text()
  throw new Error(`GH dispatch failed: ${dispatchRes.status} ${text}`)
}
// 204 = dispatched successfully. No body to parse.
```

### `ai_jobs` Table: Migration 023

```sql
-- supabase/migrations/023_ai_jobs.sql
CREATE TABLE IF NOT EXISTS ai_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,                         -- e.g. 'image_seeding', 'image_single'
  status        TEXT NOT NULL DEFAULT 'pending',       -- pending | running | complete | failed
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

-- Superadmin full access
CREATE POLICY "ai_jobs_superadmin" ON ai_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );
```

`ai_jobs` is a separate table from `ai_usage` (not piggybacking). The two tables serve different purposes: `ai_usage` tracks aggregate API cost per feature per day; `ai_jobs` tracks individual job lifecycle. Mixing them would add a `status` + `completed_at` + `error_message` to a table designed for upsert cost accumulation — wrong semantics.

### `ai_usage` Log Pattern (from Phase 9 — extend for image seeding)

```typescript
// Same upsert pattern as existing seed route
const today = new Date().toISOString().slice(0, 10)
await supabase.from('ai_usage').upsert({
  tenant_id: tenantId,
  feature_key: 'image_seeding',
  date: today,
  call_count: imagesGenerated,
  token_count: 0,   // Gemini image generation does not return token counts
}, { onConflict: 'tenant_id,feature_key,date' })
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DALL-E 3 / gpt-image-1 for image gen | `gemini-3.1-flash-image-preview` via `@google/genai` | CONTEXT.md D-02 decision | Single Google API key for both text (Phase 9) and images (Phase 10) |
| Vercel serverless for all AI work | GH Actions for long-running image jobs | CONTEXT.md D-06 decision | Eliminates Vercel 300s timeout risk for bulk image generation |
| Fire-and-forget image gen | Job-status table + polling | CONTEXT.md D-07/D-08 | UI has real feedback rather than silent background work |

**Deprecated/outdated in context of this project:**
- `@ai-sdk/google` for image generation: does NOT support image output modalities — text only
- `openai` SDK image generation (STACK.md originally recommended gpt-image-1-mini): superseded by D-02 decision to use Gemini for all image work

---

## Open Questions

1. **Exact rate limit for `gemini-3.1-flash-image-preview` on the project's API tier**
   - What we know: Preview models have "more restrictive" limits than stable models. No specific RPM published by Google.
   - What's unclear: Whether the project's current paid tier supports enough IPM (images per minute) for bulk product seeding of 10–20 images.
   - Recommendation: Implement sequential generation with a 1.5-second delay between calls. If 429s are observed in testing, increase delay to 3 seconds.

2. **Revalidation endpoint security vs. simplicity**
   - What we know: GH Actions needs to trigger `revalidatePath()` after uploads complete.
   - What's unclear: Whether to build a dedicated `/api/revalidate` route now or inline the `revalidatePath` call into the seed-status polling (i.e., the GH Actions script sets `status = 'complete'`, and the Vercel status endpoint calls `revalidatePath()` when it detects the transition to `complete`).
   - Recommendation: The polling endpoint approach is simpler — when status transitions to `complete`, the status endpoint calls `revalidatePath(tenantSlug)` once before returning the response. This avoids a new endpoint and a new secret.

3. **AI-09 single-product "Seed image" button flow**
   - What we know: AI-09 requires a per-product button. The same trigger route and GH Actions workflow should handle it via the `product_id` input (non-empty = single product mode).
   - What's unclear: Whether the single-product button should also use GH Actions (with the same polling pattern) or can be a direct Vercel call (one image ≈ 10–15 seconds, within Vercel's timeout with `maxDuration: 60`).
   - Recommendation: Keep both paths through GH Actions for architectural consistency. Set `maxDuration: 15` on the trigger route (it only inserts a row and dispatches). The polling UI is already being built for bulk; reusing it for single-product is trivial.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@google/genai` npm package | Gemini image gen | Not yet installed | 1.52.0 available | None — must install |
| `sharp` | WebP conversion | Already installed | 0.34.5 | None (required) |
| `@supabase/supabase-js` | Storage upload, DB writes | Already installed | 2.105.3 | None (required) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API | In Vercel env (Phase 9) | — | Must be added to GitHub Secrets |
| `NEXT_PUBLIC_SUPABASE_URL` | GH Actions Supabase client | In Vercel env + GitHub Secrets | — | Already in `ci.yml` secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | GH Actions Supabase client | In Vercel env + GitHub Secrets | — | Already in `ci.yml` secrets |
| `GH_PAT` (Fine-Grained PAT) | Workflow dispatch from Vercel | Must be created | — | No fallback — required for dispatch |
| GitHub Actions runners | Workflow execution | Available (existing ci.yml works) | ubuntu-latest | — |
| `tsx` (script runner) | `scripts/seed-images.ts` | In devDependencies (0.4.x) | 4.19.0 | `ts-node` but tsx already present |

**Missing with no fallback (must address in Wave 0):**
- `@google/genai` package must be installed (`npm install @google/genai`)
- `GH_PAT` Fine-Grained PAT must be created with Actions + Workflows write access and stored as `GH_PAT` in Vercel env vars
- `GOOGLE_GENERATIVE_AI_API_KEY` must be added to GitHub repository secrets (already in Vercel)
- New GitHub secrets: `VERCEL_REVALIDATE_URL`, `VERCEL_REVALIDATE_SECRET`

---

## Sources

### Primary (HIGH confidence)

- `npm view @google/genai version` — verified 1.52.0 (2026-05-06)
- [Google AI — Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation) — `responseModalities`, `imageConfig.aspectRatio`, `inlineData.data` extraction pattern
- [GitHub REST API — workflow_dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) — endpoint, 204 response, PAT requirements
- `src/app/api/superadmin/tenants/[id]/seed/route.ts` — Phase 9 seed route; direct pattern inspection
- `src/lib/upload.ts` — Sharp pipeline; `validateAndConvertToWebP()` takes File, confirmed Buffer variant needed
- `src/lib/supabase/server.ts` — `createServiceClient()` pattern for service-role Supabase client
- `supabase/migrations/022_ai_usage.sql` — canonical pattern for migration 023

### Secondary (MEDIUM confidence)

- [googleapis/js-genai Issue #1461](https://github.com/googleapis/js-genai/issues/1461) — `imageConfig.imageSize` is silently ignored by `gemini-3.1-flash-image-preview`
- [GitHub Actions Secrets in Node.js](https://supabase.com/docs/guides/functions/examples/github-actions) — `process.env` pattern for GH Actions secrets
- [Sharp buffer API](https://sharp.pixelplumbing.com/api-output/) — `sharp(Buffer).webp().toBuffer()` accepts Buffer directly

### Tertiary (LOW confidence — cross-referenced with primary)

- Multiple search results confirming Fine-Grained PAT with `actions: write` required for `workflow_dispatch` from external callers (classic PAT with `repo` scope is alternative)
- Gemini preview model rate limits: no specific RPM published — sequential generation with delay is the safe recommendation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions npm-verified, SDK docs official
- Architecture patterns: HIGH — based on direct codebase inspection + verified API docs
- Pitfalls: HIGH — based on official API behavior docs + known SDK bug (imageSize)
- Rate limits: LOW — no published RPM for preview models; sequential strategy is safe conservative choice

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (30 days — gemini-3.1-flash-image-preview is a preview model; check for graduation to stable or deprecation)
