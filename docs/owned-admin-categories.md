# Owned category management

Category administration can use the same owned PostgreSQL connection and
`OWNED_ADMIN_MENUS_ENABLED=true` rollout flag as menu administration. The
category page reads the selected tenant menu and its categories in one
read-only transaction. Create, edit, activation, and delete keep the existing
`/api/admin/categories` request shapes; the server derives tenant ownership,
validates the menu, and serializes writes with the menu transaction lock.

Only `store-admin` and `superadmin` can mutate categories. Writes require an
exact same-origin `Origin`. Category deletion keeps the existing database
`ON DELETE SET NULL` behavior for products and menu events, after verifying
that both dependent tables and their tenant ownership match the reviewed
foreign-key graph. A schema change that adds another cascading or nulling
reference blocks deletion until that relationship is reviewed.

The flag remains off unless explicitly enabled. The owned route returns a
sanitized unavailable response on database failures and does not retry a
write or fall back to Supabase.
