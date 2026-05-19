---
id: SEED-022
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: improving checkout conversion, working on payments-plan features, or reducing payment friction
scope: small
---

# SEED-022: Apple Pay, Google Pay, and Contactless Checkout

## Why This Matters

The current Stripe checkout requires the customer to manually type their card number, expiry, and CVC — a 15–20 second friction-heavy flow that kills conversion on mobile. Apple Pay and Google Pay reduce payment to a single biometric tap (Face ID, fingerprint, or double-click). Proximity payment (NFC tap-to-pay) extends this to physical payment terminals.

**On mobile, Apple Pay / Google Pay is now the expected default.** Most customers at a restaurant already have their card saved in Apple Wallet or Google Pay. Showing them a card form first is a UX regression.

**How it works technically:**
- Stripe already handles Apple Pay and Google Pay natively via the **Payment Request Button** / **Payment Element** APIs — the same Stripe Connect setup from v2.0 (SEED-009) covers this with minimal additional work
- Apple Pay requires domain verification (a static file hosted at `/.well-known/apple-developer-merchantid-domain-association`) — Stripe automates this with a one-time setup
- Google Pay requires no domain verification
- NFC/contactless: Apple Pay on iPhone, Google Pay on Android, and Samsung Pay all work via NFC by default when the Payment Request API is active — no separate integration needed

**Only available on the payments plan** (Stripe Connect active). Same gate as the existing payment flow.

## When to Surface

**Trigger:** when reducing checkout friction on mobile, or expanding payments-plan value

Surface during `/gsd:new-milestone` when the scope involves:
- Checkout UX improvements
- Mobile payment conversion optimization
- Payments-plan feature expansion

## Scope Estimate

**Small** — 1–2 days. Components:

1. **Stripe Payment Element upgrade**
   - Replace or augment the current `CardElement` with Stripe's `PaymentElement` — a single component that automatically shows Apple Pay, Google Pay, card, and other available methods based on the device and browser
   - `PaymentElement` detects the customer's device: iPhone/Safari → Apple Pay button; Android/Chrome → Google Pay button; desktop → card form
   - The Stripe integration code change is small — swap `CardElement` for `PaymentElement` in the checkout component

2. **Apple Pay domain verification**
   - Stripe provides the domain association file content via their dashboard
   - Host the file at `/.well-known/apple-developer-merchantid-domain-association` on the platform domain (`xmartmenu.skale.club`)
   - For tenants with custom domains (SEED-010): the file must also be served on their domain — handle via a Next.js `route.ts` at that path that proxies the Stripe-provided content
   - One-time setup per domain

3. **Payment Request Button (fast path)**
   - For tenants who want a dedicated "Pay with Apple Pay / Google Pay" button above the card form: Stripe's `PaymentRequestButton` element
   - Shows native Apple Pay / Google Pay sheet immediately on tap — zero form fields shown
   - Falls back silently to the card form if neither is available (desktop, older devices)

4. **NFC / tap-to-pay**
   - No separate integration needed — Apple Pay via NFC is automatic when the device supports it and the Payment Request API is active
   - The customer can double-click the iPhone side button (or hold their phone to an NFC reader) to pay without opening the browser
   - For physical in-restaurant NFC terminals: out of scope — requires a Stripe Terminal SDK and physical hardware. Noted as a future seed.

5. **UI treatment**
   - Apple Pay button: black with Apple logo — must use Stripe's pre-styled button (Apple brand guidelines require it)
   - Google Pay button: white with Google logo — same requirement
   - Placement: above the card form, labeled "Or pay with card" as the separator
   - No custom styling allowed on the wallet buttons themselves (Apple/Google brand rules)

## Breadcrumbs

- `src/app/(public)/checkout/[orderId]/CheckoutForm.tsx` — swap `CardElement` → `PaymentElement`
- `src/app/api/stripe/payment-intent/route.ts` — PaymentIntent creation (already exists); may need `automatic_payment_methods: { enabled: true }` to unlock wallet payments
- `src/app/.well-known/apple-developer-merchantid-domain-association/route.ts` — serve Apple Pay domain file
- `src/app/api/stripe/payment-intent/route.ts` — ensure `payment_method_types` includes `'card'` + `'apple_pay'` + `'google_pay'` OR use `automatic_payment_methods`
- Stripe Dashboard — one-time: enable Apple Pay domain verification under "Payment methods"

## Notes

- **`PaymentElement` is a drop-in replacement** — Stripe designed it specifically to unify card, Apple Pay, Google Pay, and 20+ other methods in a single component. Switching from `CardElement` to `PaymentElement` is the bulk of the work.
- **`automatic_payment_methods: { enabled: true }` on PaymentIntent** — tells Stripe to enable all compatible payment methods for the device automatically. This is the recommended approach over manually listing `apple_pay`, `google_pay`, etc.
- **Apple Pay domain verification per custom domain** — every domain where Apple Pay is shown must be verified with Apple via Stripe. For tenants with custom domains (SEED-010), the domain association file must be served at their domain. A Next.js route handler at `/.well-known/...` that returns Stripe's static file content handles this universally.
- **NFC tap-to-pay is free** — once Apple Pay is enabled, NFC works automatically on compatible iPhones and Apple Watches. No code change needed. Google Pay works the same way on Android.
- **Physical terminal NFC (Stripe Terminal)** — paying by tapping a physical card reader in the restaurant is a different product (Stripe Terminal, hardware required). Out of scope for this seed; would require a dedicated SEED-023 covering in-person payment hardware.
- **Plan gating** — same gate as today's payment flow: only tenants on the `payments` plan with an active Stripe Connect account can accept payments. Apple Pay/Google Pay inherit this gate automatically.
- **Testing** — Apple Pay only works on real iOS devices (not simulators) and only on HTTPS domains. Use Stripe's test cards for Google Pay on Chrome. Domain verification must complete before Apple Pay button appears in production.
