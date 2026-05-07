# Architecture Research: v1.3 Landing Page

**Researched:** 2026-05-07
**Domain:** Next.js 16.2 App Router — marketing page integration, SEO metadata files, middleware reserved paths, analytics
**Confidence:** HIGH — all findings sourced from official Next.js docs (version 16.2.5, last updated 2026-05-07) and official Vercel docs

---

## Summary

This document answers the four integration questions for the v1.3 milestone:
where new files go, how the middleware reserved-path list works, the build
strategy for a Lighthouse 95+ marketing page, and the exact integration points
for sitemap/robots/OG/analytics.

The core insight: **Next.js 16.2 App Router ships every required capability
natively** — sitemap, robots, opengraph-image, and JSON-LD are all file
conventions, not packages. No `next-sitemap`, no `react-helmet`, no external
packages for SEO. Vercel Analytics and Speed Insights are two `npm install`s
plus two component imports into the existing root layout.

The landing page (`src/app/page.tsx`) can be a pure Server Component that
exports `dynamic = 'force-static'`, giving it the same treatment as a
statically generated page while the rest of the app remains SSR/ISR. This
is the hybrid rendering model Next.js is designed for.

**Primary recommendation:** Replace `src/app/page.tsx` with a static Server
Component; add six new files (`sitemap.ts`, `robots.ts`,
`opengraph-image.tsx`, and one layout metadata update); add two npm packages;
guard reserved paths in the existing middleware with a Set lookup.

---

## Current Architecture Baseline

```
src/
├── app/
│   ├── page.tsx                     ← MODIFY: was redirect('/auth/login')
│   ├── layout.tsx                   ← MODIFY: add Analytics + SpeedInsights
│   ├── globals.css
│   ├── favicon.ico
│   ├── (public)/
│   │   ├── layout.tsx
│   │   └── [slug]/
│   │       └── [menuSlug]/
│   │           └── page.tsx         ← UNCHANGED: tenant menu at /{slug}/{menuSlug}
│   ├── (admin)/                     ← UNCHANGED
│   ├── (superadmin)/                ← UNCHANGED
│   ├── auth/                        ← UNCHANGED
│   └── api/                         ← UNCHANGED
├── middleware.ts                    ← MODIFY: add reserved path guard
└── lib/
    └── supabase/
        └── middleware.ts            ← UNCHANGED (auth session logic lives here)
```

### The slug collision problem (existing)

`src/app/(public)/[slug]/page.tsx` captures **any** first-path segment that
is not already claimed by a named route group folder. The marketing page lives
at `/` (the root), so it does NOT collide with `[slug]`. However, marketing
section IDs like `/pricing`, `/faq`, `/about`, `/demo` WOULD be captured by
`[slug]` if they were separate pages — they are NOT, because the marketing
page is one SPA-style page at `/` with anchor links, not sub-routes.

The collision risk is specifically that a **tenant** could register a slug
identical to a marketing concept (e.g., slug `"pricing"`), then
`/pricing` would show that tenant's page, not the marketing section. Since
marketing sections are not separate routes this is not currently a rendering
issue, but it IS a UX and SEO issue. The middleware reserved-path guard
prevents those slugs from ever being provisioned.

---

## New vs Modified Files

### New files to create

| File path | What it does | Rendered |
|-----------|-------------|---------|
| `src/app/sitemap.ts` | Generates `/sitemap.xml` via MetadataRoute | Static at build |
| `src/app/robots.ts` | Generates `/robots.txt` via MetadataRoute | Static at build |
| `src/app/opengraph-image.tsx` | OG image for `/` via ImageResponse | Static at build |
| `src/lib/marketing/reserved-paths.ts` | Exports the RESERVED_PATHS Set (shared between middleware and tenant creation API) | N/A |

### Modified files

| File path | Change | Why |
|-----------|--------|-----|
| `src/app/page.tsx` | Replace `redirect('/auth/login')` with the landing page component | This IS the marketing page |
| `src/app/layout.tsx` | Add `<Analytics />` + `<SpeedInsights />` + update root metadata | Global analytics coverage |
| `src/middleware.ts` | Add reserved-path check before passing to `updateSession` | Block tenant slug collisions |
| `src/lib/supabase/middleware.ts` | No change required — auth routing logic unchanged | — |

### Optional files (i18n — Phase 13)

