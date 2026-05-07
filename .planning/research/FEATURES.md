# Feature Landscape: v1.3 Marketing Landing Page

**Domain:** SaaS marketing landing page — restaurant/food-service digital menu platform
**Researched:** 2026-05-07
**Downstream consumer:** Roadmapper — section prioritization, copy complexity, anti-features
**Confidence:** HIGH on structure/patterns; MEDIUM on specific conversion numbers (vary by vertical)

---

## Context: What This Page Must Communicate

xmartmenu's core promise: a restaurant owner goes from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed. The landing page is the first place a prospective Brazilian restaurant owner encounters this claim. Every section either supports or undermines that promise.

**Target visitor profile:**
- Brazilian restaurant owner (dono de restaurante, dono de bar, dono de café)
- Browsing on a phone, probably during or after service hours
- Zero technical skills; will leave if confused within 5 seconds
- Primary fear: "another complicated software that takes days to set up"
- Primary motivation: "I want a menu my customers can see on their phone"

**Page language:** English only (product is English-first). PT/EN i18n is a Phase 13 concern.

---

## Section Priority Map

| Priority | Section | Category | Copy Complexity |
|----------|---------|----------|-----------------|
| 1 | Hero | Table stakes | HIGH — headline + subhead + CTA must nail the promise |
| 2 | How It Works | Table stakes | MEDIUM — 3-step flow, outcome-first |
| 3 | Live Demo link | Table stakes | LOW — link + framing copy only |
| 4 | Feature blocks | Table stakes | MEDIUM — 4 blocks, each needs benefit headline + 2 sentences |
| 5 | Pricing | Table stakes | LOW — "Free during beta" card + honest future intent |
| 6 | FAQ | Table stakes | MEDIUM — 6-8 questions, answer concisely |
| 7 | Footer | Table stakes | LOW — links only, legal placeholders |
| 8 | Social proof | Differentiator (when populated) | LOW build now, LOW ongoing — placeholder state is correct for v1 |
| 9 | Trust bar / logo strip | Differentiator | LOW — defer until real logos exist |

---

## Table Stakes Sections

These sections appear on every credible SaaS landing page. Omitting any of them signals an unfinished product. [Source: unbounce.com analysis of SaaS pages; choiceqr.com; menutiger.com reference implementations]

### 1. Hero Section (Priority 1)

**What it must do:** Communicate the value prop within 3 seconds. The visitor should immediately know: what the product is, who it is for, and what happens when they click.

**Proven headline formula (HIGH confidence):**
Under 8 words. Problem-outcome or outcome-for-who framing. Never start with the product name.

- Pattern A (outcome): "Your restaurant menu, live in 10 minutes"
- Pattern B (problem + outcome): "Stop printing menus. Go digital today."
- Pattern C (who + outcome): "Restaurant owners: your digital menu in minutes, not days"

**Subheadline role:** One sentence that names the mechanism and removes the biggest objection ("no tech skills needed").

Example structure: "[Outcome]. [How it works in plain language]. [Objection removed]."
Draft: "Create a QR-code menu your customers can open on any phone. Add your categories, upload photos, share the link — no coding, no designer."

**CTA primary:** "Get started free" or "Create your menu — it's free"
- Avoid: "Sign up", "Get started", "Learn more" — too generic
- Add microcopy below button: "No credit card required. Ready in minutes."
- The "free" signal must be in the button label OR immediately adjacent, not buried in pricing

**CTA secondary (optional):** "See a live demo" — links to `/demo` tenant
- This is the second-highest converting element for visitors who are not yet ready to commit

**Hero visual:** Either a device mockup showing a real menu (the demo tenant), or a short looping video/gif of the QR code scan → menu display flow. Device mockup is lower complexity and sufficient for v1.

**Placement rule:** Primary CTA must be above the fold on mobile (375px viewport). 60%+ of visitor attention is above the fold; this is where conversion decisions are made.

**Copy complexity:** HIGH. The headline, subhead, and button copy deserve the most editorial iteration of any section on the page.

---

### 2. How It Works Section (Priority 2)

**What it must do:** Show that the time-to-value is genuinely short. Restaurant owners are skeptical of "easy" claims. A concrete 3-step flow makes the promise credible.

**Pattern (HIGH confidence):** Three numbered steps, each with an icon and 1 headline + 1 sentence of explanation. Total reading time under 20 seconds.

