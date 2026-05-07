# Phase 12: Core Landing Page — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace `src/app/page.tsx` (currently a bare `redirect('/auth/login')`) with a complete static marketing landing page. Add middleware bypass so `/` never hits the Supabase auth network call. Add reserved-path guard so tenant slugs cannot shadow marketing route names. Install Vercel Analytics and Speed Insights.

Sections in scope: Hero, How It Works, Feature Blocks (4), FAQ, Footer.
Sections out of scope for this phase: Pricing, Social Proof, Demo link (deferred).

</domain>

<decisions>
## Implementation Decisions

### Route Architecture
- **D-01:** Create a `(marketing)` route group: `src/app/(marketing)/layout.tsx` + `src/app/(marketing)/page.tsx`. This moves the landing page out of the root layout, giving it an isolated `<html lang="en">`, its own font config, its own metadata, and a clean CSS bundle with no admin/SaaS styles bleeding in. The root `src/app/page.tsx` becomes a passthrough that re-exports the marketing page OR is simply replaced by the route group — Next.js resolves `(marketing)/page.tsx` as the root `/` route.
- **D-02:** `src/app/(marketing)/page.tsx` exports `export const dynamic = 'force-static'` — fully static, served from Vercel CDN edge with ~10ms TTFB.
- **D-03:** `src/app/(marketing)/layout.tsx` sets `<html lang="en">` (landing page is English), uses Inter with `display: 'swap'`, sets page-level metadata (`title`, `description`, `metadataBase`, `openGraph`, `twitter`). Analytics components (`<Analytics />`, `<SpeedInsights />`) added here as last children in `<body>`.

### Middleware Bypass (Critical — Lighthouse Gate)
- **D-04:** Add marketing route bypass at the TOP of `updateSession()` in `src/lib/supabase/middleware.ts`, before the Supabase client is created:
  ```typescript
  const MARKETING_PATHS = ['/', '/sitemap.xml', '/robots.txt']
  const isMarketing = MARKETING_PATHS.includes(pathname) || pathname.startsWith('/opengraph-image')
  if (isMarketing) return NextResponse.next({ request })
  ```
  This removes the 50–200ms Supabase Auth network call from all marketing routes. Without this, Lighthouse mobile cannot reach 90.

### Reserved Paths Guard
- **D-05:** Create `src/lib/marketing/reserved-paths.ts` exporting a `RESERVED_PATHS: Set<string>`:
  ```typescript
  export const RESERVED_PATHS = new Set([
    'pricing', 'features', 'about', 'faq', 'blog', 'demo', 'help', 'support',
    'pt', 'en', 'legal', 'privacy', 'terms', 'contact', 'careers',
    'auth', 'api', 'onboarding', 'dashboard', 'menu', 'settings',
    'overview', 'tenants', 'users', 'admin', 'superadmin',
  ])
  ```
- **D-06:** In `updateSession()`, after the marketing bypass, add: if the first path segment is in `RESERVED_PATHS`, return `NextResponse.next()` (let App Router resolve it — it will 404 if no route exists, or serve the marketing route if one does). This does NOT block tenant access; it prevents new tenants from registering reserved slugs.
- **D-07:** In the onboarding API (`src/app/api/onboarding/route.ts`), add slug validation: if `slugify(companyName)` is in `RESERVED_PATHS`, return 400 with error "This name is reserved".

### Packages
- **D-08:** Install `@vercel/analytics@2.0.1` and `@vercel/speed-insights@2.0.0`. Import from `/next` subpath (not `/react`) for App Router route-change tracking.
- **D-09:** Import paths: `import { Analytics } from '@vercel/analytics/next'` and `import { SpeedInsights } from '@vercel/speed-insights/next'`. Both are deferred scripts — no render blocking.

