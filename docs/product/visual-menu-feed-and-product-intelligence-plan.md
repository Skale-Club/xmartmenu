# Visual Menu Feed and Product Intelligence — Product Guide

**Status:** MVP implemented; production validation pending
**Created:** 2026-10-08
**Scope:** Large, expected to require a dedicated product cycle
**Use this document when:** planning the next customer-facing product, conversion, analytics, or public-menu UX initiative.

## Executive Summary

Evolve XmartMenu from a digital catalog into a visual ordering and product-intelligence platform.

The public menu becomes a mobile-first feed in which dishes are discovered through photos and short videos, customized, added to the cart, and purchased without leaving the experience. A first-party analytics layer connects exposure to commercial outcomes so restaurant owners can understand which products attract attention, which convert, and where customers abandon the ordering journey.

The product thesis is:

> XmartMenu turns attention into orders and customer behavior into better menu decisions.

This is not an Instagram clone and should not be positioned as one. The differentiator is the closed loop between visual discovery, ordering, payment, and actionable menu intelligence.

## Implementation Status

Started on 2026-10-08. The end-to-end MVP is implemented and its database foundation has been migrated:

- [x] Anonymous `menu_sessions` and schema-controlled `menu_events` data model.
- [x] Optional session attribution on orders.
- [x] Tenant-scoped read policies and analytics indexes.
- [x] Strict public batch-ingestion contract with idempotency, relationship validation, body limits, and rate limits.
- [x] Browser session lifecycle, batching, `sendBeacon` fallback, and fail-open delivery.
- [x] Initial instrumentation for menu sessions, qualified product impressions, detail opens, search usage, category selection, cart changes, checkout start, and order creation.
- [x] Contract tests, TypeScript validation, targeted lint, and production build.
- [x] Active product-attention duration with Page Visibility pause/resume.
- [x] Trusted order-completed and order-cancelled events from payment/order status transitions.
- [x] Tenant-controlled visual Feed/List experience with portrait cards, multi-media navigation, viewport-aware direct video, reduced-motion handling, customization, cart, and checkout compatibility.
- [x] Tenant analytics dashboard with period/menu/location filters, KPIs, funnel, product performance, prior-period deltas, and low-data states.
- [x] Explainable, deterministic product recommendations with minimum sample thresholds and direct editor links.
- [x] Tenant settings for analytics collection, visual-feed rollout, default view, and video autoplay.
- [x] Test-mode event inspector available with `?analytics_debug=1`; test sessions are excluded from reporting.
- [x] Development-only visual feed preview available with `?feed_preview=1` for pre-migration UI QA.
- [x] Dashboard metric and recommendation unit tests, TypeScript validation, targeted lint, and production build.
- [ ] Seeded database reconciliation test against a migrated Supabase environment.
- [x] Database migrations applied to the linked production Supabase project.
- [ ] Pilot validation with live tenant traffic.

## Why This Matters

XmartMenu already contains most of the transactional and content foundations:

- Public menus with categories, search, featured products, and responsive product cards.
- Rich product media with up to eight images and one video.
- Product detail, options, ingredients, notes, cart, checkout, and order creation.
- Stripe Connect payment infrastructure.
- Multi-menu, multi-location, order-type, QR code, KDS, and customer-account capabilities.

However, those capabilities are not yet connected into a differentiated product story:

- Rich media is mostly hidden behind the product detail modal instead of driving discovery.
- The mobile menu remains primarily a category-based product grid.
- Analytics records menu access, but not product exposure, engagement, intent, abandonment, or conversion.
- The tenant dashboard reports inventory counts and daily scans, not business performance.
- The marketing site emphasizes QR codes, WhatsApp ordering, and scan counts even though the product is capable of much more.

The opportunity is to make the public experience more persuasive while giving owners evidence for deciding what to feature, re-photograph, reprice, rewrite, bundle, or remove.

## Product Outcome

