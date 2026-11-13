# AGENTS.md - xmartmenu (product name: Xprout)

<!-- journal-protocol:v1 -->
## Journal (mandatory)

This app's history (what it does, how each part was built, decisions and releases) lives in its Notion Journal. It replaces the old GSD/PAUL planning flow; `.planning/` and `.paul/`, if present, are a read-only legacy archive.

- Journal hub: https://app.notion.com/p/411b7a686121818a851dcc83876c9f16
- Journal Entries data source: collection://4359cbb5-d8d4-4929-9e01-87096c8a474c
- Latest view: view://411b7a68-6121-8171-bbb6-000cf6f5f372
- Entry prefix: XMM
- Rules (they win on any conflict): https://app.notion.com/p/411b7a68612181b3ac36f4ce2b2c3850 (skill: `app-journal`)

**Start of session:** fetch the hub and read Identity and Current State; list the latest 20 entries with Notion query-data-sources in `view` mode on the Latest view above (`page_size` 20; view mode has no plan quota) and read only titles and summaries; use `rows` mode with a filter only to narrow down (it has a plan quota); if a read fails, say so and continue from the code, never guess journal content; open only the entries you need; never read the whole database. Cross-check with the code: the code is the fact.

**End of every task that changed code, behavior, infrastructure or a decision:**
1. Create ONE entry in the data source above (one per logical unit of work, not per commit): `Title` = `YYYY-MM-DD — <imperative summary>`, `date:Date:start` (YYYY-MM-DD, with `date:Date:is_datetime` = 0), `Type`, `Area` (JSON array of existing options), `Status`, `Summary` (max 280 characters), `Agent`, `Model`, `Repo / Branch`, `Commits / PR`, `Tests` (what ran, or "Not run"), and `Decision ID` / `Decision Status` when a choice was made.
2. Body headings: Context · What changed · How it was built · Decisions and why · Tests and evidence · Not done / risks · Next.
3. If the app changed, rewrite the affected part of the hub's Current State. Read back what you wrote; never report a write you did not see.
4. Notion unavailable: append the full entry to `docs/journal/PENDING-NOTION.md` and tell the owner.

Journal records are in English. No secrets.
<!-- /journal-protocol -->

<!-- universal-rules:v1 -->
## Universal rules (read first)

Before working, read the owner's universal agent rules: `$HOME/Dev/skaleclub-apps/agents/RULES.md`
(GitHub: https://github.com/Skale-Club/skaleclub-apps/blob/main/agents/RULES.md).
They cover model routing (the session model plans and validates, cheaper models execute), machine awareness (Surface = light mode, `machine-check.ps1`), delivery estimates with no silent stalls, and the database, login, git and language decisions. Keep it light: they help, never block.
This file adds only what is specific to this repository.
<!-- /universal-rules -->

<!-- media-policy:v1 -->
## Media optimization (mandatory)

Follow [the application-wide media policy](docs/product/media-policy.md) for every
image and video across all tenants, screens, uploads, AI generation, imports,
scripts, checked-in assets and production edits. Optimize and verify actual
encoded byte limits before publication; staging is not publication. Never
publish an unoptimized original when conversion fails or is unavailable.
Use responsive/CDN delivery, lazy media and optimized posters, and protect
ingestion with bounded input, queues, concurrency and compute/resource limits.
Format-specific assets still need explicit budgets. The policy records current
implementation gaps; do not claim they are fixed. New paths must enforce it.
Profile changes need evidence/tests and a Journal decision; never add a silent
bypass. Existing production/release authorization rules apply.
<!-- /media-policy -->


<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
<!-- ui-consistency:v1 -->
## Customer menu design consistency (mandatory)

Follow [the shared customer-menu design contract](docs/product/design-consistency.md)
when reviewing or changing cards, feed, product detail, AR, cart, checkout or
related customer surfaces. Keep pricing format/semantics, tenant colour roles,
the Inter/menu font stack, role-based typography, control dimensions, icons,
spacing and feedback coherent across equivalent views. Respect menu capabilities:
read-only menus must not acquire cart actions. Review the related screens
together; document rollout gaps instead of claiming global alignment is complete.
<!-- /ui-consistency -->
