-- Fix duplicate Globe icons in platform_settings features section.
-- "Unique link per restaurant" → Link2
-- "Custom branding" → Palette

UPDATE platform_settings
SET landing = jsonb_set(
  jsonb_set(
    landing,
    '{features,items,0,icon}',
    '"Link2"'
  ),
  '{features,items,2,icon}',
  '"Palette"'
)
WHERE landing->'features'->'items' IS NOT NULL;
