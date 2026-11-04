# Product list and row mutations on independent PostgreSQL

The existing OWNED_ADMIN_CATALOG_ENABLED flag also selects the product-list
page and product row create/update/delete APIs. It remains false by default.
The repository shares the ADMIN_MENUS pool; ingredient, menu and product writes
serialize with the same tenant advisory lock without allocating another pool.

The server derives the current tenant and menu, generates IDs and positions,
and compares the submitted expected menu with the current cookie selection.
A changed menu refuses creation. Category assignments require the same tenant
and menu, with parent locks held through commit. Product projections preserve
numeric prices and nullable original prices without exposing future private
columns. Staff reads remain available and all mutations require administration
and the request's own origin.

Deletion keeps the original cascades to groups/options, ingredient associations
and media metadata, with analytics product references cleared. It refuses
unreviewed or inconsistent cross-tenant dependencies before deleting. Storage
objects are preserved. Upload endpoints and their existing backend are unchanged.

The product detail page, options, ingredient associations, gallery metadata,
translation and upsell writers still need coordinated migration. Keep the
catalog flag disabled until all of these readers/writers and authoritative
public reads share the final database. Deploying this code performs no SQL,
role, provider or environment operation.
