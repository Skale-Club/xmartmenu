# XmartMenu pricing (proposal v3)

Status: **proposal for the owner's decision**, 2026-11-12. All prices in US dollars. Nothing here is live: the plans table, Stripe prices and the public pricing section still show the old numbers.

## How we got here

- v1 (setup $490, monthly $79–199) undervalued the work: a 60-dish menu with photos and AR for ~$500 does not pay it.
- v2 priced it like an agency with photoscan AR ($2,490–15,900 builds, monthly $149–349) — too expensive: our AR is generated with a low-cost tool (Hyper3D Rodin + Blender review), not photogrammetry, and AR agency prices assume photoscan.
- v3 is the balance the owner asked for: **XmartMenu is the restaurant's website, built and maintained by us**, priced for the work we actually do, without the photoscan premium, and kept simple: one build priced by scope, photos and AR per dish, three monthly versions.

## Principles

- Build + monthly, first month included in the build, no free plan.
- Price by scope: number of dishes, photos, AR dishes.
- Three monthly versions (owner's structure): **Menu**, **Waiter**, **Payments**. Only Payments has a per-transaction fee, because only there the money passes through XmartMenu (Stripe Connect application fee, already in the code: `plans.transaction_fee_pct` → `application_fee_amount`).
- NFC plates follow the approved Stuscle table (2026-10-12).

## Our work in hours (estimate, measure on the first 5 restaurants)

| Work | Time |
|---|---|
| Website/menu build, up to 60 items (import, structure, 2 languages, SEO pages, QR/NFC, training) | ~8 h |
| On-site photos + editing, 60 dishes | ~9 h |
| AR per food dish (Rodin ~$0.50 + Blender prep + review) | ~40–45 min |
| AR per drink in glass (built from scratch) | ~60–90 min |

## Proposal

### 1. Build (one-time)

| Item | Price |
|---|---|
| **Menu website**, up to 60 items: branded site for the restaurant (its domain or ours), the restaurant's own photos treated and optimized, 2 languages, hours/contacts/map, SEO pages, Google/Instagram links, QR codes, 1 NFC counter stand, training, first month | **$1,490** |
| More than 60 items | +$15 per item |
| **On-site dish photos** (shoot + editing) | **$19 per dish** (60 dishes = $1,140) |
| **AR dish** (real size on the table, iPhone + Android + desktop 3D) | **$99 per dish**, $149 per drink in glass |
| AR for 10 dishes or more | $79 per dish |
| Extra language | +$190 |
| NFC table plates, each programmed to its table | 10 for $199, 20 for $349 |

Payment of the build: 50% to start, 50% at launch.

**Examples**

| Restaurant | Build |
|---|---|
| 40 dishes, own photos | $1,490 |
| 60 dishes, our photos, 20 table plates | $1,490 + $1,140 + $349 = **$2,979** |
| 60 dishes, our photos, AR on 10 hero dishes, 20 table plates | $2,979 + $790 = **$3,769** |
| 60 dishes, our photos, AR on all 60, 20 table plates | $2,979 + $4,740 = **$7,719** |

Effective rate on AR: ~$105–130/h at $79–99 per dish — values the work without charging photoscan prices.

### 2. Monthly (hosting, software, changes and support)

| Version | Monthly | Yearly (2 months free) | Per transaction |
|---|---|---|---|
| **Menu** — the menu website, AR viewer, analytics, 3 change requests per month by us, support | **$99** | $990 | — |
| **Waiter** — Menu + guests order from the table (per-table NFC/QR) and call the waiter; orders go to the kitchen display/staff; bill paid the usual way | **$179** | $1,790 | — |
| **Payments** — Waiter + guests pay in the menu (card, Apple Pay, Google Pay) into the restaurant's Stripe; online pickup orders | **$249** | $2,490 | **1% of each payment made through XmartMenu** (+ Stripe's own fees) |

- Growth add-on: +$99/mo (AI chat in text and audio, monthly blog/SEO content, unlimited languages).
- Extra location: +$79/mo.
- 3-month minimum, then monthly.
- Market check: Popmenu $179–499, Owner.com $249 + 5% per order, ChowNow $229–449. Payments at $249 + 1% sits at the entry of that bracket with more included (site built for them, photos, AR).

## What changes in the product when approved

- `plans`: `menu` $99/$990, `orders` (Waiter) $179/$1,790, `payments` $249/$2,490 with `transaction_fee_pct` 0.01; Growth add-on $99; Stripe prices to match. Existing restaurants keep their price.
- The build is quoted and invoiced outside the app (Stripe invoice or payment link) and noted on the access request at approval.
- Public site: no self-serve prices; "Menu websites from $1,490 — talk to us".
- Plan › "Pitch de vendas presencial": replace "XmartMenu $29/mo" with "XmartMenu from $1,490 + $99/mo".

## Open decisions (owner)

1. Build $1,490 up to 60 items?
2. Photos $19/dish and AR $99/dish ($79 from 10)?
3. Monthly $99 / $179 / $249, and 1% on Payments?
4. 3-month minimum and 50/50 build payment?
