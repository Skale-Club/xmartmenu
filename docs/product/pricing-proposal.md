# XmartMenu pricing (proposal v4)

Status: **proposal for the owner's decision**, 2026-11-12. All prices in US dollars. Nothing here is live: the plans table, Stripe prices and the public pricing section still show the old numbers.

## How we got here

- v1 (setup $490, monthly $79–199) undervalued the work.
- v2 (agency/photoscan level, $2,490–15,900) was too expensive: our AR is generated with a low-cost tool from photos, not photoscan.
- v3 balanced it but mixed too many items (60-item base, photos, NFC plates).
- **v4, owner's direction:** two **closed projects**, a **20-item base**, a price per extra item, and the monthly versions. **NFC plates are not part of XmartMenu pricing**: they are a separate product (Stuscle), sold as a separate project.

## Principles

- **Remote-first** (owner, 2026-11-12): the restaurant sends its own phone photos; we treat them and generate AR from them (Hyper3D Rodin, Tripo or similar); kickoff and training by video call. Nothing requires someone on site.
- **Closed project + monthly.** First month included in the project, no free plan.
- **Three monthly versions:** Menu, Waiter, Payments. Only Payments has a per-transaction fee, because only there the money passes through XmartMenu (Stripe Connect application fee, already in the code: `plans.transaction_fee_pct` → `application_fee_amount`).

## Our work in hours (estimate, measure on the first 5 restaurants)

| Work | Time |
|---|---|
| Menu website with 20 items (structure, 2 languages, photo treatment, SEO pages, QR codes, training by video call) | ~5 h |
| Each extra item (data + photo treatment) | ~5 min |
| AR per dish (Rodin ~$0.50 + Blender prep + review) | ~40–45 min |

## Proposal

### 1. Closed projects (one-time)

| Project | Price | Extra item |
|---|---|---|
| **Menu** — menu website for the restaurant (its domain or ours), **up to 20 items**, phone photo guide and treatment of the restaurant's photos, 2 languages, hours/contacts/map, SEO pages, Google/Instagram links, QR codes, training by video call, first month | **$990** | **+$19 per item** |
| **Menu with AR** — everything in Menu, and **all 20 items in augmented reality** (the guest sees the dish at real size on the table; iPhone, Android and desktop 3D) | **$2,490** | **+$99 per item with AR** (+$19 if the extra item has no AR) |

- Extra language: +$190.
- Payment: 50% to start, 50% at launch.
- AR needs a good photo of each dish (dish alone, good light, 2–3 angles); a photo that cannot make a good model is asked again before we start.

**Examples**

| Restaurant | Project |
|---|---|
| 20 items, menu only | $990 |
| 45 items, menu only | $990 + 25 × $19 = **$1,465** |
| 20 items, all in AR | **$2,490** |
| 20 hero dishes in AR + 25 more items without AR | $2,490 + 25 × $19 = **$2,965** |
| 45 items, all in AR | $2,490 + 25 × $99 = **$4,965** |

Effective rate: Menu ~$200/h; Menu with AR ~$125/h (20 AR dishes ≈ 15 h + 5 h of menu).

### 2. Monthly (hosting, software, changes and support)

| Version | Monthly | Yearly (2 months free) | Per transaction |
|---|---|---|---|
| **Menu** — the menu website, AR viewer, analytics, 3 change requests per month by us, support | **$99** | $990 | — |
| **Waiter** — Menu + guests order from the table and call the waiter; orders go to the kitchen display/staff; bill paid the usual way | **$179** | $1,790 | — |
| **Payments** — Waiter + guests pay in the menu (card, Apple Pay, Google Pay) into the restaurant's Stripe; online pickup orders | **$249** | $2,490 | **1% of each payment made through XmartMenu** (+ Stripe's own fees) |

- Growth add-on: +$99/mo (AI chat in text and audio, monthly blog/SEO content, unlimited languages).
- Extra location: +$79/mo.
- 3-month minimum, then monthly.
- Market check: Popmenu $179–499, Owner.com $249 + 5% per order, ChowNow $229–449.

## What changes in the product when approved

- `plans`: `menu` $99/$990, `orders` (Waiter) $179/$1,790, `payments` $249/$2,490 with `transaction_fee_pct` 0.01; Growth add-on $99; Stripe prices to match. Existing restaurants keep their price.
- The project is quoted and invoiced outside the app (Stripe invoice or payment link) and noted on the access request at approval.
- Public site: no self-serve prices; "Menu websites from $990 — talk to us".
- Plan › "Pitch de vendas presencial": replace "XmartMenu $29/mo" with "XmartMenu from $990 + $99/mo".

## Open decisions (owner)

1. Menu $990 for 20 items, +$19 per extra item?
2. Menu with AR $2,490 for 20 items, +$99 per extra AR item?
3. Monthly $99 / $179 / $249, and 1% on Payments?
4. 3-month minimum and 50/50 project payment?