When this seed is complete:

1. A customer can browse dishes through a fast, accessible, mobile-first visual feed.
2. Each feed item connects directly to customization, cart, checkout, and payment.
3. XmartMenu can measure the complete anonymous journey from menu session to completed order.
4. Restaurant owners can see a conversion funnel and product-level performance.
5. The dashboard provides evidence-based recommendations without overstating what the data proves.
6. The experience can be rolled out and disabled per tenant without disrupting the current menu.

## Product Principles

### 1. Content serves commerce

Photos and video are not decorative social content. Every feed card must help the customer decide and provide a short path to ordering.

### 2. Mobile feed, not infinite entertainment

The feed is finite and menu-aware. Categories, search, dietary tags, availability, and restaurant-controlled ordering remain first-class concepts.

### 3. Preserve customer control

Customers can switch between Feed and List views. Reduced-motion, data-saver, muted playback, and accessible controls are respected.

### 4. Measure behavior, not thoughts

The system can infer observable intent from events. It must not claim to know what a customer thought.

Use precise language:

- "Added to cart but did not checkout"
- "Started checkout but did not complete payment"
- "Viewed and customized without adding"

Avoid unsupported language such as "wanted to buy" or "almost ordered" unless the underlying event definition is shown.

### 5. Recommendations must be explainable

Every recommendation must cite the signal that produced it. Do not present correlation as causation.

### 6. Analytics must never block ordering

Event delivery is best-effort, batched, rate-limited, and fail-open. Menu rendering, cart operations, checkout, and payment cannot depend on the analytics path.

## Scope

### In Scope

- Mobile-first visual feed for public menus.
- Feed/List view switch with tenant-level default.
- Short-form image and video presentation.
- First-party anonymous session and event collection.
- Product exposure, engagement, intent, funnel, and conversion metrics.
- Product analytics and conversion dashboard for tenant owners.
- Rule-based, explainable recommendations.
- Feature flags, pilot rollout, performance budgets, and privacy controls.
- Updated product positioning after the supporting capabilities are live.

### Out of Scope for the First Product Cycle

- Public likes, comments, followers, or creator accounts.
- An opaque per-person recommendation algorithm.
- Cross-restaurant consumer tracking.
- Selling or sharing behavioral data across tenants.
- Facial recognition, precise location tracking, or identity enrichment.
- Native mobile applications.
- Causal claims without a controlled experiment.
- A real-time big-data warehouse introduced before PostgreSQL limits are demonstrated.

## Existing Baseline and Reusable Assets

| Capability | Current State | Reuse Strategy |
|---|---|---|
| Public product grid | Category sections and responsive cards | Preserve as List mode and desktop fallback |
| Featured products | Horizontal marquee/carousel | Replace or complement with deterministic Discover feed |
| Rich media | `product_media` supports images and video | Render media directly in feed cards |
| Product detail | Carousel, options, ingredients, notes | Reuse as expanded decision/customization surface |
| Cart and checkout | Existing in-memory cart and checkout flows | Add analytics hooks without changing business rules |
| Orders and payments | Existing order schema and Stripe flows | Attach analytics session and record trusted conversions server-side |
| Scan analytics | `scan_events` and public scan endpoint | Keep for QR reporting; do not overload it with behavioral analytics |
| Dashboard | Products, categories, scans today | Replace the primary emphasis with commercial outcomes |

## Target Customer Experience

### Feed Entry

- The menu opens on the restaurant header, compact category navigation, and the first dish.
- A tenant setting determines whether Feed or List is the default on mobile.
- Desktop may retain the grid by default until a desktop feed treatment is validated.
- Search, language, location, order type, and category filters remain reachable.

### Feed Card

Each product card should contain:

- Primary image or short video in a consistent portrait-friendly ratio.
- Product name, concise description, price, promotional price, and dietary tags.
- Clear availability state.
- Primary `Order` or `Customize` action.
- Quantity controls when a simple product is already in the cart.
- Optional secondary action to open full details.
- Visible progress or pagination when multiple media items exist.

