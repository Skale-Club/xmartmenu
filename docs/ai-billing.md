# AI keys and billing

All AI (chat, voice notes, menu translation, blog, seeding, OCR, images) goes
through OpenRouter. Who pays for each call is set in the panel, not in code.

## Where it is configured

| Screen | Who | What |
| --- | --- | --- |
| Super admin › **AI & billing** (`/admin/ai`) | superadmin | Global OpenRouter key (default for every client and fallback), default billing mode, default margin %, USD→BRL rate, per-client usage this month |
| Super admin › client › **AI usage & billing** | superadmin | That client's mode, margin override, OpenRouter key, usage, "Bill now" |
| Restaurant admin › Settings › **AI & billing** (`/settings/ai`) | owner (not staff) | Paste or remove their own OpenRouter key, see this month's usage |

The global key falls back to the `OPENROUTER_API_KEY` env var while none is
saved in the panel. Keys are stored encrypted (`CHAT_ADDON_ENCRYPTION_KEY`) and
only ever shown masked. Changes appear in the audit trail with keys redacted.

## Billing modes (per client, or the platform default)

- **own_key**: the client's OpenRouter key; OpenRouter bills their card
  directly and we bill nothing. If the key is rejected (401/402/403: invalid,
  no credit, disabled), the call is retried on the global key and **billed**
  with margin, and the client sees a warning in their panel. An owner saving a
  key switches the client to this mode.
- **platform**: the global key, billed at real cost + margin.
- **included**: the global key, not billed.

Work the superadmin does for a client (seed, OCR, seed images) always uses the
global key and is never billed.

## How usage is measured and billed

Every OpenRouter response carries its real cost (`usage.cost`, USD). Each call
is recorded in `ai_usage_events` with the key used, whether it is billable,
the margin and the charge (`cost × (1 + margin%)`).

Billable usage goes on the client's **monthly plan invoice**: when Stripe
creates the renewal invoice (draft, `billing_reason = subscription_cycle`),
the webhook adds one "Inteligência artificial" line (charge converted to BRL
with the panel rate) and marks the events invoiced. "Bill now" adds the same
line as a pending item for the next invoice. Under one cent keeps accumulating.

### Stripe setup

The platform webhook endpoint (`/api/stripe/webhooks`) must be subscribed to
**`invoice.created`** in addition to the events it already receives. Without
it, usage is still recorded but never added to the invoice automatically.

## Environment

- `OPENROUTER_API_KEY`: optional; global key until one is saved in the panel.
- `OPENROUTER_BASE_URL`: optional; defaults to `https://openrouter.ai/api/v1`.
  The e2e suite points it at the fake OpenRouter in
  `tests/e2e/mock-openrouter.mjs`.

## Tests

- `tests/unit/ai/billing.test.ts`: who pays, margin, invoice amount, key
  handling.
- `tests/e2e/api/ai-billing.spec.ts`: each mode end to end against the fake
  OpenRouter (own key, out-of-credit fallback billed with margin, included,
  permissions, key test, bill now without a card).