### Hero Section (LP-01)
- **D-10:** Headline: `"Your restaurant menu, online in minutes"` (7 words, outcome-first, no product name)
- **D-11:** Subheadline: `"Create a beautiful digital menu, generate a QR code, and start taking orders — no tech skills needed."`
- **D-12:** Primary CTA: button `"Get started free"` → `/auth/register`. Below button: `"No credit card required."` (microcopy, smaller text). No secondary CTA above the fold.
- **D-13:** Sticky nav: logo left (`XmartMenu` text or SVG), `"Get started"` button right (outline style). No additional nav links — landing page is one-pager.

### How It Works (LP-02)
- **D-14:** 3 numbered steps, icon + label + 1 sentence each:
  1. **Create your account** — "Sign up in seconds, no credit card required."
  2. **Build your menu** — "Add categories, products, images and prices. We'll help with AI."
  3. **Share your QR code** — "Print it, display it at the table, and let customers browse."

### Feature Blocks (LP-03)
- **D-15:** 4 blocks, honest copy:
  1. **Multi-language menus** — "Serve customers in Portuguese, English, Spanish and more — your menu adapts to every language automatically."
  2. **QR code, ready in seconds** — "Every menu gets a unique QR code. Print it, share it, or embed it anywhere."
  3. **AI-powered setup** — "Our team can populate your entire menu in minutes using AI — categories, descriptions, and photos included." *(honest: frames as onboarding service, not self-serve)*
  4. **Online ordering** — "Let customers order directly from the table. Available as an add-on." *(honest: feature-flagged)*
- **D-16:** Layout: 2×2 grid on desktop, stacked on mobile. Each block: icon (lucide-react), title, body text.

### FAQ (LP-04)
- **D-17:** 6 questions, accordion pattern:
  1. "Is it free?" — "Yes, xmartmenu is free during beta. We'll announce pricing changes with advance notice."
  2. "Do I need a developer?" — "No. You set up your menu from a simple admin panel — no code required."
  3. "Can my menu be in multiple languages?" — "Yes. You can enable multiple languages and your menu content will be available in each."
  4. "What happens to my data if I cancel?" — "Your data is yours. Contact us and we'll export everything before you leave."
  5. "How do QR codes work?" — "Every menu gets a unique QR code. Customers scan it and see your live menu instantly."
  6. "Is online ordering available?" — "Online ordering is available as an add-on. Contact us to enable it for your restaurant."
- **D-18:** Accordion uses `<details>/<summary>` native HTML (zero JS, works without client component). Style with Tailwind.

### Footer (LP-05)
- **D-19:** Footer columns: left — logo + short tagline. Right — "Legal" group: Privacy Policy (placeholder `/privacy`), Terms of Service (placeholder `/terms`). Bottom bar: `© 2025 xmartmenu. All rights reserved.`
- **D-20:** Social handles: placeholder — link icons for Instagram and WhatsApp only (most used by Brazilian restaurant owners). URLs: Claude's discretion (empty `href="#"` until real handles exist).
- **D-21:** Privacy Policy and Terms pages: create as minimal placeholder pages (`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`) with "Coming soon" content. These are needed before public launch per LGPD; engineering creates the shell, legal fills the content.

### OG Image
- **D-22:** Static `src/app/(marketing)/opengraph-image.png` — 1200×630 JPEG, ≤300 KB. Executor creates a simple programmatic image using `next/og` (`ImageResponse`) at build time, OR uses a solid-color background with white text as a static PNG placeholder. The Phase 13 plan will upgrade this with design assets.
- **D-23:** `metadataBase` set to `new URL('https://xmartmenu.skale.club')` in `(marketing)/layout.tsx`.