### Media Behavior

- Direct short videos may autoplay muted, looped, and `playsinline` only when sufficiently visible.
- Pause video immediately when it leaves the viewport or the page becomes hidden.
- Embedded YouTube/Vimeo media remains user-initiated unless performance and privacy are explicitly accepted.
- Use poster images and lazy loading to prevent multiple players from competing for bandwidth.
- Respect `prefers-reduced-motion` and a future data-saver preference.
- Do not preload every product video.

### Ordering Flow

- Simple products can be added directly from the feed.
- Products with required choices open the existing customization surface.
- Closing a product returns the customer to the same feed position.
- Cart and checkout remain persistent and obvious.
- Successful payment/order completion is recorded server-side as the trusted conversion event.

## Analytics Contract

### Metric Definitions

Definitions must be approved before implementation and displayed in dashboard help text.

| Metric | Recommended Definition |
|---|---|
| Menu session | A new anonymous session for a menu visit, expiring after 30 minutes of inactivity |
| Product impression | At least 50% of the product card visible for at least 1 continuous second |
| Engaged view | At least 3 seconds of active visible time, a detail open, a media interaction, or a customization action |
| Product attention time | Active time while the product is sufficiently visible; paused when the tab is hidden |
| Detail-open rate | Unique product detail opens / unique product impressions |
| Add-to-cart rate | Sessions adding the product / sessions with a product impression |
| Remove rate | Sessions removing the product / sessions adding the product |
| Product purchase conversion | Sessions purchasing the product / sessions with a product impression |
| Menu conversion | Completed orders / eligible menu sessions |
| Checkout abandonment | Sessions starting checkout without a completed order in the attribution window |
| Revenue per session | Attributed completed-order revenue / eligible menu sessions |

Use session-level unique denominators by default. Raw event counts may be available as a secondary diagnostic view.

### Event Taxonomy

Recommended MVP events:

| Event | Source | Notes |
|---|---|---|
| `menu_session_started` | Client/API | One per anonymous menu session |
| `product_impression` | Client | Deduplicated per session/product for MVP |
| `product_engagement` | Client | Aggregated duration, flushed when visibility changes or navigation occurs |
| `product_detail_opened` | Client | Product modal/detail opened |
| `media_started` | Client | Video playback or deliberate media activation |
| `media_completed` | Client | Include completion threshold/type |
| `media_swiped` | Client | Gallery interaction, not passive autoplay |
| `category_selected` | Client | Category id only |
| `search_performed` | Client | Prefer normalized metadata; do not store raw sensitive free text by default |
| `product_customization_started` | Client | First option or ingredient interaction |
| `add_to_cart` | Client | Quantity, unit price, source surface |
| `remove_from_cart` | Client | Quantity and cart age if available |
| `checkout_started` | Client/server | Deduplicate per session/order attempt |
| `order_created` | Server | Trusted order creation event |
| `order_completed` | Server/webhook | Trusted paid/accepted outcome depending payment type |
| `order_cancelled` | Server | Enables net conversion/revenue reporting |

### Collection Rules

- Generate a random first-party analytics session id; do not require customer login.
- Store the session id in first-party browser storage with a defined expiry.
- Use `IntersectionObserver` for impression and visible-time measurement.
- Use the Page Visibility API to pause attention timers.
- Accumulate duration locally and send summaries instead of high-frequency heartbeat events.
- Batch events with a small payload cap and flush periodically or on `pagehide` with `sendBeacon`/`keepalive` where supported.
- Assign a `client_event_id` for idempotency.
- Validate event names and property schemas server-side.
- Validate tenant, menu, location, and product relationships; never trust ids supplied by the client.
- Rate-limit ingestion by IP/session and cap events per batch.
- Whitelist event properties. Never accept arbitrary sensitive client payloads.
- Record order completion from trusted server routes/webhooks, not only from the browser.

