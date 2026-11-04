# Owned display settings

The Branding, SEO, and Menu display admin pages use `public.tenant_settings` through the existing `ADMIN_MENUS` PostgreSQL pool when `OWNED_ADMIN_MENUS_ENABLED=true`. Reads and writes share the bounded admin transaction helper; the SQL repository has fixed read and write column allowlists and scopes every statement to the authenticated effective tenant.

The corresponding write routes are `/api/admin/branding`, `/api/admin/seo`, and `/api/admin/analytics/settings`. Their existing input validation and response shapes remain in place. Owned writes also require an exact same-origin `Origin` header. The legacy Supabase path remains active while the flag is unset or false.

Branding and SEO image uploads remain on the existing storage upload route. Menu display keeps its current plan check for `upsell_enabled`; the plan lookup is not part of this settings-table change.
