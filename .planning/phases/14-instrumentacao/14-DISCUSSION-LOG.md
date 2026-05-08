# Phase 14: Instrumentação — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 14-instrumentacao
**Areas discussed:** Supabase query timing, Baseline format, Route priority

---

## Mode

User delegated all decisions: "faca o ideal para o projeto" — Claude selected the ideal approach for each area based on project constraints (Supabase managed free tier, Vercel deployment, no local Docker).

---

## Supabase Query Timing

| Option | Description | Selected |
|--------|-------------|----------|
| pg_stat_statements only | Supabase dashboard query, no code changes | |
| console.time() only | Server-side logging in route handlers | |
| Two-layer (pg_stat_statements + console.time) | DB-level aggregate + route-level per-request | ✓ |
| Supabase client wrapper | Wrap createClient to intercept all queries | |

**Selected:** Two-layer approach
**Notes:** pg_stat_statements gives aggregate view without code changes. console.time() in routes gives per-request context visible in Vercel logs. Probes are temporary — added and removed in same plan.

---

## Baseline Documentation Format

| Option | Description | Selected |
|--------|-------------|----------|
| Comment in ROADMAP.md | Inline, no extra file | |
| CONTEXT.md of next phase | Embedded in Phase 15/16 context | |
| Dedicated 14-BASELINE.md | Standalone file, referenceable by both Phase 15 and 16 | ✓ |

**Selected:** Dedicated `14-BASELINE.md`
**Notes:** Single source of truth that both Phase 15 (DB) and Phase 16 (Frontend) can reference independently.

---

## Route Priority

| Option | Description | Selected |
|--------|-------------|----------|
| Landing page first | / is the marketing entry point | |
| Public menu first | /{slug}/{menuSlug} is what restaurant customers use | ✓ |
| Both simultaneously | Audit all routes in parallel | |

**Selected:** Public menu first, then landing
**Notes:** Landing is force-static — expected to be fast already. Public menu has DB queries and client JS — higher risk of performance issues.

---

## Claude's Discretion

- Exact placement of console.time() probes within route handlers
- Which SQL queries to run against pg_stat_statements
- Specific format for baseline entries