### Claude's Discretion
- Exact Tailwind class choices for all visual elements
- Lucide icon selection per feature block
- Whether hero has a background image or is clean whitespace (research recommendation: no image above fold for Lighthouse — use color/gradient)
- Section spacing, max-width container values
- Exact accordion animation (transition or none)
- Whether to use a `(marketing)/layout.tsx` or keep page.tsx at the root (planner decides based on App Router file resolution rules — both work)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Files to modify
- `src/app/page.tsx` — currently `redirect('/auth/login')`, will be replaced or superseded by route group
- `src/lib/supabase/middleware.ts` — add marketing bypass at top of `updateSession()`
- `src/app/layout.tsx` — check if `metadataBase` and `display: 'swap'` needed here or only in (marketing)/layout.tsx
- `src/app/api/onboarding/route.ts` — add reserved slug validation

### Files to create
- `src/app/(marketing)/page.tsx` — landing page component, `force-static`
- `src/app/(marketing)/layout.tsx` — isolated layout, en lang, Inter swap, metadata, analytics
- `src/lib/marketing/reserved-paths.ts` — RESERVED_PATHS Set
- `src/app/privacy/page.tsx` — placeholder legal page
- `src/app/terms/page.tsx` — placeholder legal page
- `src/app/(marketing)/opengraph-image.png` or `.tsx` — OG image ≤300 KB

### Research artifacts
- `.planning/research/ARCHITECTURE.md` — exact file paths, middleware pattern, build strategy
- `.planning/research/PITFALLS.md` — Pitfall 1 (namespace), Pitfall 2 (middleware TTFB), Pitfall 4 (Lighthouse penalties), RESERVED_PATHS list
- `.planning/research/STACK.md` — package versions, import paths
- `.planning/research/FEATURES.md` — section order, copy anti-patterns, table stakes

### Requirements
- `.planning/REQUIREMENTS.md` LP-01, LP-02, LP-03, LP-04, LP-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable
- `src/app/globals.css` — `@import "tailwindcss"` is the full Tailwind v4 import; reuse in (marketing)/layout if needed, or global is fine
- `src/app/layout.tsx` Inter font config — replicate in (marketing)/layout.tsx with `display: 'swap'`
- `/auth/register` — exists, CTA destination confirmed

### Integration Points
- Middleware: `src/middleware.ts` calls `updateSession` — bypass goes in `src/lib/supabase/middleware.ts` NOT in `src/middleware.ts`
- Onboarding API: `src/app/api/onboarding/route.ts` needs RESERVED_PATHS import
- Analytics: both components go in `(marketing)/layout.tsx` as last body children

### Known Constraints
- Tenant public menus at `/(public)/[slug]/[menuSlug]` — NOT affected by any Phase 12 change
- `layout.tsx` `lang="pt-BR"` — marketing layout overrides to `lang="en"` in isolation
- No existing design system components — Tailwind + lucide-react only

</code_context>

<specifics>
## Specific Content

### Sections Order (top → bottom)
1. Sticky nav (logo + CTA)
2. Hero (headline, subheadline, CTA, microcopy)
3. How It Works (3 steps)
4. Feature Blocks (2×2 grid)
5. FAQ (6 questions, accordion)
6. Footer CTA band ("Ready to get started?" + button)
7. Footer (logo, legal links, social, copyright)

### Anti-Patterns (locked, must NOT appear in plans)
- No fake testimonials, no fake metrics
- No crossed-out anchor pricing
- No `next/script` for JSON-LD (Phase 13 concern, but relevant to layout setup)
- No `'use client'` on hero or above-fold sections (kills Lighthouse TBT)
- No auto-play video or GIF above fold
- No overclaiming AI as self-serve; no claiming ordering is default-on

</specifics>

<deferred>
## Deferred Ideas

- Demo tenant `/demo` link — not selected by user for v1.3
- Pricing section — depends on SEED-003 Stripe Connect decision
- Social proof / testimonials — add when real customers provide quotes
- i18n PT/EN routes — English-only for v1.3
- Lighthouse CI/CD gate — deferred to SEED-004 performance milestone
- Full legal docs (Privacy Policy, Terms) — legal team fills content; engineering creates shell in this phase

</deferred>

---

*Phase: 12-core-landing-page*
*Context gathered: 2026-05-07*
