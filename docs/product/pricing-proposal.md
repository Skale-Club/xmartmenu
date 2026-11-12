# XmartMenu pricing (proposal)

Status: **proposal for the owner's decision**, 2026-11-12. All prices in US dollars. Nothing here is live: the plans table, Stripe prices and the public pricing section still show the old numbers.

## Principles

- **Done-for-you, sold in person, approved by us** (XMM-D-2026-11-12-access-request-onboarding). We are not competing with $17/month self-serve menus; we sell a menu we build, maintain and support.
- **Setup + monthly**, the same shape as the rest of the Skale ladder (Xkedule $499 setup + $89/mo). No permanent free plan; the first month is included in the setup.
- **Three versions, owner's structure:** Menu only, Waiter (orders and waiter calls from the table, paid the usual way), and Payments (the guest pays in XmartMenu).
- **Per-transaction fee only where the money passes through us.** On the Payments version, every payment made through XmartMenu carries a platform fee, collected automatically as the Stripe Connect application fee (already in the code: `plans.transaction_fee_pct` → `application_fee_amount` in `src/lib/orders/owned-payment-intent.ts`). Menu and Waiter have no transaction fee. Even with the fee, the line against delivery apps (15–30%) and Owner.com Flex (5% per order) holds.
- **AR is a premium, one-time purchase per dish.** Our cost is low (labor), the perceived value is high, and no one sells it ready-made to independents. The uplift numbers in the market are vendor claims, so we sell differentiation and measure the effect ourselves.
- **NFC plates are part of the setup**, compatible with the approved Stuscle table (2026-10-12): Plate S $25, Plate L $35, Stand S $40, Stand L $60 retail; wholesale base $15 / $20 / $25 / $40; machine-time floor $10/h.

## Market anchors (researched 2026-11-12)

| Segment | Examples | Price |
|---|---|---|
| Self-serve QR menus | MenuTiger $17–119, Menubly ~$6–10, Square Online Plus $49, MustHaveMenus $19–49 | $0–$50/mo |
| Full-stack restaurant marketing/ordering | Popmenu $179/$299/$499, Owner.com $249 + 5% or $499 flat, ChowNow $229–449 + setup $119–499, Menufy $149–179, BentoBox $119–479 | $150–$500/mo |
| Menu digitization | fastw3b $129 (20 items) / $249 (unlimited) | one-time |
| Food photography | $50–300 per dish; $2k–5k for a 30–60 item menu | one-time |
| AR food menus | old Kabaq/QReal $99–199/mo; US AR agency setup $1.5k–5k; photogrammetry abroad ~$18–48/model | — |
| NFC table stands | ~$10/unit at 250 (AU); paper table tents $0.25–2.22 | per unit |

Sources and dates are in the research notes of the session (third-party figures marked as such).

## Our costs (measured)

- **AR dish:** Hyper3D Rodin ~$0.30–0.50 per model (Creator $30/mo ~60 models; Business $120/mo ~416 models, API). Blender preparation and owner review ~30–45 min for food, ~60–90 min for drinks in glass (built from scratch). Hosting: one GLB + one USDZ, ≤15 MB, negligible.
- **Setup labor (estimate, to be measured on the first 5 restaurants):** 6–10 h for a 60-item menu (import, photos, translation review, QR/NFC programming, training).
- **NFC Plate Small:** base cost $5.76, ~33 min of printer time, ~2 min to program when done in bulk for one restaurant.

## Proposal

### 1. Setup (one-time)

| Item | Price | Includes |
|---|---|---|
| **Launch** (photo menu) | **$490** | Menu built by us from the restaurant's PDF/photos, up to 60 items, 1 menu, up to 2 languages, photo treatment of their dish photos (framing, light, optimization), QR codes, **1 NFC Menu Stand Large for the counter** (retail $60), 1 training session, **first month included** |
| Large menu (61–150 items) | +$200 | |
| Extra language | +$90 each | AI translation + human review |
| Extra location | +$290 each | Same menu, own QR/NFC set |
| On-site photo session | $390 up to 25 dishes, then $12/dish | Phone photography + editing (not a pro studio shoot) |

### 2. Augmented reality (one-time per dish)

| Pack | Price | Per dish |
|---|---|---|
| Single dish (food) | $149 | $149 |
| Single drink in glass | $199 | $199 |
| **Hero 5** | **$590** | $118 |
| **Signature 10** | **$990** | $99 |
| Full 20 | $1,690 | $84.50 |
| Each dish beyond 20 | $79 | $79 |
| Remake after a recipe/plating change | 50% of the dish price | |