## Proposed Data Model

Exact DDL should be designed during planning, but the expected logical model is:

### `menu_sessions`

- `id`
- `tenant_id`
- `menu_id`
- `location_id` nullable
- `qr_code_id` nullable
- `started_at`
- `last_seen_at`
- `ended_at` nullable
- `entry_source`
- `device_class`
- `language`
- privacy/consent mode if required by the deployment region

No name, phone, email, precise location, or cross-tenant identity belongs in this table.

### `menu_events`

- `id`
- `client_event_id` unique
- `tenant_id`
- `session_id`
- `menu_id`
- `location_id` nullable
- `product_id` nullable
- `order_id` nullable
- `event_name`
- `occurred_at`
- `duration_ms` nullable
- `quantity` nullable
- `amount` nullable
- `properties` constrained JSONB
- `created_at`

### Order Attribution

Add a nullable analytics session reference to orders so a trusted completed order can be attributed to the originating menu session. Anonymous analytics must continue to work if the customer rejects optional tracking, subject to the final privacy policy.

### Aggregates

Start with PostgreSQL daily aggregates rather than introducing another analytics platform:

- `product_analytics_daily`
- `menu_analytics_daily`
- optional location/order-type dimensions

Aggregate raw events through an idempotent scheduled job or database function. Retain raw events for a deliberately chosen short period and aggregates longer. Retention must be documented and configurable before launch.

Move to a dedicated analytical store only after measured query volume, event volume, or retention needs justify it.

## Tenant Dashboard Information Architecture

### Overview

Default filters:

- Last 7, 30, or 90 days.
- Menu.
- Location.
- Order type.
- Feed/List mode when meaningful.

Primary KPIs:

- Menu sessions.
- Completed orders.
- Menu conversion rate.
- Revenue.
- Average order value.
- Revenue per session.
- Cart abandonment.
- Checkout abandonment.
- Median time to order.

Every KPI should show comparison with the previous equivalent period and explain its denominator.

### Funnel

Display the session-level funnel:

```text
Menu sessions
  -> Engaged sessions
  -> Product detail/customization
  -> Added to cart
  -> Checkout started
  -> Order completed
```

Allow the owner to inspect drop-off percentages between stages.

### Product Performance

The product table should support sorting by:

- Unique impressions.
- Engaged views.
- Median attention time.
- Detail-open rate.
- Add-to-cart rate.
- Remove rate.
- Purchased quantity.
- Product purchase conversion.
- Revenue.

Include minimum sample thresholds and low-data labels so a product with two views is not presented as a reliable winner.

### Explainable Recommendations

Start with deterministic rules and show the evidence:

- **High conversion, low exposure:** candidate for featured placement.
- **High attention, low add-to-cart:** review price, description, portion clarity, or offer.
- **High add-to-cart, high removal:** investigate option pricing, fees, or mismatch between card and detail.
- **Strong detail-open rate, weak purchase rate:** inspect customization complexity or value communication.
- **Media uplift with sufficient sample:** keep or expand the media treatment, labeled as correlation unless tested.
- **Frequently purchased together:** candidate bundle or cross-sell.

Recommendations must never automatically reorder the live menu in the MVP. The owner approves changes.

## Delivery Roadmap

Effort ranges below assume one experienced full-stack engineer familiar with this repository. They are planning inputs, not delivery commitments.

### Phase 0 — Product Contract and Baseline

**Goal:** eliminate ambiguity before collecting data.

Deliverables:

- Final Feed/List interaction contract and responsive wireframes.
- Approved metric dictionary and attribution rules.
- Privacy, consent, and retention decision for target markets.
- Current baseline for menu traffic, orders, conversion, and performance.
- Feature packaging decision: which capabilities belong to Free, Pro, or another plan.
- Instrumentation QA specification and test tenant.

