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

**Phone number is the correct primary identifier for restaurant customers.** It's universal (no email required), low-friction to type, already asked during delivery (SEED-019), already used for WhatsApp communication, and familiar from every food app they already use. An OTP to the phone is the simplest possible authentication: no passwords, no forgotten credentials.

**What this unlocks:**
- Customer panel with current order status + order history
- Foundation for private menu access (SEED-019)
- Foundation for delivery order tracking by phone (SEED-020)
- Phone as the persistent `customer_id` across all orders — even anonymous past orders can be claimed retroactively if the customer provided their phone at checkout

**Scope boundary:**
- Customer login = phone + OTP only
- Tenant/staff login stays unchanged (email + password via Supabase Auth)
- Phone stored as the primary customer identifier on every order (even if the customer doesn't create an account)

## When to Surface

**Trigger:** when implementing delivery, private menus, or any customer-facing feature that requires identity

Surface during `/gsd:new-milestone` when the scope involves:
- Customer identity / loyalty
- Delivery order management (SEED-020 depends on this)
- Private menu access (SEED-019 depends on this)
- Customer-facing order history / panel

## Scope Estimate

**Medium** — 3–5 days. Components:

### Phase A: Phone-as-identifier on orders (no auth yet)
- Add `customer_phone TEXT` column to `orders` table (nullable for now)
- Checkout collects phone number — becomes required for delivery, optional for dine-in/pick-up
- Phone stored on order insert; surfaced in admin orders view and KDS
- This alone gives the restaurant "all orders from this phone" lookup

### Phase B: OTP auth + customer session
- Supabase Auth supports Phone OTP natively — leverage existing infrastructure
- Customer flow: enters phone → receives OTP → verified → session created
- Separate Supabase auth role from `store-admin` / `store-staff` — customer has `customer` role
- `profiles` table extended with `customer` role OR new `customer_profiles` table (phone, name, created_at)
- Session cookie persisted across visits to the same restaurant domain

### Phase C: Customer panel
- Route: `restaurantsite.com/me` (or `xmartmenu.skale.club/[slug]/me`)
- Pages:
  - **Active order** — current order status (pending/preparing/ready/on-the-way), items summary, estimated time
  - **Order history** — past orders at this restaurant, date, items, total
  - **Restaurant info** — address, hours, phone, social links (from tenant data)
- Phone-based lookup: all orders where `customer_phone = session.phone` AND `tenant_id = current_tenant`
- No global cross-tenant profile (each restaurant's panel is isolated)

### Phase D: Phone as internal system backbone
- All order-related queries indexed on `customer_phone`
- Admin orders view: filter by phone number to see all orders from one customer
- KDS: show customer name (if provided) or phone suffix on order cards
- Retroactive association: past orders with matching phone get linked to profile on first login

## Breadcrumbs

- `src/app/api/public/orders/route.ts` — add `customer_phone` to order insert
- `src/components/menu/CartModal.tsx` — checkout form adds phone field
- `supabase/migrations/` — `orders.customer_phone`, `customer_profiles` table
- `src/types/database.ts` — `Order`, `CustomerProfile` types
- `src/middleware.ts` — customer session detection for `/me` route
- `src/app/(public)/[slug]/me/` — customer panel routes
- `src/lib/get-effective-tenant.ts` — already fetches tenant; customer panel reuses this

## Notes

- **Supabase Phone OTP is built-in** — `supabase.auth.signInWithOtp({ phone })` and `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`. No third-party SMS provider needed initially (Supabase uses Twilio under the hood on paid plans).
- **SMS cost awareness** — OTP SMS has a per-message cost. Consider rate-limiting (1 OTP per phone per 60 seconds) and only requiring OTP for private menu / delivery, not dine-in.
- **Phone format** — store E.164 format (`+5511999999999`). Country code selector or auto-detect from restaurant's country setting.
- **No cross-tenant profile** — a customer at Sushi Yamamoto and Burger Palace has separate panels at each restaurant's domain. This is intentional — privacy-preserving and simpler architecture.
- **SEED-019 (public/private menu)** gates the private menu on a valid customer session from this system.
- **SEED-020 (delivery)** requires `customer_phone` on orders and uses the customer panel to show delivery status.