Includes: model from the dish photo, real size on the plate, iPhone (AR Quick Look) and Android (Scene Viewer), desktop 3D viewer, our visual review before publishing, hosting while the subscription is active. Gross margin stays above 70% even at $79/dish. Pitch line: "Your five best dishes on the customer's table before they order."

### 3. Monthly

| Version | Monthly | Yearly (2 months free) | Per transaction | Includes |
|---|---|---|---|---|
| **Menu** | **$79** | $790 | — | Digital menu (QR + NFC), photos, up to 2 languages, feed and list views, hours/contacts, analytics, AR viewer for purchased dishes, **2 change requests per month done by us** (self-edits unlimited) |
| **Waiter** | **$149** | $1,490 | — | Menu + guests order from the table (per-table NFC/QR) and call the waiter; orders go to the kitchen display / staff; the bill is paid the usual way |
| **Payments** | **$199** | $1,990 | **1% of each payment made through XmartMenu** (+ Stripe's own fees, charged by Stripe) | Waiter + guests pay in the menu (card, Apple Pay, Google Pay) into the restaurant's Stripe account, pickup ordering paid online |

- **Growth add-on, any version: +$99/mo** — AI chat (text and audio), blog/SEO pages, custom domain, unlimited languages, 2 more change requests per month. AI chat alone: $29/mo (today $20 in Stripe). AI usage above fair use keeps the existing pass-through with markup.
- Extra location: +$49/mo per location.
- Why 1%: a restaurant that takes $20,000/month through XmartMenu pays $200/month in fees, on top of $199 — still far below 15–30% delivery commissions and Owner.com Flex's 5%. Alternatives to consider: 1.5%, or a flat $0.49 per payment (Popmenu/BentoBox charge ~$1 per online order). Today's plan is 0.5%.
- Term: monthly after a 3-month minimum (setup pays the first month).

### 4. NFC for tables (XmartMenu customers)

Each table plate is programmed to its own table, so the guest who taps orders and calls the waiter **for that table**.

| Pack | Price | Per plate |
|---|---|---|
| 10 table plates (Small, Menu style) | $199 | $19.90 |
| 20 table plates | $349 | $17.45 |
| 40 table plates | $649 | $16.23 |
| Large plate instead of Small | +$8 each | |
| Replacement plate | $15 | |

Every per-plate price stays at or above the $15 wholesale base and above the $10/h machine floor (40 plates ≈ 22 printer hours ≈ $220 floor). Above ~10 table packs a month, switch to the China acrylic "NFC Menu" stand (~$2.80–3.20, MOQ 100) already listed in the supplier bank.

### 5. Packages to sell in person (one conversation, one main offer)

| Package | Setup | Monthly | Contents | Savings vs. items |
|---|---|---|---|---|
| **Starter** | $490 | $79 | Launch + Menu | — |
| **Table Service** | $640 | $149 | Launch + 10 table plates + Waiter | $49 |
| **Showcase** | $1,290 | $199 + 1% | Launch + AR Hero 5 + 20 table plates + Payments | $139 |

Year-one value before transaction fees: Starter $1,359, Table Service $2,279, Showcase $3,679 (+ $1,188 with Growth). A Showcase restaurant taking $20k/month through XmartMenu adds ~$2,400/year in fees.

### 6. Founding partners (first 10 restaurants)

30% off the setup and AR, list monthly price locked for 12 months, in exchange for a testimonial, photos/video of AR at the table, and permission to measure AR dish orders before/after. This gives us the real AR numbers the market does not have.

## What changes in the product when this is approved

- `plans`: `menu` $79/$790, `orders` (shown as Waiter) $149/$1,490, `payments` $199/$1,990 with `transaction_fee_pct` 0.01; a Growth add-on ($99) next to the chat add-on ($29); Stripe prices to match. Existing restaurants keep their current price (grandfathered). Check that "Waiter" covers what `orders` unlocks today (table ordering + waiter calls) without payments.
- Public pricing section: no "Get started free"; "from $79/month + setup", "Talk to us".
- Street ladder (Plan › Pitch de vendas): replace "XmartMenu $29/mo" with "from $79/mo + $490 setup".
- AR as a paid feature: a plan-independent purchase recorded per dish (no plan gating needed).

## Open decisions (owner)

1. Versions Menu $79 / Waiter $149 / Payments $199: right level, or lower Menu to $59 for the street?
2. Transaction fee on Payments: 1% (recommended), 1.5%, or a flat $0.49 per payment?
3. AR per dish: $149 single and $590 for 5 — expressive enough?
4. Launch setup $490 with up to 60 items and one counter stand included?
5. Growth as a +$99 add-on on any version?
6. 3-month minimum term?
7. Founding-partner offer for the first 10?