If path-based i18n (`/pt`, `/en`) is implemented:

| File path | What it does |
|-----------|-------------|
| `src/app/[lang]/page.tsx` | Language-specific landing page variant |
| `src/app/[lang]/layout.tsx` | Sets `<html lang="">` per locale |

This requires a restructure of the root segment. See "i18n Architecture
Consideration" section below.

---

## Middleware: Reserved Path Pattern

### Current middleware.ts

```typescript
// src/middleware.ts — CURRENT (7 lines)
import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### How updateSession works (relevant lines)

The auth logic in `src/lib/supabase/middleware.ts` checks named route
prefixes (`/dashboard`, `/menu`, `/settings`, `/tenants`, `/overview`,
`/users`, `/onboarding`). It does NOT check or block generic slug paths.
The `[slug]` route group in `(public)` is purely a file-system route —
middleware has no special awareness of it.

### Reserved path guard — where to add it

The guard belongs in `src/middleware.ts`, BEFORE calling `updateSession`,
because:
1. It is not auth-related — it's a routing concern
2. It should short-circuit with a 404 before any Supabase session work
3. The auth middleware already handles admin/superadmin route protection

### Recommended implementation

```typescript
// src/lib/marketing/reserved-paths.ts
export const RESERVED_PATHS = new Set([
  'demo',        // live demo tenant — a real provisioned tenant, not a block
  'pricing',
  'faq',
  'about',
  'features',
  'contact',
  'privacy',
  'terms',
  'blog',
  'docs',
  'help',
  'support',
  'status',
  'api',
  'auth',
  'dashboard',
  'settings',
  'menu',
  'menus',
  'tenants',
  'overview',
  'users',
  'onboarding',
  'sitemap',
  'robots',
  '_next',
])
```

```typescript
// src/middleware.ts — MODIFIED
import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { RESERVED_PATHS } from './lib/marketing/reserved-paths'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  // Extract first path segment: "/demo/menu-1" -> "demo"
  const firstSegment = pathname.split('/')[1]

  // If the segment is reserved but the path is NOT served by a named
  // App Router file, return 404 immediately. Named routes (auth/, api/,
  // dashboard/, etc.) are already handled by file-system routing and
  // never reach this check as tenant slugs.
  //
  // "demo" is ALLOWED through — it is a real provisioned tenant.
  // The block only applies to slugs that have NO corresponding named
  // route AND are not the demo tenant.
  if (
    firstSegment &&
    RESERVED_PATHS.has(firstSegment) &&
    firstSegment !== 'demo' &&
    !firstSegment.startsWith('_') &&
    // Only block if the path would resolve to (public)/[slug] —
    // named routes (auth, api, dashboard, etc.) self-resolve via
    // file system and never reach the tenant slug handler
    !pathname.startsWith('/auth') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/dashboard') &&
    !pathname.startsWith('/menu') &&
    !pathname.startsWith('/settings') &&
    !pathname.startsWith('/tenants') &&
    !pathname.startsWith('/overview') &&
    !pathname.startsWith('/users') &&
    !pathname.startsWith('/onboarding')
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Simpler alternative — the lookup-only guard:**

Because App Router's file-system routing already resolves named routes
(`/auth`, `/api`, etc.) before they can be captured by `[slug]`, the
middleware only needs to block slugs that WOULD otherwise reach
`(public)/[slug]` but are conceptually reserved. A cleaner guard:

```typescript
// In middleware, after extracting firstSegment:
const BLOCKED_TENANT_SLUGS = new Set([
  'pricing', 'faq', 'about', 'features',
  'contact', 'privacy', 'terms', 'blog',
  'docs', 'help', 'support', 'status', 'sitemap', 'robots',
])

if (firstSegment && BLOCKED_TENANT_SLUGS.has(firstSegment)) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
```

This is simpler because named App Router routes never reach `[slug]` —
they are resolved first by the file system. The guard only needs to cover
paths that have no named file but are conceptually marketing-reserved.

**ALSO add to tenant slug creation validation:**

```typescript
// src/app/api/onboarding/route.ts — add before INSERT
import { RESERVED_PATHS } from '@/lib/marketing/reserved-paths'

if (RESERVED_PATHS.has(slug)) {
  return NextResponse.json(
    { error: 'This URL is reserved. Please choose a different name.' },
    { status: 400 }
  )
}
```

This dual enforcement (middleware blocks public access + API rejects
creation) is the correct defense-in-depth pattern.

---

## Build Strategy: Static Marketing Page + SSR App

### The hybrid model

Next.js 16.2 App Router renders each page segment independently. The
marketing page at `src/app/page.tsx` can be statically generated at build
time while all other routes remain SSR or ISR. No global config change
needed.

### Landing page rendering strategy

```typescript
// src/app/page.tsx
export const dynamic = 'force-static'
// This tells Next.js: always generate this page statically at build time.
// No cookies, no request-time data, no Supabase calls.
// Result: HTML is pre-rendered and served from CDN edge with zero server cost.

export default function LandingPage() {
  // Pure static content — sections, copy, CTAs
  // All data is hardcoded or imported from local constants
  return <main>...</main>
}
```

`force-static` is the correct directive for a marketing page. It:
- Eliminates all server latency for `/`
- Enables full CDN caching on Vercel Edge Network
- Does not affect other routes (each segment is independent)
- Satisfies Lighthouse performance: no server round-trip = fast TTFB

### Why NOT `export const output = 'export'` (full static export)

Full static export (`next.config.ts: { output: 'export' }`) would convert
the ENTIRE app to static HTML — breaking the SSR/ISR routes
(`/[slug]/[menuSlug]`, admin panel, API routes). Do NOT use it. Use
per-page `force-static` instead.

### Lighthouse 95+ strategy

| Factor | Implementation |
|--------|---------------|
| TTFB | `force-static` page served from CDN edge — ~10ms |
| LCP | Hero image: static PNG in `public/`, `<Image priority>` with `sizes` |
| CLS | Explicit width/height on all images; no layout shifts from dynamic data |
| TBT/INP | Minimal JS: no client state, no useEffect on landing page; analytics scripts are deferred |
| Fonts | Inter already loaded via `next/font/google` in root layout — preloaded, no FOUT |

The analytics components (`<Analytics />`, `<SpeedInsights />`) inject
deferred scripts — they do NOT block rendering or add to TBT.

---

## Sitemap: Exact Implementation

**File:** `src/app/sitemap.ts`
**Served at:** `/sitemap.xml` (automatic, no config needed)
**Cached:** at build time by default (static route handler)

```typescript
// src/app/sitemap.ts
import type { MetadataRoute } from 'next'

const BASE_URL = 'https://xmartmenu.skale.club'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${BASE_URL}/demo`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    // When i18n is added (Phase 13):
    // {
    //   url: `${BASE_URL}/pt`,
    //   alternates: { languages: { en: `${BASE_URL}/en`, pt: `${BASE_URL}/pt` } },
    //   changeFrequency: 'monthly',
    //   priority: 0.9,
    // },
  ]
}
```

Do NOT use `next-sitemap` package — Next.js 16.2 has this built in.

---

## Robots.txt: Exact Implementation

**File:** `src/app/robots.ts`
**Served at:** `/robots.txt` (automatic)
**Cached:** at build time by default

```typescript
// src/app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/settings',
          '/menu',
          '/menus',
          '/tenants',
          '/overview',
          '/users',
          '/onboarding',
          '/auth',
          '/api',
        ],
      },
    ],
    sitemap: 'https://xmartmenu.skale.club/sitemap.xml',
  }
}
```

---

## OG Image: Exact Implementation

**Recommended approach:** `src/app/opengraph-image.tsx` (dynamic via
ImageResponse, statically optimized at build because no request-time APIs)

**Served at:** metadata auto-injects `<meta property="og:image">` for `/`

```typescript
// src/app/opengraph-image.tsx
import { ImageResponse } from 'next/og'