**Recommended flow for xmartmenu:**
1. **Sign up** — "Create your free account in 30 seconds. No credit card needed."
2. **Build your menu** — "Add categories and dishes. Upload photos. Set prices. Takes about 10 minutes."
3. **Share your QR code** — "Download your QR code and put it on every table. Customers scan and order."

**Variants to avoid:** "How it works" sections that list 6-8 steps signal complexity. Cut to 3. If there is a 4th natural step (e.g., "Receive orders"), add it only if it meaningfully advances the story.

**Copy complexity:** MEDIUM. Steps are short but each word carries weight. "About 10 minutes" is more credible than "in minutes."

---

### 3. Live Demo Section (Priority 3)

**What it must do:** Let the visitor experience the product without signing up. This is the highest-trust action on the page — seeing the real UI removes all "what does it actually look like" objections.

**Implementation for xmartmenu (already in SEED-005):** Provision a `demo` tenant. Link to `/demo` (which resolves as a real public menu page). The section needs only: a device mockup image or embedded iframe, a headline, and a CTA button.

**Copy pattern:**
- Section headline: "See xmartmenu in action" or "This is what your customers see"
- Body: "Scan the QR code below or click to open the live demo menu."
- CTA: "Open live demo" → `/{demo-slug}/{menu-slug}`

**Demo tenant requirements (dependency):** The demo tenant must have realistic content — categories, products with photos, prices in a real currency. The AI text and image seeding tools (v1.2) are the fastest way to populate this. This is a hard dependency for the landing page to look credible.

**Interactive vs. static:** A real link to the live menu (not a screenshot) is strongly preferred. Only 4% of SaaS companies use interactive demos despite data showing they are the highest-trust element. Xmartmenu already has this capability via the `/demo` tenant — zero extra engineering.

**Copy complexity:** LOW — framing copy only. The product itself does the work.

---

### 4. Feature Blocks (Priority 4)

**What it must do:** Map each shipped feature to a customer benefit, not a technical description. Four features are available and all are real differentiators from competitors.

**Pattern (HIGH confidence from unbounce/klientboost research):** Alternating left/right image + text blocks (on desktop) OR stacked cards (on mobile). Each block: benefit headline + 2-sentence explanation + optional screenshot/icon.

**The four blocks (in recommended order):**

| Block | Feature | Benefit Headline | Copy Angle | Complexity |
|-------|---------|-----------------|------------|------------|
| 1 | QR code generation | "One QR code. Every table." | Customers scan, menu opens instantly on their phone. No app download. No paper. | LOW |
| 2 | Customer ordering | "Customers order from the menu. You receive it instantly." | Direct ordering from the digital menu. No missed orders from shouting across the room. | MEDIUM — ordering must not be oversold (it is feature-flagged per tenant) |
| 3 | Multi-language menu | "Your menu, in any language." | English, Portuguese, Spanish — set it once, your customers see the right language automatically. | LOW |
| 4 | AI-powered setup | "Your menu, ready in minutes — not hours." | Upload a photo of your existing paper menu. Our AI reads it and builds your digital menu automatically. | MEDIUM — OCR is the headline story; text seeding is the mechanism |

**Notes on copy honesty:**
- Block 2 (ordering): The ordering feature is controlled by a feature flag (`orders_enabled`). Copy should be accurate: "Customers can order directly from the menu" — no claim that it's enabled by default for all accounts.
- Block 4 (AI): The OCR tool is superadmin-only in v1.2. The landing page can describe the outcome ("upload a photo of your menu") as a service experience (the superadmin does it for the tenant during onboarding), not a self-serve action. This is honest and differentiating.

**Copy complexity:** MEDIUM per block. Four blocks total. Benefit headlines need the most care — avoid feature-first wording.

---

### 5. Pricing Section (Priority 5)

**What it must do:** Remove the "how much will this cost me?" objection immediately. For a beta product with no Stripe integration yet, the honest answer is "free" — and that is strong copy.

**Pattern for "free during beta" (HIGH confidence):**

Single card layout (not a comparison table, since there is only one tier):

```
[Badge: Beta]
Free
$0 / month

What's included:
- Digital QR code menu
- Unlimited products and categories
- Customer ordering
- Multi-language support
- AI-assisted setup

[Get started free]

Pricing will be introduced after beta. Early users lock in a founding member rate.
```

