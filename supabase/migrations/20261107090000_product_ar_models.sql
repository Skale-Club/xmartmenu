-- Augmented reality foundation: a 3D model per dish that guests can turn
-- around in the menu and place on their table through the phone camera.
--
-- product_ar_models   one row per dish (product_id is unique).
--   glb_url            glTF binary (.glb). Required: it drives the in-page 3D
--                      viewer, Android Scene Viewer and WebXR. On iOS the
--                      viewer converts it to USDZ for Quick Look on the fly.
--   usdz_url           optional hand-made USDZ for iOS Quick Look, used
--                      instead of the on-the-fly conversion when present.
--   poster_url         image shown while the model loads (usually the dish
--                      photo). NULL = the viewer shows a neutral placeholder.
--   real_scale         TRUE = AR shows the model at the size it was modelled
--                      (metres), so guests see the real portion. FALSE lets
--                      them pinch to resize.
--   *_storage_path     object keys in the product-images bucket, kept so a
--                      cleanup job can remove replaced files later.
--   *_bytes            file sizes, shown in the back office and used to warn
--                      about models too heavy for a phone on mobile data.
--
-- Reads follow product_media: members, superadmins, and anyone for a dish
-- that is on a public menu (product_is_public). Writes: managers only
-- (auth_can_manage_tenant), the same rule as the rest of the catalog.
--
-- Analytics: model_viewer_opened (guest opened the 3D view of a dish) and
-- ar_launched (guest asked to place it on the table).

CREATE TABLE IF NOT EXISTS public.product_ar_models (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID        NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  glb_url             TEXT        NOT NULL,
  glb_storage_path    TEXT        NULL,
  glb_bytes           INTEGER     NULL CHECK (glb_bytes IS NULL OR glb_bytes > 0),
  usdz_url            TEXT        NULL,
  usdz_storage_path   TEXT        NULL,
  usdz_bytes          INTEGER     NULL CHECK (usdz_bytes IS NULL OR usdz_bytes > 0),
  poster_url          TEXT        NULL,
  real_scale          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_ar_models_tenant_id_idx ON public.product_ar_models (tenant_id);

-- The row's tenant must be the dish's tenant: the manage policy only checks
-- tenant_id, so without this a manager could attach a model to another
-- restaurant's dish id.
CREATE OR REPLACE FUNCTION public.product_ar_models_check_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'product_ar_models: product % does not belong to tenant %', NEW.product_id, NEW.tenant_id
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.product_ar_models_check_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS product_ar_models_check_tenant ON public.product_ar_models;
CREATE TRIGGER product_ar_models_check_tenant
  BEFORE INSERT OR UPDATE ON public.product_ar_models
  FOR EACH ROW EXECUTE FUNCTION public.product_ar_models_check_tenant();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.product_ar_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_ar_models_public_read" ON public.product_ar_models;
CREATE POLICY "product_ar_models_public_read" ON public.product_ar_models FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR public.product_is_public(product_id)
  );

DROP POLICY IF EXISTS "product_ar_models_manage" ON public.product_ar_models;
CREATE POLICY "product_ar_models_manage" ON public.product_ar_models FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- ─── audit trail (same trigger as the rest of the catalog) ───────────────────

DO $$
BEGIN
  IF to_regprocedure('public.audit_row_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_row_change ON public.product_ar_models;
    CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.product_ar_models
      FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,created_at');
  END IF;
END $$;

-- ─── analytics events ────────────────────────────────────────────────────────

ALTER TABLE public.menu_events DROP CONSTRAINT IF EXISTS menu_events_event_name_check;
ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_event_name_check CHECK (event_name IN (
  'menu_session_started',
  'product_impression',
  'product_engagement',
  'product_detail_opened',
  'media_started',
  'media_completed',
  'media_swiped',
  'category_selected',
  'search_performed',
  'product_customization_started',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
  'upsell_shown',
  'upsell_accepted',
  'upsell_skipped',
  'model_viewer_opened',
  'ar_launched',
  'order_created',
  'order_completed',
  'order_cancelled'
));