Acceptance criteria:

- Each dashboard metric has a numerator, denominator, time window, and source of truth.
- The team can describe exactly how an abandoned cart differs from an abandoned checkout.
- No implementation begins with unresolved legal/retention or default-view decisions.

Indicative effort: 2-4 days.

### Phase 1 — Analytics Foundation

**Goal:** create reliable session-to-order attribution while preserving current UX.

Deliverables:

- Database migration for sessions, events, order attribution, indexes, RLS, and retention support.
- Batched public ingestion endpoint with schema validation, relationship validation, idempotency, and rate limits.
- Client analytics module with session lifecycle, batching, fail-open delivery, and visibility awareness.
- Instrument existing grid/modal/cart/checkout flows before introducing the new feed.
- Server-side order-created/completed/cancelled events.
- Internal event inspector or debug mode for QA.
- Contract and integration tests.

Acceptance criteria:

- A QA session can be traced from visit through completed order.
- Replayed batches do not duplicate events.
- Invalid cross-tenant product/menu ids are rejected.
- Analytics failure does not affect ordering.
- Attention time stops when the page is hidden.
- Test events can be excluded from production reporting.

Indicative effort: 5-8 days.

### Phase 2 — Visual Feed MVP

**Goal:** make rich media the primary mobile discovery experience.

Deliverables:

- Feed/List view switch.
- Tenant-level feature flag and default-view setting.
- Feed product card with image/video, price, tags, availability, and order action.
- Viewport-aware media playback and lazy loading.
- Stable return position after product customization.
- Existing category, search, language, cart, and checkout compatibility.
- Accessibility and reduced-motion behavior.
- Responsive and performance testing on representative mobile devices.

Acceptance criteria:

- Feed can be enabled for a pilot tenant without changing other tenants.
- A customer can discover, customize, add, checkout, and complete an order from the feed.
- Only the active/nearby media is loaded or played.
- List mode remains available and functionally equivalent.
- No regression in menu availability, pricing, options, ingredients, or order totals.
- Performance budgets from Phase 0 are met or an explicit exception is approved.

Indicative effort: 6-10 days.

### Phase 3 — Analytics Dashboard MVP

**Goal:** convert event data into decisions for the restaurant owner.

Deliverables:

- Daily aggregation pipeline and backfill strategy.
- Overview KPIs and period comparison.
- Session funnel with stage drop-offs.
- Product performance table.
- Date, menu, location, and order-type filters.
- Metric definitions and data-quality states.
- Empty, low-volume, delayed-data, and error states.
- CSV export only if validated as a real owner need.

Acceptance criteria:

- Dashboard totals reconcile with trusted orders for the selected period.
- Filters cannot leak cross-tenant data.
- Low-sample products are clearly labeled.
- Owners can identify high-converting products and the largest funnel drop-off without reading documentation.
- Aggregate queries meet the agreed dashboard response-time target.

Indicative effort: 6-10 days.

### Phase 4 — Recommendations and Merchandising

**Goal:** make analytics actionable without creating an opaque algorithm.

Deliverables:

- Rule-based recommendation engine with sample thresholds.
- Recommendation cards linking directly to the relevant product or menu editor.
- Manual featured-placement and feed-order controls.
- Before/after measurement for accepted recommendations.
- Frequently-bought-together analysis and optional bundle suggestions.

Acceptance criteria:

- Every recommendation exposes its evidence and sample window.
- No recommendation modifies live menu content without owner approval.
- Owners can dismiss recommendations and avoid repeated noise.
- Changes can be measured against a defined pre-change baseline.

Indicative effort: 5-8 days.

### Phase 5 — Controlled Optimization

**Goal:** learn which presentation changes actually improve commercial outcomes.

Potential deliverables:

