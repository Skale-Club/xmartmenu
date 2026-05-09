---
phase: 30
plan: "01"
type: auto
autonomous: true
wave: 1
depends_on: []
---

# Phase 30 Plan: Schema + Planos Base

## Objective

Create the foundational database schema for the subscription plan system and seed the three base plans. This is Phase A of SEED-009 (Plans, Pricing & Stripe Connect Monetization).

## Context

**Source:** SEED-009 Phase A  
**Milestone:** v2.0 Monetization  
**Dependency graph:** No external dependencies

## Tasks

### Task 1: Create Migration SQL File
**Type:** auto  
**Files:** supabase/migrations/029_plans_subscriptions.sql  

Create the migration file with:
- `plans` table (lookup for subscription tiers)
- `tenant_subscriptions` table (per-tenant subscription with override support)
- `stripe_connections` table (per-tenant Stripe Connect account reference)
- `processed_stripe_events` table (webhook idempotency)
- Indexes on tenant_id columns
- Seed data: 3 plans (menu, orders, payments)
- Grandfathering: all existing tenants get payments plan

### Task 2: Add TypeScript Types to database.ts
**Type:** auto  
**Files:** src/types/database.ts  

Add types:
- `Plan` interface (replacing existing `Plan` type)
- `TenantSubscription` interface
- `StripeConnection` interface
- `ProcessedStripeEvent` interface

Update existing `Tenant` interface to use new plan system.

### Task 3: Create getTenantPlan() Helper
**Type:** auto  
**Files:** src/lib/tenant-plan.ts  

Create helper function that:
- Takes tenantId as parameter
- Resolves override values (NULL = use plan value)
- Returns fully-resolved EffectivePlan object
- Queries tenant_subscriptions and joins with plans table

### Task 4: Apply Migration and Verify Seed Data
**Type:** auto  
**Verify:** Migration runs successfully, 3 plans seeded  

Run migration and verify:
- `SELECT * FROM plans` returns 3 rows
- `SELECT * FROM tenant_subscriptions` has entries for all existing tenants
- Plans have correct prices and features