**Key principles:**
- "Founding member rate" framing: honest (no rate is promised), creates mild urgency, rewards early adoption
- Do NOT promise a specific future price. That becomes a contractual obligation.
- Do NOT show a crossed-out "normally $X/month" unless that price is real and published. Fake anchor pricing is an anti-pattern and in some jurisdictions illegal.
- The Stripe integration is deferred (SEED-003). Pricing section must not reference payment flows that don't exist.

**Copy complexity:** LOW — single tier, short list, two sentences of future intent.

---

### 6. FAQ Section (Priority 6)

**What it must do:** Answer the 6-8 questions a restaurant owner asks before signing up. These are objection-handling questions, not documentation.

**Recommended questions for xmartmenu:**

| # | Question | Answer angle | Copy complexity |
|---|---------|--------------|-----------------|
| 1 | "Do my customers need to download an app?" | No app needed. They scan the QR code and the menu opens in their browser. | LOW |
| 2 | "How long does it take to set up?" | Most restaurants are ready in under 10 minutes. | LOW |
| 3 | "Is it really free?" | Yes, during our beta. No credit card required. | LOW |
| 4 | "What languages does the menu support?" | English, Portuguese, Spanish, and more. You control which languages appear. | LOW |
| 5 | "Can my customers order directly from the menu?" | Yes. With ordering enabled, customers add items to their cart and submit directly. | MEDIUM — feature-flag caveat |
| 6 | "What happens to my data if I stop using xmartmenu?" | Your data belongs to you. You can export your menu at any time. | MEDIUM — must be accurate, check export capability |
| 7 | "Do I need a developer or designer?" | No technical skills required. The setup is guided and takes minutes. | LOW |
| 8 | "Is this secure?" | Your menu is hosted securely. Customer data is protected with industry-standard encryption (Supabase/PostgreSQL). | LOW |

**Format:** Accordion (collapsed by default) is the standard pattern — keeps the section scannable without overwhelming vertical space.

**Copy complexity:** MEDIUM total. Individual answers are short, but questions 5 and 6 need factual verification against the product.

**FAQ dependency note:** Question 6 ("export my data") requires that a data export mechanism exists or that copy is written accurately around what the tenant actually controls. If no export exists, answer honestly: "Your data is stored securely in your account and is never deleted while your account is active." Avoid implying export capability that doesn't exist.

---

### 7. Footer (Priority 7)

**What it must do:** Provide legal links and basic navigation. Must exist before public launch — legal docs are a hard prerequisite.

**Standard footer content:**

```
[Logo]  [Tagline — optional]

Product          Company           Legal
Get started      About             Privacy Policy
Demo             Contact           Terms of Service
Pricing          Blog (future)

© 2026 xmartmenu. All rights reserved.
```

**Legal prerequisites (hard blockers for launch, NOT implemented in this milestone):**
- Privacy Policy — required by LGPD (Brazil), GDPR (EU-adjacent), and Google/Meta ad policies
- Terms of Service — required before any account can be created
- Recommended approach per SEED-005: generate via Termly or iubenda template, customize, publish as static pages

**Copy complexity:** LOW for footer links. HIGH DEPENDENCY on legal docs which are out of scope but blocking.

---

## Differentiator Sections

These sections are not required for a credible v1 launch but meaningfully increase conversion when populated with real content. Building the structural shell now, with honest placeholder states, is the right approach.

### 8. Social Proof / Testimonials (Priority 8)

**Current state:** Zero customers. Zero testimonials. This is expected for a pre-launch product.

**What to build now:** The section shell with an honest placeholder state.

**Placeholder pattern options:**

Option A — Transparent "early access" framing:
```
[Section headline: "What restaurant owners are saying"]
[Placeholder: "We're gathering our first success stories. Be among the first."]
[CTA: "Join the beta" → /auth/register]
```

Option B — Skip the section entirely in v1 and add it in a future deploy when real quotes exist.

**ANTI-PATTERN (do not do):**
- Do NOT fabricate testimonials. FTC enforcement in 2025 explicitly targets fake reviews. Discovery destroys brand trust permanently.
- Do NOT use stock photo faces next to invented quotes. Visitors recognize this pattern as fake.
- Do NOT display metrics like "10,000 restaurants trust us" if the real number is 0 or 3.
- Do NOT pull from AI-generated "realistic" testimonials. Even if technically disclosed, the trust damage is asymmetric.

**When testimonials become available:** They need: full name, restaurant name, specific outcome ("reduced our printing costs", "our customers love scanning at the table"), and optionally a photo. "Great product!" generic quotes do not convert.

