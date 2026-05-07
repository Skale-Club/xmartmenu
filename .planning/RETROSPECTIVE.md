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

## Cross-Milestone Trends

| Milestone | Phases | Plans | Key Pattern |
|-----------|--------|-------|-------------|
| v1.0 Foundation | 3 | 6 | ISR, security, CI scaffolding |
| v1.1 Orders | 5 | 11 | Option groups, cart, checkout |
| v1.2 AI Onboarding | 3 | 8 | Multi-provider AI, additive seeding |

**Velocity trend:** Each milestone ships in a single session. Plan density has increased (2–3 tasks/plan), but execution time per plan has stayed roughly constant (~15–30 min).

**Architecture pattern:** New capabilities are consistently added as isolated API routes + `TenantDetailClient.tsx` section extensions. This pattern has scaled cleanly across v1.0→v1.2 without requiring layout redesigns.
