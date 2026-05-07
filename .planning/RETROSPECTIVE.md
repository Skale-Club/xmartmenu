# xmartmenu — Retrospective

## Milestone: v1.2 — AI Onboarding

**Shipped:** 2026-05-07
**Phases:** 3 | **Plans:** 8 | **Tasks:** 14

### What Was Built

- Phase 9: Gemini 2.5 Flash text seeding — 6 seed types (categories, products, copy, translations, per-item) via single `/seed` route with `type` discriminator. `sanitizeForPrompt()` + `ai_usage` + `revalidatePath` infrastructure shared across all 3 phases.
- Phase 10: Nano Banana 2 image seeding — `gemini-3.1-flash-image-preview` generates cover (4:1) and per-product (1:1) WebP photos, uploaded via Sharp to Supabase Storage. Separate route file required because `maxDuration` is file-scoped in Next.js.
- Phase 11: GPT-4.1-mini OCR — Two-step upload (signed URL → browser PUT → process POST) bypasses Vercel's 4.5 MB serverless limit. Structured JSON extraction via `generateText + Output.object`. `price = 0` as the AI-12 parse-failure signal.

### What Worked

- **Single AI Tools section pattern** — Extending the same `TenantDetailClient.tsx` AI Tools section across 3 phases kept the UI coherent and reduced planning overhead. Each phase added a sub-section without layout redesign.
- **Additive-only writes from Phase 1** — Locking this in Phase 9 meant Phases 10 and 11 inherited it without discussion. The "safe to re-run" property simplified UX significantly.
- **Route separation for maxDuration** — Discovering this constraint in Phase 10 research prevented a hard-to-debug production timeout issue.
- **Worktree isolation** — Running executor agents in isolated worktrees prevented file collisions during parallel execution.

### What Was Inefficient

- **Merge conflict resolution** — Using `git checkout --theirs` during Wave 2 merge lost Phase 10's image seeding UI, requiring a full restore pass before Phase 11 verification could pass. Future: check for active UI additions in the merge target before taking "theirs".
- **Nano Banana 2 model name** — The user used a codename during discuss-phase, requiring the researcher to identify the actual SDK model string. Could be faster if model IDs were settled during discuss-phase.
- **Wave 2 agent scope creep** — The Phase 11 Wave 2 executor pre-built Wave 3's UI, producing an out-of-scope SUMMARY that created a cleanup step. Minor but adds doc overhead.

### Patterns Established

- **Separate route files for long-running operations** — Text seed: 60s, Image seed: 300s. Never combine routes with different `maxDuration` requirements.
- **Two-step upload for large files** — Signed URL from GET endpoint → browser PUT → POST with storage path. Reuse this for any future file upload exceeding 4 MB.
- **`price ?? 0` pattern** — When an AI model may return null for numeric fields, default to 0 at DB write time rather than adding nullable columns.
- **Additive writes by case-insensitive name match** — Safe to re-run without creating duplicates. Use this for all AI seeding operations.

### Key Lessons

- Lock model IDs in discuss-phase (not codenames) to avoid researcher overhead.
- When resolving merge conflicts in files with additive multi-phase content, always diff both sides before taking "theirs" — you may be discarding valid prior-phase code.
- `maxDuration` is file-scoped in Next.js API routes — never mix short and long operations in the same route file.

### Cost Observations

- Model mix: Opus 4.7 orchestration, Sonnet subagents (researcher, planner, checker, executor, verifier)
- Sessions: 1 continuous session (multi-hour)
- Notable: 3-phase v1.2 milestone completed in a single session without context compaction

---

## Milestone: v1.3 — Landing Page

**Shipped:** 2026-05-07
**Phases:** 2 | **Plans:** 5 | **Tasks:** 10

### What Was Built

- Phase 12: Full static marketing landing page — 7 sections (nav, hero, how-it-works, features, FAQ, CTA, footer), `force-static` Server Components, middleware bypass for `/`, reserved-paths guard, Vercel Analytics + Speed Insights.
- Phase 13: SEO layer — `sitemap.ts` (MetadataRoute), `robots.ts` (correct Disallow rules), JSON-LD Organization + SoftwareApplication inline in page (not layouts), `opengraph-image.tsx` (32.6 KB PNG), `og:image` meta tag via explicit `openGraph.images` in root layout.

