-- EX-03: an order and its items are written in one transaction, a retried
-- request does not create a second order, and the order keeps what it charged.
--
-- POST /api/orders inserted the order, then the items, and deleted the order
-- by hand when the items failed: the kitchen board (realtime on orders) could
-- see a header without items, and a failed delete left it there. A lost
-- response retried by the browser created a duplicate order.
--
-- Snapshot columns (all nullable, so old code keeps working):
--   currency            the restaurant's currency when the order was placed;
--                       older orders keep NULL rather than a guess taken from
--                       today's (mutable) settings
--   subtotal            items only, before delivery fee and tip
--   delivery_fee_cents  what was charged for delivery
-- Idempotency:
--   idempotency_key     client-generated per checkout attempt
--   request_fingerprint hash of the canonical order; the same key with a
--                       different order is a conflict, not a replay

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_idempotency_key
  ON public.orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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
      idempotency_key, request_fingerprint
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
      p_order->>'request_fingerprint'
    )
    RETURNING * INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent request with the same key won the race: answer with its order.
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

COMMENT ON FUNCTION public.create_order_with_items(JSONB, JSONB) IS
  'Order + items in one transaction, idempotent per (tenant, idempotency_key). Called by POST /api/orders with prices already recomputed server-side.';
