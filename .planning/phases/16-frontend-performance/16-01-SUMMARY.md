---
phase: 16-frontend-performance
plan: "01"
subsystem: frontend
tags: [next/image, performance, lcp, accessibility, a11y]
dependency_graph:
  requires: [14-instrumentacao/14-BASELINE.md]
  provides: [MenuPage.tsx with next/image, main landmark, aria-labels]
  affects: [src/components/menu/MenuPage.tsx]
tech_stack:
  added: []
  patterns: [next/image fill layout, next/image fixed-dimension, sizes attribute, priority preload]
key_files:
  created: []
  modified:
    - src/components/menu/MenuPage.tsx
decisions:
  - Banner uses fill + priority (LCP element, above fold, position:absolute parent)
  - Logo uses width=80 height=80 + priority (fixed-size, above fold)
  - Featured carousel and ProductCard use fill + relative parent + sizes
  - ProductModal uses fill (parent already had relative)
  - div -> main for product listing area (single correct landmark)
  - Search toggle aria-label dynamic text Open search / Close search
  - Hours button aria-label explicit (matches visible text)
metrics:
  duration: "~10min"
  completed: "2026-05-07"
  tasks: 2
  files: 1
requirements:
  - FE-02
  - FE-01
---

# Phase 16 Plan 01: next/image Migration + A11y Fixes Summary

**One-liner:** All raw `<img>` tags in MenuPage.tsx replaced with next/image (WebP/AVIF, priority preload on LCP elements, proper sizes hints); `<main>` landmark and aria-labels added to close a11y gaps.

---

## What Was Built

Replaced 4 raw `<img>` tags in `src/components/menu/MenuPage.tsx` with `next/image` components. Added `<main>` semantic landmark and `aria-label` attributes to icon-only buttons.

---

## Image Replacements (img -> Image)

| Location | Before | After | Key Props |
|----------|--------|-------|-----------|
| Header banner (~line 325) | `<img src={settings.banner_url} ...>` | `<Image fill priority sizes="100vw" className="object-cover" />` | fill, priority (LCP), sizes=100vw |
| Header logo (~line 333) | `<img src={settings.logo_url} ...>` | `<Image width={80} height={80} priority className="rounded-xl object-cover bg-white/10 p-1" />` | fixed 80x80, priority (above fold) |
| Featured carousel card (~line 480) | `<img src={...} className="w-full h-full object-cover">` | `<Image fill className="object-cover" sizes="(max-width: 640px) 160px, (max-width: 1024px) 192px, 224px" />` | fill, lazy (default), card-width sizes |
| ProductCard function (~line 718) | `<img src={images[0]} className="w-full h-full object-cover block">` | `<Image fill className="object-cover" sizes="(max-width: 768px) 50vw, 25vw" />` | fill, lazy, grid sizes |
| ProductModal function (~line 866) | `<img src={images[imageIndex]} style={{ transform }}...>` | `<Image fill className="object-cover ..." style={{ transform }} sizes="(max-width: 768px) 100vw, 448px" />` | fill, style passthrough, modal sizes |

Parent divs updated to add `relative` positioning class where missing (featured carousel, ProductCard). ProductModal parent already had `relative`.

---

## A11y Fixes

| Fix | Location | Before | After |
|-----|----------|--------|-------|
| `<main>` landmark | ~line 460 | `<div className="w-full px-4 ...">` | `<main className="w-full px-4 ...">` (+ closing `</main>`) |
| Search icon button | ~line 409 | No aria-label; raw SVG/emoji | `aria-label={showSearch ? 'Close search' : 'Open search'}` + `aria-hidden="true"` on icon children |
| Hours button | ~line 367 | No aria-label (has visible text) | `aria-label={ui.hoursBtn}` added explicitly |

---

## TypeScript Check Result

`npx tsc --noEmit` exits 0 — no new TypeScript errors introduced.

---

## Build Result

`npm run build` — Compiled successfully in 9.8s. All routes static/dynamic as expected. No errors or warnings from next/image configuration.

---

## FE-01 Status

FE-01 (landing page `/` performance) was satisfied by the Phase 14 baseline — score 100, LCP 1.5s, all CWV in GOOD range. No code change was required or made for `/`. This plan targets FE-02 (tenant slug `/{slug}` image delivery, LCP fix).

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None. All image replacements are fully wired with real src URLs from product/tenant data.

---

## Self-Check: PASSED

- `grep "<img" src/components/menu/MenuPage.tsx` -> no matches (0 img tags)
- `grep "import Image from 'next/image'" src/components/menu/MenuPage.tsx` -> 1 match
- `grep "<main" src/components/menu/MenuPage.tsx` -> 1 match
- Task 1 commit: a6e0e46
- Task 2 commit: 792ca27
- Both commits verified via `git log --oneline -4`
