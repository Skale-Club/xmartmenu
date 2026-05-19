---
phase: 39-order-types-customer-operational
type: ui-spec
---

# UI Spec: Order Types — Customer & Operational

## Typography & spacing system (inherited)

- **Font weights:** `font-medium` (500) · `font-black` (900) only
- **Font sizes:** `text-[10px]` · `text-sm` (14px) · `text-xl` (20px)
- **Spacing exceptions allowed:** `p-5` `p-10` `px-5` `py-3` `gap-3`
- **Rounded:** cards `rounded-[1.25rem]`, inner rows `rounded-[1rem]`, inputs `rounded-xl`

---

## Customer UI (CartModal right panel — Plan 02)

### Order Type Selector

Shown only when 2 or more of (dineIn, pickup, delivery) are true.

```
┌─ Order Details ──────────────────────┐
│  ORDER TYPE                          │
│  ┌──────────┐ ┌──────────┐          │
│  │ 🍽 Dine-In│ │ 📦 Pick-Up│         │
│  └──────────┘ └──────────┘          │
│                                      │
│  Your name ─────────────────────    │
│  Phone ──────────────────────────   │
└──────────────────────────────────────┘
```

**Chips:**
- Container: `flex gap-2 flex-wrap`
- Chip (inactive): `px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest border border-zinc-600 text-zinc-400 bg-transparent hover:border-zinc-400 transition-all cursor-pointer`
- Chip (active): `px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest bg-[#e8eaf0] text-zinc-900 border border-[#e8eaf0] cursor-pointer`
- Label above chips: `text-[10px] font-black text-zinc-400 uppercase tracking-widest`
- Only render chips for active types (dineIn=true → show "Dine-In", pickup=true → "Pick-Up", delivery=true → "Delivery")

**Icons (lucide-react):** `UtensilsCrossed` for Dine-In, `Package` for Pick-Up, `Truck` for Delivery

### Delivery Address Input

Shown only when `orderType === 'delivery'`.

```
  DELIVERY ADDRESS
  ┌────────────────────────────────────┐
  │  📍  Street address, city...       │
  └────────────────────────────────────┘
```

- Same styling as name/phone inputs: `w-full pl-9 pr-4 py-3 rounded-xl bg-white/10 text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all border border-zinc-700`
- Icon: `MapPin` from lucide-react (already imported in MenuPage; add to CartModal)
- Placeholder: `"Street address, city..."`
- Required — submitOrder will block if empty when delivery selected

### Delivery Fee in Order Summary Card

When `orderType === 'delivery'` and `deliveryFeeCents > 0`:

```
┌─ Your order ──────────────────────────┐
│  Pizza × 1                   $12.00   │
│  ─────────────────────────────────── │
│  Subtotal                    $12.00   │
│  Delivery fee                 $2.50   │
│  ─────────────────────────────────── │
│  Total                       $14.50   │ ← accent color
└────────────────────────────────────────┘
```

- Subtotal row: `text-xs text-zinc-500` + `text-xs font-bold text-zinc-700`
- Fee row: same styling as subtotal row
- Total row (bottom): unchanged — `text-xs text-zinc-500` + `text-base font-black` with accent color
- Total value = subtotal + deliveryFeeCents / 100

---

## Admin/KDS UI (OrdersClient — Plan 03)

### Fulfillment Badge on OrderCard

Placed below the order number / status chip row, above customer name.

```
┌─────────────────────────────────────┐
│  #A1B2C3D4  [Pending ●]             │
│  [🚚 Delivery]                      │  ← new badge row
│  João Silva — (11) 99999-9999       │
│  Pizza × 1 ...                      │
└─────────────────────────────────────┘
```

Badge styles:
- `dine_in`:  `bg-blue-100 text-blue-700 border border-blue-200`
- `pickup`:   `bg-amber-100 text-amber-700 border border-amber-200`
- `delivery`: `bg-purple-100 text-purple-700 border border-purple-200`

Badge container: `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest`

Badge labels: "Dine-In" · "Pick-Up" · "Delivery"
Icons: `UtensilsCrossed` (w-3 h-3) · `Package` (w-3 h-3) · `Truck` (w-3 h-3)

### Order Type Filter (OrdersClient)

Added as a second row of chips below the existing status filter row.

```
STATUS:   [Active] [Pending] [Preparing] [Ready] [All]
TYPE:     [All] [Dine-In] [Pick-Up] [Delivery]
```

- Label: `text-[10px] font-black text-zinc-500 uppercase tracking-widest`
- Chip styling: match existing status chip style (active = bg-zinc-900 text-white, inactive = bg-zinc-100 text-zinc-500)
- Default: "All" (no order_type filter applied)
- State: `orderTypeFilter: 'all' | 'dine_in' | 'pickup' | 'delivery'`
- Filtering: applied on top of (AND with) the existing status filter