- A/B testing for hero image/video, product copy, price presentation, or placement.
- Deterministic experiment assignment by anonymous session.
- Guardrails for order conversion, revenue per session, and performance.
- Statistical minimums and experiment stopping rules.
- Optional ranking assistance based on tenant objectives.

This phase should not begin until event quality, sample volume, and owner demand are demonstrated.

Indicative effort: separate product cycle or substantial follow-up phase.

## Recommended Release Strategy

1. Ship the analytics foundation dark.
2. Validate events with internal and demo tenants.
3. Enable the feed for a small set of media-rich pilot restaurants.
4. Compare Feed and List sessions using pre-declared metrics and guardrails.
5. Release the dashboard to pilots only after reconciliation with order data.
6. Fix instrumentation and UX gaps before broad rollout.
7. Roll out by tenant percentage with an immediate feature-flag fallback.
8. Update the marketing site only when the promised capability is verifiably live.

Do not use old sessions as a control group without accounting for seasonality, traffic source, operating hours, and menu changes.

## Success Metrics

### Primary Business Metrics

- Completed orders per eligible menu session.
- Revenue per eligible menu session.
- Checkout completion rate.
- Median time from session start to order creation.

### Product Adoption Metrics

- Percentage of eligible tenants enabling Feed mode.
- Percentage of active products with high-quality media.
- Percentage of owners returning to the analytics dashboard.
- Percentage of recommendations reviewed and accepted.

### Guardrails

- Public-menu LCP and interaction latency.
- JavaScript and media transfer size.
- Crash/error rate.
- Order-total and attribution reconciliation.
- Accessibility conformance.
- Analytics endpoint rejection and drop rate.
- Support requests or owner confusion about metrics.

## Privacy, Security, and Data Governance

- Keep analytics first-party and tenant-scoped.
- Do not store customer PII in behavioral event properties.
- Do not create a durable cross-restaurant consumer identity.
- Document lawful basis/consent behavior for each launch market before rollout.
- Provide deletion and retention behavior consistent with the platform privacy policy.
- Treat user agents, IP-derived metadata, and raw search text as potentially sensitive.
- Restrict event properties to a schema-controlled allowlist.
- Apply RLS and explicit tenant filters to raw and aggregate data.
- Use server-side service access only where necessary and keep public ingestion mutation-only.
- Rate-limit and size-limit public event batches.
- Prevent event ingestion from changing product, order, or payment state.
- Ensure exports cannot expose another tenant's data.

## Performance Requirements

- Feed media must not all load at once.
- Only the first meaningful visual may be eager-loaded; subsequent media is lazy.
- Video pauses offscreen and on hidden tabs.
- A poster image is always available for slow networks and reduced-data modes.
- Analytics is batched and scheduled away from critical interaction work.
- Dashboard reads aggregates for long ranges rather than scanning raw events.
- New database indexes are justified by the exact dashboard and aggregation queries.
- Public menu Lighthouse and real-user performance baselines are captured before rollout.

## Testing Strategy

### Automated

- Event schema and sanitization unit tests.
- Session expiry and idempotency tests.
- Tenant/menu/product relationship authorization tests.
- Attention-timer tests for viewport and page visibility transitions.
- Cart/order attribution integration tests.
- Aggregate reconciliation tests against seeded sessions and orders.
- Dashboard tenant-isolation tests.
- Feed-to-checkout end-to-end test for simple and configurable products.

### Manual and Pilot QA

- iOS Safari and Android Chrome.
- Slow 4G and data-saver conditions.
- Reduced motion and screen reader navigation.
- Video unavailable, poster missing, or embed blocked.
- Offline/analytics endpoint unavailable while ordering remains functional.
- Multiple menus, locations, languages, and order types.
- Free, paid, cancelled, and failed-payment orders.

## Product Packaging Hypothesis

Validate before implementation:

- Feed/List browsing and basic product analytics can increase the value of every plan.
- Rich video presentation and advanced analytics can support Pro positioning.
- Explainable recommendations and experiments can be a higher-tier capability.

