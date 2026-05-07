# Requirements — v1.3 Landing Page

**Milestone:** v1.3 Landing Page
**Created:** 2026-05-07
**Language:** English only — no i18n for this milestone

## Context

xmartmenu is a multi-tenant SaaS that lets restaurants create digital menus via QR code. The current root URL (`xmartmenu.skale.club`) redirects to `/auth/login`, meaning every cold visitor dead-ends at a login screen. v1.3 replaces this with a marketing landing page that gives prospective restaurant owners a reason to sign up.

Tenant public menus remain at `/{tenantSlug}/{menuSlug}` — no URL structure change.

## v1.3 Requirements

### Landing Page — Content (LP)

- [ ] **LP-01**: Visitor sees a hero section with a headline ≤ 8 words, a subheadline, a primary "Get started" CTA button linking to `/auth/register`, and "No credit card required" microcopy below the button
- [ ] **LP-02**: Visitor sees a "How It Works" section with 3 visual steps: create account → configure menu → share QR code
- [ ] **LP-03**: Visitor sees 4 feature blocks — Multi-language menus, QR Code generation, AI-powered seeding (superadmin tool), Online ordering (feature-flagged) — with honest copy that does not overclaim self-serve AI or default-on ordering
- [ ] **LP-04**: Visitor sees a FAQ section with 6–8 questions covering billing, data ownership, multi-language support, QR codes, cancellation, and ordering
- [x] **LP-05**: Visitor sees a footer with internal navigation links, placeholder links for Privacy Policy and Terms of Service pages, and social media handles

### SEO & Metadata (SEO)

- [ ] **SEO-01**: `/sitemap.xml` is served via `src/app/sitemap.ts` listing only marketing URLs (`/`) — no tenant slugs exposed
- [ ] **SEO-02**: `/robots.txt` is served via `src/app/robots.ts` allowing `/` and disallowing `/api/`, `/admin/`, `/superadmin/`
- [ ] **SEO-03**: JSON-LD structured data (`Organization` + `SoftwareApplication` schema.org types) is injected in `src/app/page.tsx` only (not `layout.tsx`) via a `<script type="application/ld+json" dangerouslySetInnerHTML>` block
- [ ] **SEO-04**: A static OG image (JPEG, ≤ 300 KB) is served at `/opengraph-image`; `metadataBase` is set in `src/app/layout.tsx` so all OG/Twitter URLs are absolute and render correctly in WhatsApp and social crawlers

## Future Requirements (deferred from v1.3)

- Middleware bypass for marketing routes (Supabase auth getUser() adds 50–200ms TTFB on `/` — blocks Lighthouse 95+; defer to v1.4 performance milestone)
- Reserved paths guard in middleware + onboarding API (prevents tenant slug collision with marketing routes; defer to v1.4)
- Vercel Analytics + Speed Insights integration (defer to v1.4)
- Demo tenant provisioning at `/demo` (launch dependency; coordinate with content)
- Pricing section (depends on SEED-003 Stripe Connect application_fee decision)
- Social proof / testimonials (no fake content; add when first real customers provide quotes)
- i18n PT/EN (path-based `/pt` `/en`; defer to v1.4 — English-only for v1.3)
- Legal documents (Privacy Policy, Terms of Service) — hard launch prerequisite, out of engineering scope; use Termly/iubenda template

## Out of Scope

- Mobile native app — web-first only
- Subdomain per tenant (`{slug}.xmartmenu.skale.club`) — URL format locked as `/{slug}`
- Fake testimonials, fake metrics, fake social proof — anti-pattern, explicitly excluded
- Tenant-managed landing page customization — superadmin-only platform

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| LP-01 | Phase 12 — Core Landing Page | Pending |
| LP-02 | Phase 12 — Core Landing Page | Pending |
| LP-03 | Phase 12 — Core Landing Page | Pending |
| LP-04 | Phase 12 — Core Landing Page | Pending |
| LP-05 | Phase 12 — Core Landing Page | Complete |
| SEO-01 | Phase 13 — SEO & Metadata | Pending |
| SEO-02 | Phase 13 — SEO & Metadata | Pending |
| SEO-03 | Phase 13 — SEO & Metadata | Pending |
| SEO-04 | Phase 13 — SEO & Metadata | Pending |
