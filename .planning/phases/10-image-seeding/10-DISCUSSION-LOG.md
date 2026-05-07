# Phase 10: Image Seeding — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 10-image-seeding
**Areas discussed:** Image generation model, Execution environment, Cover photo style, Per-product image strategy, UI feedback / polling

---

## Image Generation Model & Source

| Option | Description | Selected |
|--------|-------------|----------|
| `gpt-image-1-mini` (OpenAI) | Original roadmap choice | |
| Gemini `gemini-2.5-flash-image` | Fastest/cheapest, 1024px max | |
| Gemini `gemini-3.1-flash-image-preview` | Better quality, 512–4K, thinking mode | ✓ |
| Gemini `gemini-3-pro-image-preview` | Highest quality, expensive, slow | |
| Stock photo services (Pexels/Unsplash) | Free-tier APIs, per-product search | |

**User's choice:** All images AI-generated via `gemini-3.1-flash-image-preview`. No stock photo services. Switched from gpt-image-1-mini to Gemini to stay on a single provider.

**Notes:** User shared Gemini image generation API docs during discussion. `@google/genai` SDK needed (not `@ai-sdk/google` which is text-only).

---

## Execution Environment

| Option | Description | Selected |
|--------|-------------|----------|
| Vercel serverless function | Synchronous, 60s (Hobby) / 300s (Pro) max | |
| GitHub Actions workflow | No timeout constraints, triggered via GitHub API | ✓ |
| Background queue (e.g. Upstash QStash) | Managed queue, adds complexity | |

**User's choice:** GitHub Actions. Vercel timeouts too short for cover + N products in sequence.

---

## Cover Photo Style

| Option | Description | Selected |
|--------|-------------|----------|
| Restaurant interior, generic | Warm, inviting, professional | ✓ |
| Food spread / hero dish | Showcase food, not space | |
| Abstract / branded | Logo-style, minimal | |
| Real restaurant photo upload | Existing feature, manual | (separate feature, not AI seeding) |

**User's choice:** Generic restaurant interior. Real photo upload is a separate existing feature that takes priority.

---

## Per-Product Image Prompt Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit prompt rules (user-defined) | Fixed format, predictable | |
| Claude's discretion | Planner decides based on best practices | ✓ |

**User's choice:** Leave prompt construction to Claude's discretion. Likely product name + category + business type, food photography style.

---

## UI Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget | Button triggers, superadmin refreshes manually | |
| Polling | UI polls status endpoint every ~3s until complete/failed | ✓ |
| Streaming / SSE | Real-time progress stream | |

**User's choice:** Polling via a new `ai_jobs` table and status endpoint.

---

## Claude's Discretion

- Exact Gemini prompt text for cover and per-product images
- Parallel vs sequential image generation within GH Actions
- GH Actions trigger type (`workflow_dispatch` vs `repository_dispatch`)
- Polling interval and timeout values in UI
- Whether `ai_jobs` is a new migration or extends `ai_usage`

## Deferred Ideas

- Real restaurant photo as primary path (separate existing feature)
- Content moderation before storage
- Per-tenant rate limiting on image generation
- Superadmin preview before commit
