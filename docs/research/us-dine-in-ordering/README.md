# US dine-in ordering: market study (2026-11-11)

What US ordering products do at each step of a guest's order, compared with XmartMenu. XmartMenu is an in-restaurant QR menu, not a delivery app, so delivery apps (DoorDash) are used only for the dish card and the bag; table ordering and payment follow Toast Mobile Order & Pay, Toast Pay, GoTab, Arryved OpenTab and Sunday.

The owner-facing report (Portuguese, with all screenshots) is a private claude.ai artifact: https://claude.ai/artifact/YBJESTh34eiUfpArkmDf2R

## Method

- Live, 2026-11-11, phone viewport 375x812 with an Android user agent: DoorDash (McDonald's, Wyoming PA, US street address set) and Toast Online Ordering (Rockwoods MN). No order was placed. DoorDash checkout requires sign-in, so it stops at the cart.
- Dine-in table flows come from vendor documentation, because a table session opens only from the physical table QR.
- The XmartMenu side was read from `origin/claude/painel-errors-analysis-he5kuy` (the newest dish card) and `main`.

Screenshots: `shots/` (`doordash-*`, `toast-*`).

## Findings by step

| Step | US market | XmartMenu now | Gap |
|---|---|---|---|
| Dish card | Price is plain text. A white round "+" (32-36px) sits on the photo's bottom-right corner, or the card's corner without a photo. Toast: "+" turns into a check, then "- 1 +" in place. DoorDash: "+" turns into a dark "1x" badge. Dishes with options open the item sheet. | The price pill is the add button ("R$ 79,00 (+)" then "R$ 79,00 \| - 1 +"). Tap targets are 32px. Customisable dishes show no count after adding. | Price-as-button has no US precedent. Tap targets are below 44px. |
| Item sheet | Price inside the button ("Add to Cart $17.00", "Add to cart - $3.59"). Quantity stepper. Special instructions. Required groups labelled, and the button says what is missing ("Make 1 required selection"). Toast confirms with "1 Item(s) added" plus "People also ordered". | Price beside "+ Add". No quantity (XMM-D-2026-11-09-qty-after-add). Notes up to 140 chars. Missing required group is ringed in red. The upsell runs after adding. | Price is not in the button. No quantity. |
| Bag while browsing | Floating pill at the bottom, shown after the first item: "View order — $35.44" plus a bag icon with the count (Toast). DoorDash web uses a header cart count. | Full-width 56px floating bar in the primary colour: count, "View order", total. | Matches. Keep bottom padding so the bar never hides the last card. |
| Bag | At quantity 1 a trash icon replaces "-". Upsell row inside the bag. Total inside the button ("Checkout $35.44"). | 32px stepper, separate trash, Edit. No upsell in the bag. "Checkout" has no amount. | Small. |
| Checkout at the table | One QR per table. The venue picks pay-as-you-go or a tab: the card is pre-authorised on the first order, further rounds fire without re-entering payment, and the guest closes from the phone (optional auto-close). Name and phone (SMS link to the tab). Apple Pay and Google Pay first. Tip presets shown with amounts (Toast 18/20/22/15, none preselected, custom). Separate tax line. Group ordering. | `?table=` sets dine-in. Name and phone. Tip 15/18/20 plus Other, no default, percent only. No tax line. Stripe on a separate English-only page. Each order is separate; no tab, no group order. | Tab and wallets are the largest gaps. |
| After ordering | "Pay my tab" on the menu while a tab is open. Split evenly (Toast Pay), or by item, seat, people or custom amount (Sunday). QR on the printed check. Email receipt and review prompt. | Call waiter and ask for the bill exist. Stripe status page. No view of the table's bill, no split, no pay at the end. | Missing. |

## Recommendations, in order

1. 44px tap targets for "+", "-" and trash (card and bag).
2. Amount inside the buttons ("Add · R$ x", "Checkout · R$ x"). Trash replaces "-" at quantity 1.
3. Payment inside the same flow with Apple Pay and Google Pay first (Stripe Express Checkout Element). Translate the `/checkout` pages.
4. Show the amount next to each tip percentage. US default 18/20/22.
5. Table tab: on the first order choose "pay now" or "open a tab". Then "Order more" and "Pay the bill" stay visible, with split evenly or by item. Needs an owner decision.
6. Dish card back to plain-text price plus a corner "+" (check, then "- 1 +"). Only if the owner reverses XMM-D-2026-11-11-price-button.
7. Tax line for US restaurants whose menu prices exclude tax.

## Sources

- Toast, Guest Experience for Mobile Order & Pay: https://support.toasttab.com/en/article/Guest-Experience-for-Toast-Mobile-Order-Pay?lang=en_US
- Toast, Staff Training Guide, Mobile Order & Pay: https://support.toasttab.com/en/article/Staff-Training-Guide-Toast-Mobile-Order-and-Pay
- Toast Pay: https://support.toasttab.com/en/article/Get-Started-with-Toast-Pay?lang=en_US
- Arryved OpenTab order flow: https://support.arryved.com/portal/en/kb/articles/opentab-order-flow
- GoTab Easy Tab: https://gotab.com/latest/what-is-an-easy-tab--and-why-its-becoming-the-default-guest-flow-in-2026
- Sunday pay at table: https://sundayapp.com/en-gb/pay-at-table/
- From the earlier brief: Uber Eats "+" on the photo; Baymard (swap "add" for "- 1 +" after the first tap); NN/g (touch targets of about 1 cm).
