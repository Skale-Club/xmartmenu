-- EX-07: order history follows proven identity, not the last 8 digits.
--
-- The customer panel (/[slug]/me) listed every order whose typed phone ended
-- in the same 8 digits as the visitor's verified phone: two different numbers
-- sharing those digits saw each other's orders. Orders now carry:
--   customer_id           the phone-verified account that placed it, or that
--                         later proved it owns the order's full number
--   customer_phone_e164   the typed number in E.164 when derivable without
--                         guessing (NULL when ambiguous)
--   customer_linked_at / customer_link_method
--                         when and how an anonymous order was attached to an
--                         account (audit)
-- customer_phone_key stays for old rows and reports; it no longer grants
-- access. Old orders are not backfilled here: see
-- scripts/report-customer-phone-backfill.ts (report only).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS customer_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_link_method TEXT
    CHECK (customer_link_method IS NULL OR customer_link_method IN ('session_at_checkout', 'verified_phone'));

CREATE INDEX IF NOT EXISTS orders_tenant_customer ON public.orders (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_tenant_phone_e164 ON public.orders (tenant_id, customer_phone_e164)
  WHERE customer_phone_e164 IS NOT NULL AND customer_id IS NULL;

-- Customers read their own orders (and items) directly too, never by phone.
DROP POLICY IF EXISTS "orders_customer_read" ON public.orders;
CREATE POLICY "orders_customer_read" ON public.orders FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "order_items_customer_read" ON public.order_items;
CREATE POLICY "order_items_customer_read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.customer_id = auth.uid()));

-- create_order_with_items (20261027093000) gains the identity columns.
CREATE OR REPLACE FUNCTION public.create_order_with_items(p_order JSONB, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_key TEXT := NULLIF(p_order->>'idempotency_key', '');
  v_tenant UUID := (p_order->>'tenant_id')::UUID;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order has no items' USING ERRCODE = '22023';
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE tenant_id = v_tenant AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_order.request_fingerprint IS DISTINCT FROM p_order->>'request_fingerprint' THEN
        RAISE EXCEPTION 'idempotency key reused for a different order' USING ERRCODE = 'P0409';
      END IF;
      RETURN jsonb_build_object('id', v_order.id, 'status', v_order.status, 'total', v_order.total,
                                'order_type', v_order.order_type, 'replayed', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.orders (
      tenant_id, customer_name, customer_phone, customer_phone_key, status, total, subtotal,
      currency, order_type, delivery_address, delivery_street, delivery_complement,
      delivery_zipcode, delivery_city, delivery_notes, delivery_zone_id, delivery_fee_cents,
      location_id, tip_cents, table_name, table_id, analytics_session_id,
      idempotency_key, request_fingerprint,
      customer_id, customer_phone_e164, customer_linked_at, customer_link_method
    ) VALUES (
      v_tenant,
      p_order->>'customer_name',
      p_order->>'customer_phone',
      p_order->>'customer_phone_key',
      p_order->>'status',
      (p_order->>'total')::NUMERIC,
      (p_order->>'subtotal')::NUMERIC,
      p_order->>'currency',
      p_order->>'order_type',
      p_order->>'delivery_address',
      p_order->>'delivery_street',
      p_order->>'delivery_complement',
      p_order->>'delivery_zipcode',
      p_order->>'delivery_city',
      p_order->>'delivery_notes',
      NULLIF(p_order->>'delivery_zone_id', '')::UUID,
      (p_order->>'delivery_fee_cents')::INT,
      NULLIF(p_order->>'location_id', '')::UUID,
      COALESCE((p_order->>'tip_cents')::INT, 0),
      p_order->>'table_name',
      NULLIF(p_order->>'table_id', '')::UUID,
      NULLIF(p_order->>'analytics_session_id', '')::UUID,
      v_key,
      p_order->>'request_fingerprint',
      NULLIF(p_order->>'customer_id', '')::UUID,
      NULLIF(p_order->>'customer_phone_e164', ''),
      CASE WHEN NULLIF(p_order->>'customer_id', '') IS NOT NULL THEN now() END,
      CASE WHEN NULLIF(p_order->>'customer_id', '') IS NOT NULL THEN 'session_at_checkout' END
    )
    RETURNING * INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    IF v_key IS NULL THEN RAISE; END IF;
    SELECT * INTO v_order FROM public.orders WHERE tenant_id = v_tenant AND idempotency_key = v_key;
    IF v_order.request_fingerprint IS DISTINCT FROM p_order->>'request_fingerprint' THEN
      RAISE EXCEPTION 'idempotency key reused for a different order' USING ERRCODE = 'P0409';
    END IF;
    RETURN jsonb_build_object('id', v_order.id, 'status', v_order.status, 'total', v_order.total,
                              'order_type', v_order.order_type, 'replayed', true);
  END;

  INSERT INTO public.order_items (
    order_id, product_id, product_name, quantity, unit_price, notes,
    selected_options, ingredient_modifications, added_via
  )
  SELECT v_order.id, i.product_id, i.product_name, i.quantity, i.unit_price, i.notes,
         i.selected_options, i.ingredient_modifications, i.added_via
  FROM jsonb_to_recordset(p_items) AS i(
    product_id UUID, product_name TEXT, quantity INT, unit_price NUMERIC, notes TEXT,
    selected_options JSONB, ingredient_modifications JSONB, added_via TEXT
  );

  RETURN jsonb_build_object('id', v_order.id, 'status', v_order.status, 'total', v_order.total,
                            'order_type', v_order.order_type, 'replayed', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_with_items(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(JSONB, JSONB) TO service_role;

-- Attach the caller's anonymous orders whose full typed number equals the
-- phone they just verified. Exact E.164 only; never a suffix.
CREATE OR REPLACE FUNCTION public.link_orders_to_verified_phone(p_tenant_id UUID, p_user_id UUID, p_phone_e164 TEXT)
RETURNS INT
LANGUAGE sql
SET search_path = public
AS $$
  WITH linked AS (
    UPDATE public.orders
    SET customer_id = p_user_id, customer_linked_at = now(), customer_link_method = 'verified_phone'
    WHERE tenant_id = p_tenant_id
      AND customer_id IS NULL
      AND p_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      AND customer_phone_e164 = p_phone_e164
    RETURNING 1
  )
  SELECT count(*)::INT FROM linked;
$$;

REVOKE EXECUTE ON FUNCTION public.link_orders_to_verified_phone(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_orders_to_verified_phone(UUID, UUID, TEXT) TO service_role;
