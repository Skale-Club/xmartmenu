# Phase 14 Baseline — Pre-Optimization Metrics

**Captured:** 2026-05-07
**Production URL:** https://xmartmenu.skale.club/
**Git commit at measurement:** 7db3266 (main — Phase 14 Plan 02 complete)
**Measurement date:** 2026-05-07

> These are the BEFORE values. Phase 15 and 16 improvements must beat these numbers.
> Phase 15 reads the Supabase Query Timing section. Phase 16 reads all three sections.

---

## Lighthouse Scores (PageSpeed Insights — Mobile)

**Tool:** PageSpeed Insights synthetic Lighthouse, mobile emulation (Moto G Power, slow 4G throttling)
**Tab:** Mobile (binding metric per D-08)
**Note:** Desktop scores not measured — mobile is the binding metric per project decision D-08.

| Route | URL | Mobile Perf | FCP | LCP | TBT | CLS | SI | A11y | Best Pract. | SEO |
|-------|-----|------------|-----|-----|-----|-----|----|------|-------------|-----|
| Landing page | https://xmartmenu.skale.club/ | **100** | 0.9s | 1.5s | 90ms | 0 | 1.5s | 96 | 100 | 100 |
| Tenant slug | https://xmartmenu.skale.club/restaurante-teste | **94** | 1.0s | 3.0s | 20ms | 0 | 2.3s | 88 | 100 | 100 |

**Vercel Speed Insights:** No real-traffic data — no p75 CWV data available at measurement time. App has no sustained production traffic yet. Rely on PageSpeed Insights synthetic data above.

### CWV Threshold Assessment

| Metric | Good | Needs Improvement | Poor | Landing (/) | Slug (/{slug}) |
|--------|------|------------------|------|-------------|----------------|
| LCP | < 2.5s | 2.5s – 4.0s | > 4.0s | 1.5s (GOOD) | 3.0s (NEEDS IMPROVEMENT) |
| CLS | < 0.1 | 0.1 – 0.25 | > 0.25 | 0 (GOOD) | 0 (GOOD) |
| INP | < 200ms | 200ms – 500ms | > 500ms | N/A* | N/A* |
| TBT (proxy) | < 200ms | 200ms – 600ms | > 600ms | 90ms (GOOD) | 20ms (GOOD) |

*INP not reported by PageSpeed Insights in this run — requires real-user measurement.

### Observations

1. **Landing page (/) is already optimal** — Score 100, all CWV in GOOD range. Phase 16 should not focus here.
2. **/{slug} tenant landing page is the Phase 16 priority** — Score 94, LCP 3.0s is in NEEDS IMPROVEMENT range (threshold: < 2.5s). The 0.5s gap to the 2.5s threshold must be closed.
3. **Primary blocker on /{slug}: image delivery** — PSI reports "Improve image delivery — Est savings of 889 KiB" as a critical finding. This single issue likely explains the LCP 3.0s reading (LCP element is an image that must download before paint).
4. **Secondary findings on /{slug}:** Legacy JavaScript (14 KB savings), forced reflow, LCP request discovery, DOM size optimization.
5. **Accessibility gaps on /{slug}:** Score 88 — buttons missing accessible names, insufficient color contrast, no `<main>` landmark element. These are separate from performance but should be addressed in Phase 16 UI pass.
6. **Accessibility gap on landing page:** Score 96 — minor issues, not blocking.

### Phase 16 Lighthouse Target

- `/{slug}` must reach Mobile Performance >= 90 (currently 94 — already above 90, but LCP 3.0s must drop below 2.5s)
- Primary lever: fix 889 KB image delivery (format conversion, sizing, lazy-load)
- Secondary lever: chunk 5536 lazy-load (see Bundle Analysis section)

---

## Bundle Analysis (@next/bundle-analyzer)

**Run command:** `ANALYZE=true npm run build --webpack` (Turbopack incompatible — must use `--webpack` flag)
**Run date:** 2026-05-08
**Reports generated:** `.next/analyze/client.html`, `.next/analyze/edge.html`, `.next/analyze/nodejs.html`

### Top 5 Client-Side Chunks

