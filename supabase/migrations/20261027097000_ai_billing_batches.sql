-- EX-09: an AI call is billed exactly once.
--
-- billAiUsage summed the un-invoiced events, created the Stripe invoice item
-- with an idempotency key derived from the highest event id, then marked the
-- events invoiced. When the marking failed, the next run summed the same
-- events plus newer ones under a new key: a second charge for the same calls.
--
-- Events are now claimed into a batch first (billing_batch), the invoice item
-- is keyed by the batch, and the batch is marked invoiced afterwards. A run
-- that finds a claimed, un-invoiced batch finishes that batch with the same
-- key, so Stripe returns the item it already created.

ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS billing_batch UUID;

CREATE INDEX IF NOT EXISTS ai_usage_events_pending_batch
  ON public.ai_usage_events (tenant_id, billing_batch)
  WHERE billing_batch IS NOT NULL AND invoiced_at IS NULL;
