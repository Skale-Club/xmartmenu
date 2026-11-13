# XmartMenu pricing (proposal v5)

Status: **proposal for the owner's decision**, 2026-11-12. All prices in US dollars. Nothing here is live: the plans table, Stripe prices and the public pricing section still show the old numbers.

## How we got here

- v1 too cheap; v2 priced like photoscan agencies; v3 mixed too many items; v4 set two closed projects with a 20-item base.
- **v5, owner's direction:** v4 is the **list price** (the target once the offer is proven). We start with a **launch price**, lower, to validate the offer, and add a **do-it-yourself** option so the sales pitch always has an answer to "it's too expensive".
- NFC plates are a separate product (Stuscle), sold as a separate project.

## Principles

- **Remote-first:** the restaurant sends its own phone photos; we treat them and generate AR from them; kickoff and training by video call.
- **Closed project + monthly.** First month included in the project, no free plan.
- **Two ways to build:** *we do everything* (default offer) or *you add the items* (cheaper: we build the site and the structure, the restaurant adds dishes and photos in its panel).
- **Three monthly versions:** Menu, Waiter, Payments; only Payments has a per-transaction fee (Stripe Connect application fee, already in the code).

## AR cost, revisited

One dish alone takes ~40–45 min (Rodin ~$0.50 + Blender prep + review). In batches the review is done for many dishes in one Blender scene (`scripts/ar/review-scene.py` reviewed 12 Aurora dishes together), so a batch of 10–20 dishes costs roughly **15–20 min per dish**. At $30–39 per dish that is ~$90–150/h of work.

## Prices

### Projects (one-time)

| Project | Launch price | List price (target) | Extra item |
|---|---|---|---|
| **Menu — you add the items**: we build the menu website (logo, colours, categories, 2 languages, hours/contacts/map, SEO pages, QR codes), 30-min training by video call; the restaurant adds dishes and photos in its panel | **$290** | $490 | — (unlimited, added by the restaurant) |
| **Menu — we do everything**, up to 20 items: everything above, and we add the 20 items with their photos treated | **$590** | $990 | **+$9** per item (list $19) |
| **Menu with AR — we do everything**, up to 20 items, all in AR (the guest sees the dish at real size on the table; iPhone, Android, desktop 3D) | **$1,190** | $2,490 | **+$39** per item with AR (list $99); +$9 without AR |
| **AR only**, added to any menu (including the do-it-yourself one) | **$39** per dish; 10 for $349; 20 for $590 | $99 per dish | — |

- Extra language: +$90 launch (list $190).
- Payment: 50% to start, 50% at launch.
- AR needs a good photo of each dish (dish alone, good light, 2–3 angles); a photo that cannot make a good model is asked again before we start.

**Examples at launch price**

| Restaurant | Project |
|---|---|
| Restaurant adds its own items | $290 |
| 20 items, we do everything | $590 |
| 40 items, we do everything | $590 + 20 × $9 = **$770** |
| 20 items, all in AR | **$1,190** |
| Restaurant adds its own items + AR on its 10 best dishes | $290 + $349 = **$639** |
| 40 items, 20 of them in AR | $1,190 + 20 × $9 = **$1,370** |

### Monthly (hosting, software, changes and support)

| Version | Monthly | Yearly (2 months free) | Per transaction |
|---|---|---|---|
| **Menu** — the menu website, AR viewer, analytics, 3 change requests per month by us, support | **$99** | $990 | — |
| **Waiter** — Menu + guests order from the table and call the waiter; orders go to the kitchen display/staff; bill paid the usual way | **$179** | $1,790 | — |
| **Payments** — Waiter + guests pay in the menu (card, Apple Pay, Google Pay) into the restaurant's Stripe; online pickup orders | **$249** | $2,490 | **1% of each payment made through XmartMenu** (+ Stripe's own fees) |

- Growth add-on: +$99/mo (AI chat in text and audio, monthly blog/SEO content, unlimited languages). Extra location: +$79/mo. 3-month minimum, then monthly.
- Open question: whether the monthly also gets a launch price (see decisions).

## Sales pitch hooks

1. **Lead with "we do everything for you"**: "Send us your menu and your phone photos; in a week your menu website is live." Quote the launch price next to the list price (the list price is the anchor).
2. **"It's too expensive"** → "No problem: we build your menu website and you add the dishes yourself in the panel — $290."
3. **AR as the wow, never as a requirement**: show a dish on the table in AR, then "Start with your 5 or 10 best dishes" ($39 each, 10 for $349).
4. **Launch price is limited**: valid for the first 20 restaurants or until 2027-03-31, whichever comes first; the project price is honoured, the monthly stays at list.
5. **Upgrade path**: you-add-the-items → we do everything → AR on the best dishes → Waiter → Payments.

## Validation (when to move toward list price)

- Track per lead: version chosen, project type (DIY / we do / AR), price objection, close or lose reason.
- Raise toward list price when: 10 projects closed at launch price, and at least 30% of them took AR or "we do everything"; or when the team's build time is booked more than 2 weeks ahead.
- Measure real hours per project and per AR dish on the first 5 restaurants and correct this table.

## What changes in the product when approved

- `plans`: `menu` $99/$990, `orders` (Waiter) $179/$1,790, `payments` $249/$2,490 with `transaction_fee_pct` 0.01; Growth add-on $99; Stripe prices to match. Existing restaurants keep their price.
- The project is quoted and invoiced outside the app (Stripe invoice or payment link) and noted on the access request at approval.
- Public site: no self-serve prices; "Menu websites from $290 — talk to us".
- Plan › "Pitch de vendas presencial": replace "XmartMenu $29/mo" with "XmartMenu from $290 + $99/mo".

## Open decisions (owner)

1. Launch prices: DIY $290, we-do-everything $590 (+$9/item), Menu with AR $1,190 (+$39/AR item), AR alone $39/dish?
2. Launch limit: first 20 restaurants or until 2027-03-31?
3. Monthly at list ($99 / $179 / $249 + 1%) during launch, or a launch monthly too?
