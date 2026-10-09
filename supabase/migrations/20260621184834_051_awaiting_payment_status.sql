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
  ));;
