-- Add custom tag support by tenant.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS custom_tags TEXT[] DEFAULT ARRAY['Vegetarian', 'Vegan', 'Gluten-free', 'Spicy', 'Chef pick'];