| # | Chunk Name | Size (KB) | Type | Lazy-Load Candidate |
|---|-----------|-----------|------|---------------------|
| 1 | `3794-0147154ca0a4b9c9.js` | 216.2 | vendor | No — Next.js App Router shared runtime (navigation, router internals); critical path, cannot be deferred |
| 2 | `4bd1b696-c2f6e0877b6c10aa.js` | 195.2 | vendor | No — react-dom; framework core required for hydration on every page |
| 3 | `framework-d1de002210ddaaef.js` | 185.2 | vendor | No — React + scheduler; framework bundle, cannot be lazy-loaded without breaking the app |
| 4 | `5536-037bccf2959a697c.js` | 170.1 | shared | **YES** — Large unnamed shared vendor chunk; not a named framework; likely contains Supabase JS or AI SDK fragments pulled into client scope unexpectedly. Investigate module composition in Phase 16. |
| 5 | `main-e29141c4c21a375c.js` | 128.3 | vendor | No — Next.js main entry (hydration bootstrap); loaded before any JS runs, cannot defer |

**Additional chunks (context):**

| # | Chunk Name | Size (KB) | Type | Lazy-Load Candidate |
|---|-----------|-----------|------|---------------------|
| 6 | `polyfills-42372ed130431b0a.js` | 110.0 | vendor | No — Browserslist polyfills; loaded before app bootstrap |
| 7 | `44530001-ecf249e00c31b579.js` | 51.7 | shared | Yes — unnamed shared UI component bundle (likely Tailwind utilities, clsx, form components); splitting candidate if non-critical on landing render |

**Total non-deferrable client JS (chunks 1-3 + main + polyfills):** ~819 KB uncompressed

**Named route-specific chunks (admin — all lazy-load by definition):**

| Route | Chunk | Size (KB) |
|-------|-------|-----------|
| /menu/products/[id] | page-0cd17edb88e56f76.js | 23.1 |
| /superadmin/tenants | page-03d4a2ab4cbfdab6.js | 21.7 |
| /superadmin/tenants/[id] | page-3beba05f7deba5e6.js | 20.2 |
| /menu/products | page-3aa726b16dd2ef5d.js | 15.8 |
| /superadmin/settings | page-c4a5949eb2f7debe.js | 13.8 |

### Observations

1. **Chunk #4 (5536, 170 KB) is the only non-framework lazy-load candidate in the top 5.** Chunks 1-3, main, and polyfills are non-negotiable framework overhead.
2. **Chunk #4 composition is unknown** — it is an unnamed shared chunk that does not match any framework package. High probability it contains Supabase JS client or AI SDK fragments that have leaked into the client bundle via `use client` boundaries. Requires `client.html` treemap inspection in Phase 16 to confirm composition.
3. **Framework baseline is 819 KB uncompressed** — this is the floor. Any optimization work acts on top of this.
4. **Admin route chunks are small (13-23 KB)** — already lazy-loaded by route splitting. No additional action needed there.
5. **Phase 16 primary bundle action:** Investigate chunk 5536 composition. If it contains server-only dependencies (Supabase server client, AI SDK), move them behind `import()` dynamic boundary or ensure they are not referenced by any `use client` component.

---

## Supabase Query Timing (console.time)

**Measurement method:** Temporary `console.time()` / `console.timeEnd()` probes added at route-handler level in 3 server-side files. Probes deployed in commit `070cefa`, then removed in commit `8a9e4a6`. Timing values visible in Vercel function logs per-invocation.

**Status: ALL VALUES DEFERRED** — User chose not to trigger Vercel log sessions during Plan 02 execution. Probes were deployed to production and then removed cleanly. Timings are not available from this measurement round.

| Route | Query Label | Time (ms) | Notes |
|-------|-------------|-----------|-------|
| `/{slug}/{menuSlug}` | `perf:menu-slug:tenant-lookup` | N/A | Deferred — user will measure later via Vercel logs |
| `/{slug}/{menuSlug}` | `perf:menu-slug:categories-products` | N/A | Deferred — user will measure later via Vercel logs |
| `/{slug}` | `perf:menu-tenant:lookup` | N/A | Deferred — user will measure later via Vercel logs |
| `/{slug}` | `perf:menu-tenant:default-menu` | N/A | Deferred — user will measure later via Vercel logs |
| `POST /api/orders` | `perf:orders-post:tenant-validate` | N/A | Deferred — user will measure later via Vercel logs |
| `POST /api/orders` | `perf:orders-post:insert` | N/A | Deferred — user will measure later via Vercel logs |
| `POST /api/orders` | `perf:orders-post:insert-items` | N/A | Deferred — user will measure later via Vercel logs |

