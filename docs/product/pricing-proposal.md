# XmartMenu pricing (proposal v2)

Status: **proposal for the owner's decision**, 2026-11-12. All prices in US dollars. Nothing here is live: the plans table, Stripe prices and the public pricing section still show the old numbers.

v1 (setup $490, monthly $79–199) was rejected by the owner: a 60-dish menu with photos and AR at ~$500 does not pay the work. **XmartMenu is positioned as the restaurant's website, built by a developer**, not as an app competing with delivery/marketplace platforms. The value we add (custom build, photos, AR, ordering, payments, our support) is priced like a website project plus a website retainer.

## Principles

- **Project + retainer**, like a website agency: a one-time build priced by scope, then a monthly fee for hosting, software, changes and support. First month included in the build. No free plan.
- **Price by scope, not by software features**: the build grows with the number of dishes, the photo work and the AR work.
- **Three monthly versions** (owner's structure): Menu only, Waiter, Payments. Only Payments carries a per-transaction fee, because only there the money passes through XmartMenu (Stripe Connect application fee, already in the code: `plans.transaction_fee_pct` → `application_fee_amount`).
- **Sold in person and approved by us** (XMM-D-2026-11-12-access-request-onboarding).
- **NFC plates** follow the approved Stuscle table (2026-10-12): Plate S $25, L $35, Stand S $40, L $60; wholesale base $15/$20/$25/$40; $10/h machine floor.

## Market anchors (researched 2026-11-12)

| What | Price |
|---|---|
| US small-business website by freelancer / agency (general market) | ~$2k–5k / $5k–15k+ |
| Website maintenance retainer | ~$100–500/mo |
| Restaurant platforms (Popmenu, Owner.com, ChowNow, BentoBox) | $150–500/mo, setup $119–499 |
| Food photography | $50–300 per dish; $2k–5k for 30–60 items |
| AR menu agency setup (US) | $1.5k–5k for a few dishes |
| Self-serve QR menus | $0–50/mo (not our market) |

## Our cost in hours (estimate, measure on the first 5 restaurants)

| Work | 60-dish menu |
|---|---|
| Menu build (import, structure, 2 languages, SEO pages, QR/NFC, training) | ~8 h |
| Photo production on site + editing | ~9 h (shoot ~4 h, editing ~5 min/dish) |
| AR (Rodin + Blender prep + review), food | ~40–45 min/dish → ~40–45 h for 60 dishes |
| AR, drinks in glass (built from scratch) | ~60–90 min/drink |

At an agency rate of $100/h, the photo path is ~$1.7k of time and the full-AR path ~$5.7k of time for 60 dishes. Prices below sit well above that.

## Proposal

### 1. Build (one-time, priced like a website project)

| Package | Price | Includes |
|---|---|---|
| **Essential** | **$2,490** | Branded menu website for the restaurant (its domain or ours), up to 60 items from the restaurant's own photos (we treat and optimize them), 2 languages, hours/contacts/map, SEO pages, Google Business and Instagram links, QR codes, 1 NFC counter stand, training, first month |
| **Signature** | **$4,490** | Essential + **on-site photo production of up to 60 dishes** + 20 per-table NFC plates |
| **Immersive** | **$6,990** | Signature + **AR for 10 hero dishes** (~$250 per dish; the guest sees the dish at real size on the table) |
| **Full Immersive** | **$15,900** | Signature + **AR for the whole menu, up to 60 dishes** (~$190 per dish) |

Extras:
- Menu above 60 items: +$25 per item.
- Extra language: +$190 each.
- Extra location: +$990 each (own QR/NFC set, shared menu).
- AR dish added later: **$299** each (food), **$399** (drink in glass); 5 at once $1,290; remake after a plating change 50%.
- Extra NFC table plates: 10 for $199 (each plate programmed to its table).
- Payment: 50% to start, 50% at launch; Immersive and above can be split in 3 monthly payments.

### 2. Monthly (hosting, software, changes and support)

| Version | Monthly | Yearly (2 months free) | Per transaction | Includes |
|---|---|---|---|---|
| **Menu** | **$149** | $1,490 | — | Hosting of the menu website, AR viewer, analytics, **4 change requests per month done by us**, support |
| **Waiter** | **$249** | $2,490 | — | Menu + guests order from the table (per-table NFC/QR) and call the waiter; orders go to the kitchen display / staff; the bill is paid the usual way |
| **Payments** | **$349** | $3,490 | **1% of each payment made through XmartMenu** (+ Stripe's own fees) | Waiter + guests pay in the menu (card, Apple Pay, Google Pay) into the restaurant's Stripe; online pickup orders |

- **Growth add-on: +$149/mo** — AI chat (text and audio), monthly blog/SEO content, unlimited languages. AI usage above fair use keeps the existing pass-through with markup.
- Extra location: +$99/mo.
- 6-month minimum term, then monthly.
- A Payments restaurant taking $20,000/month through XmartMenu pays $200/month in fees on top of $349.

### 3. Year-one value

| Package | Build | Monthly | Year one |
|---|---|---|---|
| Essential + Menu | $2,490 | $149 | $4,129 (11 billed months) |
| Signature + Waiter | $4,490 | $249 | $7,229 |
| Immersive + Payments | $6,990 | $349 + 1% | $10,829 + fees |
| Full Immersive + Payments | $15,900 | $349 + 1% | $19,739 + fees |

### 4. Founding partners (first 10 restaurants)

30% off the build, monthly at list price locked for 12 months, in exchange for a testimonial, video of AR at the table and permission to measure orders of AR dishes before/after.

## Tension to resolve: the Skale street ladder

The Plan › "Pitch de vendas presencial" ladder lists Xsites from $299 and "XmartMenu $29/mo". With this proposal XmartMenu is the premium site of the ladder (from $2,490 + $149/mo). Xsites stays the entry site for other niches; the ladder line becomes "XmartMenu: restaurant website with menu, ordering and AR, from $2,490 + $149/mo".

## What changes in the product when approved

- `plans`: `menu` $149/$1,490, `orders` (Waiter) $249/$2,490, `payments` $349/$3,490 with `transaction_fee_pct` 0.01; Growth add-on $149 next to today's chat add-on; Stripe prices to match. Existing restaurants keep their price.
- Build packages are sold and invoiced outside the app (proposal + Stripe invoice/payment link), recorded on the access request at approval.
- Public site: no self-serve prices; "Website projects from $2,490 — talk to us".

## Open decisions (owner)

1. Build packages $2,490 / $4,490 / $6,990 / $15,900 — right level for the first US restaurants?
2. Monthly $149 / $249 / $349 and 1% on Payments?
3. AR added later at $299 per dish?
4. 6-month minimum term and 50/50 payment of the build?
5. Founding-partner 30% for the first 10?
