-- LOC-05: per-branch independent menu assignment (null = use shared default menu)
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS menu_id UUID REFERENCES menus(id) ON DELETE SET NULL;

-- LOC-06: location tracking on orders (null = single-location / no branch)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- Index for orders-by-location queries
CREATE INDEX IF NOT EXISTS idx_orders_location_id ON orders(location_id) WHERE location_id IS NOT NULL;