### What Worked

- **Wave-based parallel execution** — Phase 12 used 3 waves cleanly: infrastructure → landing page → OG image/legal. No merge conflicts.
- **`force-static` decision up front** — Locking this in discuss-phase prevented any accidental Supabase calls from sneaking into the marketing route.
- **Phase 13 was 2 plans, not 4** — Resisting the urge to over-plan SEO (sitemap + robots + JSON-LD all in one plan) kept execution tight.
- **Bug caught during verification** — The `og:image` meta tag issue (file convention blocked by explicit `openGraph` override) was found and fixed during the checkpoint, before it could ship silently broken.

### What Was Inefficient

- **`opengraph-image.tsx` placement confusion** — The agent moved the file from `(marketing)/` to root `src/app/` expecting the file convention to inject the meta tag, but it still didn't work due to the explicit `openGraph` object in the layout. Required a second fix (adding `openGraph.images` explicitly). Could have been caught earlier with a quick `curl | grep og:image` during task execution.
- **Server restart overhead** — Three build+restart cycles to confirm the og:image fix worked. A `next dev` preview with the actual metadata output would have been faster.

### Patterns Established

- **`opengraph-image.tsx` at root `src/app/`, not in route groups** — Route group placement serves the `/opengraph-image` route but Next.js does NOT inject `og:image` meta tag when a parent layout's explicit `openGraph` object overrides the file convention. Always add `openGraph.images` explicitly in root layout metadata.
- **JSON-LD via inline `dangerouslySetInnerHTML`, never `next/script`** — `next/script` causes RSC hydration duplication in React 19. Server Component + `dangerouslySetInnerHTML` is the correct pattern.
- **Reserved paths as a shared Set** — One `RESERVED_PATHS` constant used by both middleware and the onboarding API. Prevents tenant slug squatting on marketing paths without duplication.
- **Middleware bypass for static marketing route** — Always bypass `getUser()` for `/` via `publicRoutes` list; cost is Supabase latency on every visitor to the marketing page.

### Key Lessons

- When Next.js layouts export explicit `openGraph` objects, the `opengraph-image.tsx` file convention is overridden — always add `openGraph.images` explicitly in the layout metadata.
- After any build change affecting meta tags, run `curl http://localhost:3000/ | grep 'og:image'` before committing. Silent failures on OG tags are common and hard to catch later.
- `next/script` and JSON-LD do not mix in React 19 App Router — use inline `<script dangerouslySetInnerHTML>` in a Server Component.

### Cost Observations

- Model mix: Sonnet 4.6 orchestration + Sonnet subagents (executor, verifier)
- Sessions: 1 session
- Notable: 2-phase milestone completed fast; most time was the human verification checkpoint (og:image debug)

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Key Pattern |
|-----------|--------|-------|-------------|
| v1.0 Foundation | 3 | 6 | ISR, security, CI scaffolding |
| v1.1 Orders | 5 | 11 | Option groups, cart, checkout |
| v1.2 AI Onboarding | 3 | 8 | Multi-provider AI, additive seeding |
| v1.3 Landing Page | 2 | 5 | Static marketing page, SEO, og:image |

**Velocity trend:** Each milestone ships in a single session. v1.3 was the fastest (2 phases, 5 plans) — smaller, more focused scope. Plan density is consistent (~2 tasks/plan).

**Architecture pattern:** New capabilities are consistently added as isolated API routes + `TenantDetailClient.tsx` section extensions (v1.0–v1.2). v1.3 broke this pattern by introducing the `(marketing)` route group — the first milestone that is purely frontend/marketing, not adding admin capability.

**Recurring failure mode:** One "silent failure" per milestone that is only caught at verification: v1.2 had merge conflict data loss; v1.3 had the `og:image` meta tag not being injected. Both were caught before shipping. Adding a "smoke test the key deliverable" step to verification plans would catch these earlier.
