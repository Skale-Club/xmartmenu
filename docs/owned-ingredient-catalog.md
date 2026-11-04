# Ingredient catalog on independent PostgreSQL

OWNED_ADMIN_CATALOG_ENABLED defaults to false. When explicitly enabled, the
ingredient page and its mutations use server APIs and the existing ADMIN_MENUS
SQL target/pool. This adds no pool or connection allocation. Existing
authentication and effective-tenant resolution still apply.

Store staff can read. Store administrators and a superadmin's effective tenant
can create, edit, delete and reorder. The server selects the tenant, generates
IDs and positions, and accepts only name, the two default prices and availability.
Writes require the same request origin. Owned errors never retry against Supabase.
Reordering exchanges current SQL positions in one bounded transaction rather
than trusting positions from a browser snapshot.

Deleting an ingredient preserves the existing cascade to its product ingredient
associations. The transaction refuses unreviewed cascading schema changes,
cross-tenant associations and oversized deletions before changing data. No
storage object is created or deleted; image URLs and translations are preserved.
The existing public-menu notification runs after successful browser mutations.

This migrates the ingredient catalog surface only. Products, product ingredient
associations/options, other settings and identity still require their own
remaining migration work. Do not enable this flag while authoritative public
reads or another catalog writer still point at a different database. No flag,
production role or database is changed by deploying this code.
