# v2.2 Requirements — Restaurant Growth Platform

## In Scope

### English Conversion (SEED-016)

- [ ] **ENGL-01**: Admin panel navigation, buttons, headings, and form labels are in English
- [ ] **ENGL-02**: Superadmin panel table headers, action buttons, and modal titles are in English
- [ ] **ENGL-03**: Onboarding wizard step titles, instructions, and CTAs are in English
- [ ] **ENGL-04**: KDS status labels, filter chips, and time labels are in English
- [ ] **ENGL-05**: Settings page headings, toggle labels, and field descriptions are in English
- [ ] **ENGL-06**: Error and validation messages across the admin UI are in English

### Color Theming (SEED-015)

- [ ] **THEME-01**: Tenant admin can set primary and secondary colors via a color picker in branding settings
- [ ] **THEME-02**: Public menu page injects tenant colors as CSS custom properties server-side with no flash of unstyled content
- [ ] **THEME-03**: All public menu interactive elements (buttons, category pills, cart badge, CTAs, modal headers) use `var(--color-primary)` and `var(--color-secondary)`
- [ ] **THEME-04**: New tenants receive a default color palette based on their cuisine or business type

### Order Types (SEED-013)

- [ ] **ORD-01**: Restaurant admin can independently enable or disable dine-in, pick-up, and delivery modes; at least one mode must remain active
- [ ] **ORD-02**: Admin can configure estimated pick-up time in minutes when pick-up is enabled
- [ ] **ORD-03**: Admin can configure a delivery fee when delivery is enabled
- [ ] **ORD-04**: Customer sees an order type selector only when two or more modes are active; dine-in is selected by default; selector is hidden when only dine-in is active
- [ ] **ORD-05**: Delivery mode reveals a required delivery address field and adds the delivery fee to the cart total
- [ ] **ORD-06**: Each order stores its `order_type` and `delivery_address`; KDS cards display a fulfillment badge per type
- [ ] **ORD-07**: Admin orders view is filterable by order type

### Multi-Location Branches (SEED-011)

- [ ] **LOC-01**: Tenant admin can create, edit, and deactivate branch locations with name, address, city, phone, operating hours, and slug
- [ ] **LOC-02**: Single-location tenant continues to serve the menu at the root URL (`restaurantsite.com`) — no change from current behavior
- [ ] **LOC-03**: Multi-location tenant routes each branch at a path segment (`restaurantsite.com/[branch-slug]/`); root URL shows a branch picker instead of the menu
- [ ] **LOC-04**: Each branch has its own QR code pointing to its path (`restaurantsite.com/branch-slug/`)
- [ ] **LOC-05**: Admin can configure whether branches share the same menu or each has an independent menu; default is shared
- [ ] **LOC-06**: Orders store a `location_id`; KDS and orders view are filterable by branch

### SEO (SEED-014)

- [ ] **SEO-01**: Public menu page has a dynamic `<title>` and `<meta description>` sourced from tenant name and description
- [ ] **SEO-02**: Each tenant has a dynamically generated OG image rendered with the tenant logo and brand colors
- [ ] **SEO-03**: `LocalBusiness` JSON-LD (schema.org) is injected per tenant with name, address, phone, operating hours, and cuisine type
- [ ] **SEO-04**: `Menu` and `MenuItem` JSON-LD is generated server-side from the tenant's active menu data
- [ ] **SEO-05**: Platform-slug pages include a canonical URL pointing to the custom domain when one is active
- [ ] **SEO-06**: `robots.txt` is served per domain — custom domain gets `Allow: /`; platform slug is disallowed when a custom domain is active
- [ ] **SEO-07**: Tenant-level `sitemap.xml` lists all indexable URLs for that tenant (root + branch paths when multi-location)
- [ ] **SEO-08**: Each active branch has its own `LocalBusiness` JSON-LD with a `branchOf` link to the parent tenant (depends on LOC-03)

---

## Future Requirements (deferred)

- Per-branch menu customization (different products or prices per location) — deferred to v3+
- i18n for admin panel (English-only operator UI for now; non-English localization is a future seed)
- Delivery address geolocation and map picker — deferred to future milestone
- Per-branch color overrides — deferred; colors live on tenant, not locations, in v2.2
- Plan-based location limits (e.g. menu plan = 1 branch, orders = 3, payments = unlimited) — evaluate with SEED-009

---

## Out of Scope

- Public menu language — customer-facing menu language is tenant-controlled; untouched
- Landing page copy — already in English
- iFood / Rappi / marketplace delivery integrations — order types seed covers own-operated delivery only
- Full i18n library (react-intl, next-intl) — over-engineering for a one-time English migration

---

## Traceability

| Requirement | Phase |
|-------------|-------|
| ENGL-01 through ENGL-06 | TBD |
| THEME-01 through THEME-04 | TBD |
| ORD-01 through ORD-07 | TBD |
| LOC-01 through LOC-06 | TBD |
| SEO-01 through SEO-08 | TBD |