**How to measure later:** Re-add the `console.time()` probes from `070cefa` (or re-run Plan 02), trigger the routes with real requests, then read Vercel function logs. Labels follow pattern `perf:{route}:{operation}`.

### Observations

1. **No DB timing baseline is available** — Phase 15 must proceed without query timing data. This means Phase 15 must use EXPLAIN ANALYZE (query planner cost, not wall-clock time) as its primary signal for index necessity.
2. **EXPLAIN ANALYZE is sufficient** — Wall-clock timing is secondary. A Seq Scan on the `tenants` table (likely for tenant lookup by slug) is structurally wrong regardless of current timing. Phase 15 should fix all Seq Scans on high-cardinality lookups.
3. **LCP 3.0s on /{slug} corroborates slow DB layer** — Even without timing numbers, the 3.0s LCP suggests that the server-side `/{slug}` route is slow to respond, which implicates the DB queries. Phase 15 should treat `/{slug}` (tenant lookup + default menu) and `/{slug}/{menuSlug}` (tenant + categories + products) as the highest-priority query paths.

---

## Phase 15 and 16 Targets

### Phase 15: Database Indices

| Target | Description | Priority |
|--------|-------------|----------|
| EXPLAIN ANALYZE on `/{slug}` tenant lookup | Confirm `tenants.slug` lookup uses Index Scan, not Seq Scan | HIGH |
| EXPLAIN ANALYZE on `/{slug}/{menuSlug}` queries | Confirm menu, categories, products queries use indexed joins | HIGH |
| EXPLAIN ANALYZE on `POST /api/orders` | Confirm orders INSERT path is not blocked by Seq Scan on large tenant validation | MEDIUM |
| Apply indices for any Seq Scans found | Create index via Supabase SQL editor, verify with follow-up EXPLAIN ANALYZE | HIGH |
| Document in migration comment | Each index gets a comment referencing the Phase 15 plan and route it accelerates | REQUIRED |

**Success condition:** All EXPLAIN ANALYZE outputs for the three critical paths show Index Scan (not Seq Scan) on high-cardinality columns.

### Phase 16: Frontend Performance

| Target | Current | Goal | Gap | Primary Lever |
|--------|---------|------|-----|---------------|
| Mobile Performance — `/{slug}` | 94 | >= 90 | Already above 90 — but LCP must improve | Image delivery (889 KB savings) |
| LCP — `/{slug}` | 3.0s | < 2.5s | -0.5s | Image format (WebP/AVIF), sizing, loading="lazy" below fold |
| Mobile Performance — `/` | 100 | >= 90 | No gap — already optimal | No action needed |
| LCP — `/` | 1.5s | < 2.5s | No gap | No action needed |
| Chunk 5536 | 170.1 KB | Reduce or eliminate | Investigate composition | dynamic() import or server-only guard |

**Primary optimization lever for Phase 16:**
1. **Image delivery** — Fix 889 KB image delivery issue (convert to WebP/AVIF, right-size images, add `sizes` attribute, ensure LCP image is not lazy-loaded). This is the dominant issue on `/{slug}`.
2. **Chunk 5536** — Investigate and eliminate server-only dependencies leaking into client bundle. 170 KB is significant for a non-framework shared chunk.

**Accessibility targets for Phase 16 (/{slug} — score 88):**
- Add accessible names to all buttons (aria-label or visible text)
- Fix color contrast ratios on text elements
- Add `<main>` landmark element to tenant layout

---

*Baseline captured: 2026-05-07*
*Plans that produced this data: 14-01 (bundle), 14-02 (timings — deferred), 14-03 (Lighthouse)*
*Next: Phase 15 reads Supabase Query Timing section. Phase 16 reads all sections.*