Packaging must not make basic data accuracy or privacy controls a paid feature.

## Marketing and Positioning

The current QR/WhatsApp/scan-count positioning undersells the product. After the relevant phases ship, update the product narrative around:

- Visual discovery.
- Direct ordering and payment.
- Product-level conversion intelligence.
- Better menu decisions based on observable behavior.

Recommended high-level message:

> A visual menu that turns attention into orders and behavior into growth.

Marketing copy must distinguish currently shipped capabilities from roadmap promises.

## Decisions Required Before Planning

1. Is Feed the mobile default, an opt-in tenant setting, or a customer-selected view?
2. What media ratio and maximum video duration will XmartMenu recommend?
3. Are direct uploaded videos supported in the feed, or only optimized external media/posters?
4. What constitutes an eligible session for conversion calculations?
5. What order statuses count as conversion for cash, WhatsApp, and card flows?
6. What is the attribution window between session and order?
7. What raw-event retention period is acceptable?
8. Which markets and privacy regimes are in the first rollout?
9. Which features belong to each subscription plan?
10. What minimum sample thresholds suppress unreliable recommendations?
11. Does a tenant control feed order manually, or does the system only suggest changes?
12. Which performance budgets block rollout?

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Video degrades menu performance | Viewport-aware loading, poster fallback, strict media budgets |
| Event volume grows too quickly | Aggregate duration events, batch ingestion, short raw retention |
| Analytics counts are distrusted | Metric dictionary, reconciliation, visible definitions, QA inspector |
| Client events are spoofed | Server validation, rate limits, trusted server-side order outcomes |
| Feed reduces fast lookup | Preserve search, categories, and List mode |
| Low-volume restaurants receive noisy advice | Minimum sample thresholds and low-data states |
| Privacy scope expands accidentally | Property allowlist, no PII, retention controls, pre-launch review |
| Dashboard becomes charts without decisions | Explainable recommendations tied to editor actions |
| Algorithm conflicts with restaurant intent | Recommendations only; owner approves merchandising changes |
| Existing ordering flows regress | Feature flag, pilot tenants, full feed-to-order E2E coverage |

## Breadcrumbs

- `src/components/menu/MenuPage.tsx` — current grid, category navigation, featured carousel, cart integration, and product selection.
- `src/components/menu/ProductModal.tsx` — rich media, options, ingredients, notes, and product navigation.
- `src/components/menu/ScanRecorder.tsx` — current visit-level scan collection.
- `src/app/api/public/scan/route.ts` — existing anonymous public analytics endpoint pattern.
- `src/app/(admin)/dashboard/page.tsx` — current tenant dashboard and scan/product/category metrics.
- `src/app/(admin)/menu/products/[id]/ProductMediaTab.tsx` — media management UI.
- `supabase/migrations/042_product_media.sql` — rich media schema.
- `supabase/migrations/001_initial_schema.sql` — scan event baseline.
- `src/components/menu/CartPanel.tsx` — current cart experience and item lifecycle.
- `src/components/menu/CheckoutModal.tsx` — current checkout flow and attribution touchpoint.
- `src/app/api/orders/route.ts` — trusted server-side order creation path.
- `src/app/api/stripe/webhooks/route.ts` — trusted payment outcome path.

## How to Start This Initiative

When this becomes the selected product initiative, use this document as the source brief. Begin with the decisions and baseline work in Phase 0 rather than jumping directly into feed implementation.

## Notes

- This guide intentionally separates the visual feed from personalized ranking. The feed can deliver value before an algorithm exists.
- Instrument the existing grid before launching the feed so the team has a baseline and can compare behaviors.
- Product ordering and payment outcomes are more valuable than attention alone; optimize for completed orders and revenue per session, with performance and accessibility as guardrails.
- Do not update public claims about product-level attention or abandonment until the event pipeline and dashboard are live and verified.
