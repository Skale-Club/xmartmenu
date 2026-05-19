-- Migration 034: order type configuration columns on tenant_settings
-- Phase 38: Order Types — Admin & Schema (ORD-01, ORD-02, ORD-03)
-- Created: 2026-05-19
--
-- Adds 5 columns to tenant_settings to configure which order fulfillment
-- modes a restaurant offers, plus pick-up ETA and delivery fee values.
-- Defaults keep existing behaviour: dine-in on, pick-up off, delivery off.
--
-- Idempotent: IF NOT EXISTS guard on every column — re-running is safe.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS dine_in_enabled   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_enabled    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_eta_minutes INT     NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INT     NOT NULL DEFAULT 0;
