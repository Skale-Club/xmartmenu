---
id: SEED-018
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: building any customer-facing authenticated feature — delivery, private menu, order history, customer panel
scope: medium
---

# SEED-018: Customer Phone OTP Login + Customer Panel

## Why This Matters

Today there is no customer identity in XmartMenu. Every order is anonymous — the restaurant sees items and a total, but has no way to associate an order with a returning customer, track a delivery, or offer a loyalty experience. A customer scanning a QR code is invisible.

**Phone number is the correct primary identifier for restaurant customers.** It's universal (no email required), low-friction to type, already collected during delivery (SEED-020), already used for WhatsApp communication, and familiar from every food app customers already use. An OTP to the phone is the simplest possible authentication: no passwords, no forgotten credentials.

**What this unlocks:**
- Customer panel with current order status and order history
- Foundation for private menu access (SEED-019)
- Foundation for delivery order tracking by phone (SEED-020)
- Phone as the persistent `customer_id` across all orders — even anonymous past orders can be claimed retroactively if the customer provided their phone at checkout

**Scope boundary:**
- Customer login = phone + OTP only
- Tenant/staff login stays unchanged (email + password via Supabase Auth)
- Phone stored as the primary customer identifier on every order (even if the customer never creates an account)

## When to Surface

**Trigger:** when implementing delivery, private menus, or any customer-facing feature that requires identity

Surface during `/gsd:new-milestone` when the scope involves:
- Customer identity or loyalty
- Delivery order management (SEED-020 depends on this)
- Private menu access (SEED-019 depends on this)
- Customer-facing order history or panel

## Scope Estimate

**Medium** — 3–5 days. Four independent phases:

### Phase A: Phone as identifier on orders (no auth yet)
- Add `customer_phone TEXT` column to `orders` table (nullable for now)
- Checkout collects phone number — required for delivery, optional for dine-in/pick-up
- Phone stored on order insert; surfaced in admin orders view and KDS
- This alone gives the restaurant a "all orders from this phone" lookup with no auth overhead

### Phase B: OTP auth + customer session
- Supabase Auth supports Phone OTP natively — `supabase.auth.signInWithOtp({ phone })` and `verifyOtp({ phone, token, type: 'sms' })`
- Customer flow: enter phone → receive OTP → verify → session created
- Customer role is separate from `store-admin` / `store-staff` — a new `customer` role
- `customer_profiles` table: `(id, phone, name, created_at)` — lightweight, no email
- Session persisted across visits to the same restaurant domain

### Phase C: Customer panel
- Route: `restaurantsite.com/me` (or `xmartmenu.skale.club/[slug]/me`)
- Pages:
  - **Active order** — current order status (pending/preparing/ready/out for delivery), items summary, estimated time if set
  - **Order history** — past orders at this restaurant, date, items, total
  - **Restaurant info** — address, hours, phone, social links from tenant data
- Phone-based lookup: all orders where `customer_phone = session.phone` AND `tenant_id = current_tenant`
- No cross-tenant profile — each restaurant's panel is isolated (privacy-preserving by design)

### Phase D: Phone as internal system backbone
- Index `orders.customer_phone` for fast lookups
- Admin orders view: filter by phone number to see all orders from one customer
- KDS: show customer name (if provided) or masked phone on delivery order cards
- Retroactive association: past orders with a matching phone get linked to the profile on first login

## Breadcrumbs

- `src/app/api/public/orders/route.ts` — add `customer_phone` to order insert
- `src/components/menu/CartModal.tsx` — checkout form adds phone field
- `supabase/migrations/` — `orders.customer_phone`, `customer_profiles` table, DB index
- `src/types/database.ts` — `Order`, `CustomerProfile` types
- `src/middleware.ts` — customer session detection for `/me` route
- `src/app/(public)/[slug]/me/` — customer panel routes
- `src/lib/get-effective-tenant.ts` — already fetches tenant; customer panel reuses this

## Notes

- **Supabase Phone OTP is built-in** — no third-party SMS provider needed initially. Supabase uses Twilio under the hood on paid plans; the auth API is the same.
- **SMS cost awareness** — OTP SMS has a per-message cost. Rate-limit to 1 OTP per phone per 60 seconds. Only require login for private menu access and delivery tracking — not for regular dine-in ordering.
- **Phone format** — store in E.164 format (`+15551234567`). Country code selector or auto-detect from tenant's country setting.
- **No cross-tenant profile** — a customer at Sushi Yamamoto and Burger Palace has separate panels at each restaurant's domain. Simpler architecture, better privacy.
- **SEED-019 (public/private menu)** gates the private menu on a valid customer session from this system.
- **SEED-020 (delivery)** requires `customer_phone` on orders and uses the customer panel to show delivery status.