export const alt = 'XmartMenu — Cardápio digital para restaurantes'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          color: 'white',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 'bold' }}>XmartMenu</div>
        <div style={{ fontSize: 32, marginTop: 24, opacity: 0.8 }}>
          Cardápio digital via QR Code
        </div>
      </div>
    ),
    { ...size }
  )
}
```

**Alternative (simpler):** Place a static PNG at
`src/app/opengraph-image.png`. Next.js picks it up automatically with no
code needed. Tradeoff: cannot be customized programmatically, and must be
a PNG file ≤ 8MB.

**Recommendation:** Start with static PNG in Phase 12 (fastest to ship),
migrate to `opengraph-image.tsx` with branding if needed in Phase 13.

---

## JSON-LD Structured Data: Exact Implementation

No package needed. Inline `<script>` tag in the Server Component.
Source: official Next.js docs (nextjs.org/docs/app/guides/json-ld).

```typescript
// Inside src/app/page.tsx (the landing page component)
export default function LandingPage() {
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'XmartMenu',
    url: 'https://xmartmenu.skale.club',
    description: 'Cardápio digital via QR Code para restaurantes',
    sameAs: [],
  }

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'XmartMenu',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
      description: 'Grátis durante o beta',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationSchema).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareSchema).replace(/</g, '\\u003c'),
        }}
      />
      <main>...</main>
    </>
  )
}
```

The `.replace(/</g, '\\u003c')` is XSS prevention per the official Next.js
docs. Do not use `next/script` for JSON-LD — it's structured data, not
executable JS.

---

## Metadata API: Root Layout Update

```typescript
// src/app/layout.tsx — full updated version
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    template: '%s | XmartMenu',
    default: 'XmartMenu — Cardápio digital para restaurantes',
  },
  description: 'Crie seu cardápio digital via QR Code em minutos. Sem design, sem desenvolvedor.',
  metadataBase: new URL('https://xmartmenu.skale.club'),
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    alternateLocale: 'en_US',
    siteName: 'XmartMenu',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className={`${inter.className} min-h-full`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
```

`metadataBase` is required for OG image URLs to be absolute. Without it,
Next.js will warn and may generate relative URLs that social crawlers reject.

---

## Vercel Analytics + Speed Insights: Integration

### Installation

```bash
npm install @vercel/analytics@2.0.1 @vercel/speed-insights@2.0.0
```

Versions verified against npm registry (2026-05-07).

### Import paths (critical — must use `/next` subpath)

```typescript
import { Analytics } from '@vercel/analytics/next'      // NOT '/react'
import { SpeedInsights } from '@vercel/speed-insights/next'  // NOT '/react'
```

The `/next` subpath is the App Router integration — it handles route change
detection correctly for Next.js App Router's navigation model.

### Placement

Both components go in `src/app/layout.tsx` **inside `<body>`**, after
`{children}`. This ensures:
- They render on ALL pages (marketing, admin, public menu)
- They are server-rendered as part of the layout
- Scripts are injected with `defer` — no render blocking

### Dashboard activation

After deploying, enable both in the Vercel project dashboard:
- Analytics tab → Enable
- Speed Insights tab → Enable

The packages work without enabling (they silently no-op), but data only
flows after the dashboard toggle is on.

---

## Demo Tenant at /demo

The `/demo` path is a **real provisioned tenant**, not a redirect or special
route. Required steps:

1. Create a tenant in the database with `slug = 'demo'`
2. Seed it with appealing sample content (AI seeding tools from v1.2 are perfect)
3. Do NOT add a `src/app/demo/` folder — it would shadow `(public)/[slug]`
4. The `/demo/[menuSlug]` URL works automatically through the existing
   `(public)/[slug]/[menuSlug]` route
5. Keep `'demo'` in `RESERVED_PATHS` for the API guard (prevent another
   tenant from claiming this slug), but NOT in the middleware block
   (legitimate traffic must reach the tenant page)

**Landing page link:** `<a href="/demo">Ver demo ao vivo</a>` — static link,
no client routing logic needed.

---

## i18n Architecture Consideration (Phase 13)

The project specifies path-based i18n (`/pt`, `/en`). Two implementation
paths in Next.js App Router:

### Option A: `[lang]` dynamic segment at root (recommended)

```
src/app/
├── [lang]/
│   ├── layout.tsx      ← sets <html lang={lang}>
│   └── page.tsx        ← language-specific landing page
├── layout.tsx           ← root layout (Analytics, SpeedInsights, fonts)
├── sitemap.ts           ← includes alternates.languages
├── robots.ts
└── opengraph-image.tsx
```

The current `page.tsx` (marketing) moves to `[lang]/page.tsx`. The `[lang]`
segment must be narrowed to only `['pt', 'en']` using `generateStaticParams`.

**Middleware impact:** The `[lang]` route is a named dynamic segment in the
file system, so it will shadow `(public)/[slug]` for paths like `/pt` and
`/en`. No middleware change needed for this.

### Option B: `next-intl` library

Not needed for two-language path routing without complex ICU message
formatting. The simple object-dictionary approach (constants file per
language) is sufficient for a marketing page.

**Phase 13 recommendation:** Option A with a `translations/` constants
file, no external i18n library.

---

## Suggested Phase Build Order

Dependencies drive order. Analytics can be added early (zero risk).
The landing page content is independent of middleware and SEO files.

### Phase 12: Core marketing page

**Deliverables:**
1. `src/app/page.tsx` — landing page component (`force-static`, all sections)
2. `src/app/layout.tsx` — add Analytics + SpeedInsights + metadataBase
3. `src/app/opengraph-image.png` — static PNG (fast path, no code)
4. `src/lib/marketing/reserved-paths.ts` — RESERVED_PATHS Set
5. `src/middleware.ts` — add reserved-path guard
6. API guard in `src/app/api/onboarding/route.ts`
7. Demo tenant provisioned in DB (superadmin AI seeding)
8. `npm install @vercel/analytics @vercel/speed-insights`

**Why analytics first:** Zero risk, immediate value, and they belong in the
root layout which is also being modified for metadata.

**Why middleware guard with landing page:** The guard must exist before the
landing page ships publicly, to prevent tenant slug squatting on reserved
words from day one.

### Phase 13: SEO + i18n

**Deliverables:**
1. `src/app/sitemap.ts` — MetadataRoute.Sitemap with PT/EN alternates
2. `src/app/robots.ts` — MetadataRoute.Robots
3. `src/app/opengraph-image.tsx` — dynamic ImageResponse (replace static PNG)
4. JSON-LD schemas inside `page.tsx`
5. `generateMetadata` export on `page.tsx` with full OG/Twitter metadata
6. `[lang]` route segment for PT/EN path-based i18n
7. Language switcher UI in landing page

**Why i18n in Phase 13:** The i18n restructure (`page.tsx` → `[lang]/page.tsx`)
can cause routing conflicts if attempted mid-phase. Build Phase 12 with
a single-language page, then restructure cleanly in Phase 13.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|------------|-------------|
| sitemap.xml generation | Custom XML template / next-sitemap package | `src/app/sitemap.ts` with MetadataRoute |
| robots.txt generation | Static file in `/public` / next-sitemap | `src/app/robots.ts` with MetadataRoute |
| OG image generation | Canvas / puppeteer / cloudinary | `next/og` ImageResponse (ships with Next.js) |
| Analytics script injection | Custom script tag | `@vercel/analytics/next` component |
| Web Vitals tracking | Custom PerformanceObserver | `@vercel/speed-insights/next` component |
| JSON-LD injection | `next/script` with JSON | Native `<script type="application/ld+json">` in Server Component |
| i18n routing | next-intl for two languages | `[lang]` segment + constants file |

---

## Common Pitfalls

### Pitfall 1: Missing `metadataBase`

**What goes wrong:** OG images and canonical URLs generate as relative paths.
Social crawlers (Facebook, Twitter/X, LinkedIn) reject relative `og:image`
URLs — the social preview card shows no image.

**How to avoid:** Set `metadataBase: new URL('https://xmartmenu.skale.club')`
in the root layout's `metadata` export. This is required even if all
metadata is defined in individual pages.

**Warning sign:** Next.js build logs `metadataBase not set` warning.

---

### Pitfall 2: Using `/react` analytics import instead of `/next`

**What goes wrong:** `@vercel/analytics/react` and `@vercel/speed-insights/react`
do not handle Next.js App Router route changes correctly — page view events
fire once on hard load, not on client-side navigation between pages.

**How to avoid:** Always import from the `/next` subpath:
```typescript
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
```

---

### Pitfall 3: Adding `src/app/demo/page.tsx`

**What goes wrong:** A file at `src/app/demo/` creates a named route that
shadows `(public)/[slug]` for the `/demo` path. The demo tenant's menu
at `/demo/[menuSlug]` would 404 because `src/app/demo/` has no
`[menuSlug]` sub-route.

**How to avoid:** The demo tenant is a real DB tenant. Its URL works
automatically through `(public)/[slug]/[menuSlug]`. Never create a
`src/app/demo/` folder.

---

### Pitfall 4: `force-static` on a page that needs cookies

**What goes wrong:** If the landing page later adds personalization (e.g.,
"Welcome back!" for logged-in users) and reads from cookies, `force-static`
will throw a build error: "Page used cookies() which is not allowed in
static rendering."

**How to avoid:** Keep the landing page completely static — no auth check,
no Supabase calls. Personalization for logged-in users should be client-side
only (a `useEffect` that checks a cookie, not a server-side read).

---

### Pitfall 5: Reserved path guard blocking named App Router routes

**What goes wrong:** If the RESERVED_PATHS Set contains `'auth'` and the
middleware returns 404 for `/auth/login`, the login page breaks.

**How to avoid:** Named routes in the file system (`src/app/auth/`,
`src/app/api/`) are NOT served through `(public)/[slug]` — the file system
resolves them first. The middleware guard is redundant for those but harmless
if written correctly. The simpler guard that only blocks paths with NO
corresponding named file (the `BLOCKED_TENANT_SLUGS` set approach) is
cleaner and avoids this entirely.

---

### Pitfall 6: `next-sitemap` conflicts with native sitemap route

**What goes wrong:** If `next-sitemap` is installed, it generates a
`sitemap.xml` in the `public/` folder at build time. The native
`src/app/sitemap.ts` also generates `/sitemap.xml`. The file in `public/`
wins, serving stale content.

**How to avoid:** Do not install `next-sitemap`. Use `src/app/sitemap.ts`
exclusively.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 12 is code/config changes only. No new external
services or CLI tools are required. Vercel Analytics and Speed Insights are
client-side packages that only activate after a Vercel deployment.

---

## Integration Points Summary (for Roadmapper)

| Capability | File | New/Modified | Notes |
|-----------|------|-------------|-------|
| Marketing page | `src/app/page.tsx` | MODIFY | Replace redirect with static Server Component |
| Root metadata + analytics | `src/app/layout.tsx` | MODIFY | Add Analytics, SpeedInsights, metadataBase |
| Sitemap | `src/app/sitemap.ts` | NEW | Native MetadataRoute, no package |
| Robots | `src/app/robots.ts` | NEW | Native MetadataRoute, no package |
| OG image | `src/app/opengraph-image.png` or `.tsx` | NEW | Static PNG in Phase 12, dynamic in Phase 13 |
| JSON-LD | Inside `src/app/page.tsx` | Part of MODIFY | Inline script tag, no package |
| Reserved paths | `src/lib/marketing/reserved-paths.ts` | NEW | Shared Set, imported by middleware + API |
| Middleware guard | `src/middleware.ts` | MODIFY | Add firstSegment check before updateSession |
| Tenant creation guard | `src/app/api/onboarding/route.ts` | MODIFY | Check RESERVED_PATHS before INSERT |
| Vercel Analytics | `src/app/layout.tsx` | MODIFY | Import from @vercel/analytics/next |
| Vercel Speed Insights | `src/app/layout.tsx` | MODIFY | Import from @vercel/speed-insights/next |

---

## Sources

### Primary (HIGH confidence — official docs, dated 2026-05-07)

- Next.js 16.2.5 sitemap file convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Next.js 16.2.5 robots file convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
- Next.js 16.2.5 opengraph-image convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
- Next.js 16.2.5 JSON-LD guide: https://nextjs.org/docs/app/guides/json-ld
- Vercel Web Analytics quickstart: https://vercel.com/docs/analytics/quickstart (last updated 2026-03-11)
- Vercel Speed Insights quickstart: https://vercel.com/docs/speed-insights/quickstart (last updated 2026-03-11)

### Secondary (MEDIUM confidence — verified against primary sources)

- `@vercel/analytics@2.0.1` and `@vercel/speed-insights@2.0.0` — versions verified via `npm view` (2026-05-07)
- `force-static` rendering directive for per-page static generation in App Router — confirmed in Next.js docs

### Metadata

**Confidence breakdown:**
- File conventions (sitemap, robots, OG): HIGH — from official Next.js 16.2.5 docs dated today
- Analytics integration: HIGH — from official Vercel docs with exact import paths
- Middleware reserved path pattern: HIGH — derived from direct codebase inspection + Next.js routing docs
- Lighthouse 95+ strategy: MEDIUM — general Next.js performance principles; no tool-based measurement yet

**Research date:** 2026-05-07
**Valid until:** 2026-08-07 (stable APIs; Next.js metadata conventions have not changed since v13.3.0)