**Copy complexity:** LOW to build shell. LOW ongoing fill (just add real quotes). HIGH risk if faked.

---

### 9. Trust Bar / Logo Strip (Priority 9)

A row of customer or partner logos just below the hero. Extremely high trust signal when populated. Useless or damaging when faked.

**Current state:** No customer logos available. Skip in v1.

**When to add:** After first 5-10 real restaurant customers consent to being named publicly.

**Copy complexity:** None — logos only.

---

## Anti-Patterns — Explicit Do-Not-Build List

These are patterns that appear commonly but actively damage conversion or trust. The roadmapper must treat these as hard constraints.

| Anti-Pattern | Why It Fails | What to Do Instead |
|---|---|---|
| Fake testimonials or stock-photo personas | FTC enforcement target in 2025; "too perfect" quotes are now immediately recognized as fake by visitors | Build placeholder section shell; add real quotes as they arrive |
| Fake metrics ("trusted by 10,000 restaurants") | If the real number is <10, discovery creates catastrophic trust damage | Either show zero metrics or frame as "early access — join the first restaurants" |
| Crossed-out fake anchor pricing ("~~$49/month~~ Free today") | Deceptive pricing is illegal in Brazil (PROCON) and EU; also signals desperation | "Free during beta" with no fabricated comparison price |
| 10+ fields on the signup form | Every extra field cuts conversion. Research shows 3-5 fields max for SMB | Name + email + password or email + password only. Collect restaurant details in onboarding |
| Multiple competing CTAs in the hero | Paralyzes the visitor. "Get started free", "Watch demo", "Learn more", "See pricing" in the same above-the-fold block | One primary CTA in hero. Secondary CTA ("See demo") is acceptable only if visually subordinate |
| Feature-first headline ("The all-in-one QR menu platform") | Says nothing about what the visitor gets | Outcome-first: "Your restaurant menu, live in 10 minutes" |
| Generic copy ("easy", "powerful", "seamless") | Every competitor says the same; no differentiation | Specific claims: "10 minutes", "no app download", "any phone", "your existing menu" |
| Overselling ordering as default-on | Ordering is feature-flagged; false expectation = churn | "With ordering enabled" or "activate ordering for your menu" framing |
| Claiming AI is self-serve for tenants | OCR and seeding are superadmin-only in v1.2 | Frame as "we set it up for you" onboarding service, not a self-serve tool |
| Desktop-only design | Target audience is on phones in a kitchen | Mobile-first layout; test on 375px viewport |
| Auto-playing video with sound | Kills mobile UX; restaurants are noisy environments | Silent autoplay only, or play-on-click |

---

## Dependencies on Existing Features

Every section that references a product capability depends on that capability being real, working, and accessible to new signups.

| Landing Page Claim | Feature Required | v1.2 Status | Gate |
|---|---|---|---|
| "QR code per menu" | QR code generation in settings | Shipped | None — works |
| "Customers order from the menu" | Orders feature, `orders_enabled` flag | Shipped | Must be enabled per tenant; copy must be accurate |
| "Multi-language menu" | i18n per tenant in DB | Shipped | None — works |
| "Upload your paper menu, AI reads it" | OCR (superadmin-only) | Shipped | Framed as onboarding service, not self-serve |
| "Ready in 10 minutes" | Onboarding wizard | Shipped | End-to-end flow must be tested before launch |
| "See a live demo" | Demo tenant with real content | NOT YET | Must provision `/demo` tenant before Phase 12 ships |
| "No credit card required" | Auth with no billing step | Shipped | True — Stripe is deferred |
| "Privacy Policy / Terms of Service" | Legal doc pages | NOT YET | Hard blocker for public launch |
| "Export your data" | Data export mechanism | NOT VERIFIED | FAQ answer must reflect actual capability |

**Critical launch blockers:**
1. Demo tenant (`/demo`) must exist with realistic content before the page ships
2. Privacy Policy and Terms of Service pages must exist (static pages, not this milestone)
3. End-to-end signup → onboarding → live menu flow must complete without errors

---

## Copy Complexity Summary (for roadmap sizing)

