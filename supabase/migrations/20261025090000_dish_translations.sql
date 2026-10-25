-- Dish and category content per language. A menu can be offered in up to 15
-- languages (menus.supported_languages); the guest picks one and dish names
-- and descriptions follow, falling back to the base text.
--
-- Shape: { "<lang>": { "name": "...", "description": "..." } }
--
-- Ingredients, menus, option groups and options already have this column.
-- The superadmin AI seed and OCR import already write it on insert, so they
-- fail until it exists.

alter table public.categories
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.products
  add column if not exists translations jsonb not null default '{}'::jsonb;
