-- Migration 015: Fix categories and products with NULL menu_id
-- Assigns them to the tenant's default menu (or first active menu as fallback)

UPDATE categories c
SET menu_id = COALESCE(
  (SELECT id FROM menus WHERE tenant_id = c.tenant_id AND is_default = true AND is_active = true LIMIT 1),
  (SELECT id FROM menus WHERE tenant_id = c.tenant_id AND is_active = true ORDER BY position LIMIT 1)
)
WHERE c.menu_id IS NULL;

UPDATE products p
SET menu_id = COALESCE(
  (SELECT id FROM menus WHERE tenant_id = p.tenant_id AND is_default = true AND is_active = true LIMIT 1),
  (SELECT id FROM menus WHERE tenant_id = p.tenant_id AND is_active = true ORDER BY position LIMIT 1)
)
WHERE p.menu_id IS NULL;