| Section | Lines of Final Copy | Editorial Rounds | Notes |
|---------|--------------------|--------------------|-------|
| Hero headline + subhead | 3-5 lines | 3+ rounds | Highest impact, most iteration |
| Hero CTA + microcopy | 2 lines | 2 rounds | |
| How It Works (3 steps) | 9 lines | 2 rounds | |
| Demo section framing | 3 lines | 1 round | |
| Feature blocks (4 × 3 lines) | 12 lines | 2 rounds per block | |
| Pricing card | 8-10 lines | 1 round | |
| FAQ (8 Q+A) | 24-32 lines | 1-2 rounds | Some answers need product verification |
| Footer | 12-15 links | 1 round | Depends on legal docs existing |
| Social proof placeholder | 3 lines | 1 round | |
| **Total** | ~75-85 lines | — | English first; PT/EN in Phase 13 |

---

## Section Order Recommendation

Standard high-converting SaaS page sequence, adapted for this product and audience:

```
1. Nav bar          — Logo + "Log in" + "Get started free" (sticky)
2. Hero             — Headline + subhead + primary CTA + demo secondary CTA + device mockup
3. How It Works     — 3-step numbered flow
4. Live Demo        — Device frame + link to /demo tenant
5. Feature blocks   — 4 alternating blocks (QR, Ordering, Multi-language, AI)
6. Social proof     — Placeholder shell (real quotes added as they arrive)
7. Pricing          — Single "Free during beta" card
8. FAQ              — 8 questions, accordion
9. Footer CTA       — Final "Get started free" above footer
10. Footer          — Links + legal
```

**Rationale for this order:** Visitors need to understand what the product is (Hero) before they can evaluate how it works (How It Works). Showing the real product (Demo) before listing features (Feature Blocks) is more credible than features first. Pricing and FAQ handle late-stage objections. Footer CTA captures visitors who scrolled all the way down — these are the highest-intent visitors.

---

## Confidence Assessment

| Area | Confidence | Source |
|------|-----------|--------|
| Section order (table stakes) | HIGH | unbounce.com SaaS page analysis; choiceqr.com; menutiger.com reference implementations |
| Hero copy formula (<8 words, outcome-first) | HIGH | unbounce.com average character count study |
| CTA label patterns ("Get started free") | HIGH | Multiple SaaS conversion studies, 9/12 top pages in klientboost analysis |
| 3-step "How it works" as conversion pattern | HIGH | Standard across restaurant SaaS (menutiger, choiceqr, yumzi) |
| Anti-fake-testimonials guidance | HIGH | FTC enforcement 2025, trust research from unbounce/klientboost |
| "Free during beta" pricing framing | MEDIUM | Directionally confirmed by multiple SaaS examples; specific conversion delta not available |
| Social proof conversion lift (37%) | MEDIUM | Cited in multiple sources but methodology not independently verified |
| Demo tenant as highest-trust element | MEDIUM | "Only 4% use interactive demos" stat from one source; directionally supported by broader research |

---

## Sources

### Primary (HIGH confidence)
- [unbounce.com — State of SaaS Landing Pages](https://unbounce.com/conversion-rate-optimization/the-state-of-saas-landing-pages/) — section order, hero copy formula, CTA patterns, social proof presence rate
- [SaaS Hero — B2B SaaS CTA Best Practices](https://www.saashero.net/design/b2b-saas-landing-cta-practices/) — CTA strategy, SMB vs enterprise patterns
- [Choice QR landing page](https://choiceqr.com/) — reference implementation: restaurant QR SaaS with real section structure
- [Menu Tiger landing page](https://www.menutiger.com/) — reference implementation: restaurant QR SaaS competitor

### Secondary (MEDIUM confidence)
- [klientboost — 51 SaaS Landing Pages](https://www.klientboost.com/landing-pages/saas-landing-page/) — social proof lift stats, CTA label frequency analysis
- [SaaS Hero — Trust Signals](https://www.saashero.net/design/landing-page-design-trust-signals/) — trust signal patterns
- [mouseflow — CTA for SaaS](https://mouseflow.com/blog/ctas-for-saas/) — CTA strategy patterns
- [howdygo — SaaS Product Demo 2026](https://www.howdygo.com/blog/saas-product-demo) — interactive demo trust signal data
- [menucardstudio — QR menu "10 minutes" copy](https://blog.menucardstudio.com/digital-qr-menu/qr-code-menu-for-restaurants-usa/) — "create digital menu in 10 minutes" as established copy pattern in this category

### Tertiary (LOW confidence — directional only)
- WebSearch aggregated findings on fake testimonials FTC enforcement
- WebSearch aggregated findings on "free during beta" pricing conversion
