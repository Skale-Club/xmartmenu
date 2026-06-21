---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: CRM & Integrations
status: defining requirements
stopped_at: Milestone v2.4 started
last_updated: "2026-06-20T00:00:00.000Z"
last_activity: 2026-06-20 -- Milestone v2.4 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-25)

**Core value:** A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.
**Current focus:** v2.4 CRM & Integrations — defining requirements (Xphere CRM Sync)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-20 -- Milestone v2.4 started

## Milestone Overview

v2.4: CRM & Integrations — first focus: Xphere CRM Sync (mirror every tenant into the dedicated Xphere CRM org as Account + Contact + Opportunity).

Roadmap pending (run requirements → roadmapper).

**Paused — v2.3 Brand & Marketing Refresh** (resume later or in parallel). Phases preserved in ROADMAP.md:

| Phase | Name | Seeds | Status |
|---|---|---|---|
| 45 | Icon Resolver Fix | SEED-025 | ✓ Complete |
| 46 | Global Color Rebrand | SEED-026 | ○ Paused |
| 47 | Features Section Layout | SEED-027 | ○ Paused |
| 48 | CTA Full-Bleed + Background Image | SEED-028 | ○ Paused |
| 49 | DB Seeds — Color & Branding Defaults | SEED-029 | ○ Paused |

## Accumulated Context

### Decisions

- [v2.3 Roadmap]: Color rebrand is atomic — must ship as one commit or dark text appears on red buttons everywhere
- [v2.3 Roadmap]: `--primary-foreground` flips from `#09090b` to `#ffffff` because `#F52323` luminance L ≤ 0.4 (WCAG)
- [v2.3 Roadmap]: `text-zinc-950` replacement is surgical — only where paired with `bg-primary`, not global
- [v2.3 Roadmap]: `FoodDrinkCombo` return type is `React.ComponentType<{ className?: string }>` not `LucideIcon` — custom component
- [v2.3 Roadmap]: CTA section `overflow-hidden` on card required to clip background image to `rounded-[2rem]`
- [v2.3 Roadmap]: CTA padding moved from section to content wrapper inside card — section px-8 removal + card full-width must be one atomic edit
- [v2.3 Roadmap]: Hero "built for service." gradient structure unchanged — only `via-yellow-200` → `via-red-200`
- [v2.3 Roadmap]: Features grid icon swap uses component reference (`FoodDrinkCombo`), not string `'FoodDrink'`
- [v2.3 Roadmap]: Phase 49 (DB seeds) blocked until Phases 45–48 are visually confirmed — `FoodDrink` name invalid before SEED-025 ships
- [Phase 45]: Marketing landing icons must resolve by DB string name, not array index, so admin edits actually appear on the live page
- [Phase 45]: `FoodDrinkCombo` strips incoming `w-*`/`h-*` utility classes before rendering `Sandwich` + `CupSoda`, preserving container sizing and color classes
- [Phase 45]: `FoodDrink` remains an internal marketing resolver key; superadmin picker exposes `Sandwich` and `CupSoda` separately

### Pending Todos

None — Phase 46, 47, and 48 are ready; Phase 49 remains blocked on visual confirmation.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-05-25
Stopped at: Milestone v2.3 initialized

---

**Project Status: IN DEVELOPMENT**

| Item | Status |
|---|---|
| Seeds | SEED-025 through SEED-029 planted and revised |
| Milestones | 13 shipped (v1.0 → v2.2), 1 starting (v2.3) |
| Phases | 44 shipped, 5 planned (Phases 45-49) |
| Blockers | None |
