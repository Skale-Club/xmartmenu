-- Migration 051: order status — add 'awaiting_payment' and align 'out_for_delivery'
-- Created: 2026-06-13
--
-- Background: the customer (public-menu/QR) order flow now requires online
-- payment BEFORE the order reaches the kitchen. Such orders are created in a
-- new 'awaiting_payment' status that no kitchen/waiter/customer view surfaces
-- (every view filters on explicit statuses). The webhook transitions them to
-- 'paid' once Stripe confirms.
--
-- Also adds 'out_for_delivery', which was already used by the admin orders UI
-- and present in the TS Order type but missing from the CHECK constraint
-- (pre-existing inconsistency — a status update to it would have been rejected).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before re-adding.

BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'awaiting_payment',
    'pending',
    'preparing',
    'out_for_delivery',
    'ready',
    'done',
    'cancelled',
    'paid',
    'payment_failed'
  ));

COMMIT;
