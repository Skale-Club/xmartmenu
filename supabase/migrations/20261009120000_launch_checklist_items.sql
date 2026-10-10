-- Website launch checklist (super-admin → Clients → Launch checklist).
--
-- One row per restaurant × checklist item that a super-admin has ticked,
-- marked N/A or annotated. The catalog of items lives in code
-- (src/lib/launch-checklist.ts); a restaurant × item with no row is "pending",
-- so a new item never needs a migration.
--
-- Until this is applied the screen still loads (every item pending) and shows
-- a banner; ticking needs the table.

create table if not exists public.launch_checklist_items (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  item_key   text not null,
  status     text not null default 'pending',
  note       text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_key)
);

alter table public.launch_checklist_items
  drop constraint if exists launch_checklist_items_status_check;

alter table public.launch_checklist_items
  add constraint launch_checklist_items_status_check
  check (status in ('pending', 'done', 'na'));

-- Operator-only data, read and written with the service role by
-- /api/superadmin routes. RLS with no policy denies anon/authenticated outright.
alter table public.launch_checklist_items enable row level security;
