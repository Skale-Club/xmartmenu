# Phase 9: Text Seeding — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 09-text-seeding
**Areas discussed:** Onboarding integration, Superadmin UI placement, LLM provider, Bilingual strategy, Existing data handling

---

## Scope Pivot (mid-discussion)

During discussion it emerged that the original milestone scope (tenant-facing AI with review screens) did not match the intended product. Scope was corrected mid-discussion:

| Original | Revised |
|---|---|
| AI in tenant onboarding flow | Superadmin panel only |
| Mandatory review screen before DB write | Direct to DB; regular admin UI is the editor |
| Per-tenant feature flags | Not needed (superadmin capability) |
| Draft persistence (24h) | Not needed (no review state) |

REQUIREMENTS.md and ROADMAP.md were updated before CONTEXT.md was written.

---

## Onboarding Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Replaces steps 3+4 | AI seeding as default onboarding path | |
| Toggle opt-in | Tenant chooses manual vs AI at step 1 | (initial answer) |
| Optional booster after manual | AI expansion after manual steps | |
| Scope pivot: superadmin only | AI not in tenant onboarding at all | ✓ |

**User's choice:** "só nós, os donos do sistema" — superadmin only, not tenant-facing  
**Notes:** Onboarding flow (/onboarding/page.tsx) is untouched in v1.2

---

## Review Screen

| Option | Description | Selected |
|--------|-------------|----------|
| Tela de review antes de salvar | Preview → approve/reject → then DB write | |
| Direto na DB, edita no admin | AI generates → writes to DB → tenant edits in regular admin | ✓ |

**User's choice:** Direct to DB  
**Notes:** The regular admin UI is the editor for corrections; no separate review component needed

---

## Superadmin UI Placement

| Option | Description | Selected |
|--------|-------------|----------|
| New section on existing page | "AI Tools" section at bottom of /(superadmin)/tenants/[id] | ✓ |
| Dedicated sub-route /seed | Separate page for AI operations | |
| Sidebar drawer | Slide-in overlay | |

**User's choice:** New section on existing tenant detail page

---

## Bulk Seed Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| One "Seed menu" button | Single action generates everything | |
| Separate per section | Seed categories / products / copy independently | |
| Both | "Seed menu" bulk button AND separate per-section buttons | ✓ |

**User's choice:** Both bulk and per-section  
**Notes:** Also per-item "Seed" button next to individual "Add category" / "Add product" inputs

---

## LLM Provider

| Option | Description | Selected |
|--------|-------------|----------|
| Claude Haiku 4.5 (Anthropic) | Research recommendation for text/copy | |
| GPT-4.1-mini (OpenAI) | Single provider with OCR/images | |
| Gemini 2.5 (Google) | User choice — default model | ✓ |

**User's choice:** Gemini 2.5 via `@ai-sdk/google`  
**Notes:** OCR stays on OpenAI GPT-4.1-mini vision; images stay on gpt-image-1-mini

---

## Bilingual Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Same LLM call, all languages | Prompt returns all enabled locales as JSON | ✓ |
| Separate call per language | One call per locale | |
| EN only | Superadmin manually translates other languages | |

**User's choice:** Single call with all enabled languages  
**Notes:** Read tenant's enabled languages before prompting; return `{ "en": "...", "pt": "..." }` structure

---

## Existing Data Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Skip existing, add new | Never overwrite; safe to run multiple times | ✓ |
| Overwrite everything | Full reseed from scratch | |
| Ask superadmin | Prompt before seeding if data exists | |

**User's choice:** Skip existing, add new

---

## Claude's Discretion

- Exact Gemini 2.5 model variant (Flash vs Pro)
- Number of products generated per category
- Whether `ai_usage` gets a UI in Phase 9 or later
- Structure of API route(s) for seed operations

## Deferred Ideas

- Superadmin cost dashboard — post-Phase 9
- Draft/undo — direct-to-DB, no drafts
- Per-tenant feature flags — not needed (superadmin capability)
