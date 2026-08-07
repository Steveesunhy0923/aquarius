-- 0015_orka.sql — Orka franchise umbrella: one account across all Orka apps.
--
-- This project is being PROMOTED from "the Aquarius project" to "the Orka
-- project". Nothing moves; auth.users is already the identity, and this
-- migration adds the franchise-level tables that hang off it. One auth.users
-- row is one Orka account, shared by Aquarius, Virgo, and whatever comes next.
--
-- Scope is deliberately narrow: shared ACCOUNT + ENTITLEMENTS only. No
-- cross-app data linking. Aquarius keeps its notes tables; Virgo keeps
-- localStorage and stays fully functional signed out.
--
-- PAYMENTS ARE RECORDED, NOT PROCESSED. orka_subscriptions carries external_*
-- columns so a future processor has somewhere to write. Nothing here charges
-- anyone, there is no checkout, and every account resolves to 'free' until
-- something outside this schema writes otherwise.
--
-- SCHEMA CHOICE: `public` with an `orka_` prefix, not a dedicated `orka` schema.
-- config.toml exposes only ["public","storage"] to PostgREST; a separate schema
-- would 404 (PGRST106) from both apps until config.toml AND the dashboard's
-- "Exposed schemas" were changed together.
--
-- RLS DEVIATION, ON PURPOSE: subscriptions and entitlements are SELECT-ONLY for
-- `authenticated`. The house style (0002_rls.sql) is
--     for all ... using (auth.uid() = owner_id) with check (auth.uid() = owner_id)
-- which is right for rows the user authors. Applied HERE it would let any user
-- PATCH their own plan to 'pro' straight through PostgREST. No migration in this
-- repo issues table-level GRANTs, so RLS is the only gate. Writes are
-- service_role only; service_role bypasses RLS and so needs no policy at all.


-- ═══ orka_apps — the registry of Orka apps ══════════════════════════════════
-- A read-only catalogue. Readable by `anon` as well as `authenticated`: the
-- marketing site lists the apps before anyone has an account.
create table if not exists orka_apps (
  slug        text primary key check (slug ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name        text not null,
  tagline     text,
  enabled     boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists orka_apps_set_updated_at on orka_apps;
create trigger orka_apps_set_updated_at
  before update on orka_apps
  for each row execute function set_updated_at();

alter table orka_apps enable row level security;

drop policy if exists orka_apps_read_enabled on orka_apps;
create policy orka_apps_read_enabled on orka_apps
  for select
  to anon, authenticated
  using (enabled);

-- Seeded in-migration, the way 0001_init.sql seeds the storage bucket.
-- Taglines are the apps' own README one-liners; keep them honest.
insert into orka_apps (slug, name, tagline, sort_order) values
  ('aquarius', 'Aquarius', 'A WYSIWYG math note editor.', 1),
  ('virgo',    'Virgo',    'Calendar, tasks and countdowns for students.', 2)
on conflict (slug) do nothing;


-- ═══ orka_accounts — one row per auth user ══════════════════════════════════
-- 1:1 with auth.users, the same shape `profiles` uses. Every Orka-level row
-- hangs off this one, so a single cascade from auth.users reaches all of them
-- and delete_account() (0012) needs no change.
--
-- Nothing here is user-editable: the user-facing identity (username, display
-- name, avatar) already lives in `profiles` and is not duplicated. Hence
-- SELECT-only, like the two tables below.
create table if not exists orka_accounts (
  id              uuid primary key references auth.users(id) on delete cascade,
  tos_accepted_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists orka_accounts_set_updated_at on orka_accounts;
create trigger orka_accounts_set_updated_at
  before update on orka_accounts
  for each row execute function set_updated_at();

alter table orka_accounts enable row level security;

drop policy if exists orka_accounts_self_read on orka_accounts;
create policy orka_accounts_self_read on orka_accounts
  for select
  to authenticated
  using (id = auth.uid());


-- ═══ orka_subscriptions — the plan record. RECORDED ONLY ════════════════════
-- account_id is the primary key, which enforces 1:1 (the same trick
-- note_packages uses with note_id in 0001_init.sql).
--
-- A MISSING ROW MEANS 'free' — see orka_plan() below. That is deliberate: it
-- keeps the signup trigger down to a single insert, and a signup trigger that
-- can fail takes down signup for every Orka app at once.
create table if not exists orka_subscriptions (
  account_id               uuid primary key
                             references orka_accounts(id) on delete cascade,
  plan                     text not null default 'free'
                             check (plan in ('free','plus','pro')),
  status                   text not null default 'active'
                             check (status in ('active','trialing','past_due','canceled')),
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  -- Somewhere for a future processor to write. Unused today.
  external_provider        text check (external_provider in ('stripe','apple','google')),
  external_customer_id     text,
  external_subscription_id text unique,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

drop trigger if exists orka_subscriptions_set_updated_at on orka_subscriptions;
create trigger orka_subscriptions_set_updated_at
  before update on orka_subscriptions
  for each row execute function set_updated_at();

create index if not exists orka_subscriptions_status_idx
  on orka_subscriptions (status, current_period_end);

alter table orka_subscriptions enable row level security;

drop policy if exists orka_subscriptions_self_read on orka_subscriptions;
create policy orka_subscriptions_self_read on orka_subscriptions
  for select
  to authenticated
  using (account_id = auth.uid());


-- ═══ orka_plan_features — what each plan unlocks, per app ═══════════════════
-- Without this table entitlements would be empty for everyone and the whole
-- mechanism would be untestable until a payment processor existed. This is the
-- catalogue that lets a free account resolve to a real answer today.
-- Maintained by hand in migrations, like orka_apps.
create table if not exists orka_plan_features (
  plan       text not null check (plan in ('free','plus','pro')),
  app_slug   text not null references orka_apps(slug) on delete cascade,
  feature    text not null,
  created_at timestamptz not null default now(),
  primary key (plan, app_slug, feature)
);

alter table orka_plan_features enable row level security;

-- Public catalogue: the same information the pricing page prints.
drop policy if exists orka_plan_features_read_all on orka_plan_features;
create policy orka_plan_features_read_all on orka_plan_features
  for select
  to anon, authenticated
  using (true);

-- Seed. Nothing is paid yet, so `free` deliberately gets NO rows: every
-- capability both apps ship today is free and unconditional, and listing them
-- here would invite someone to gate them later.
--
-- THE RULE THESE ROWS MUST OBEY: an entitlement may only ever ADD a capability
-- that does not exist yet. It must never be wired to a feature an app already
-- ships — that would take something away from every current user and break the
-- constraint that nothing becomes gated behind an account. These are a
-- declaration of intent for unbuilt features, not switches to flip.
insert into orka_plan_features (plan, app_slug, feature) values
  ('plus', 'aquarius', 'cloud_sync'),
  ('plus', 'aquarius', 'collaboration'),
  ('pro',  'aquarius', 'cloud_sync'),
  ('pro',  'aquarius', 'collaboration'),
  ('pro',  'aquarius', 'unlimited_ai'),
  ('plus', 'virgo',    'cloud_backup'),
  ('pro',  'virgo',    'cloud_backup'),
  ('pro',  'virgo',    'unlimited_ai')
on conflict do nothing;


-- ═══ orka_entitlements — explicit per-account grants ════════════════════════
-- Overlays orka_plan_features. `source` records WHY, which is what lets a
-- future webhook revoke exactly what it granted and nothing else. app_slug is a
-- real foreign key so a typo cannot create a phantom entitlement that silently
-- never matches.
create table if not exists orka_entitlements (
  account_id uuid not null references orka_accounts(id) on delete cascade,
  app_slug   text not null references orka_apps(slug)   on delete cascade,
  feature    text not null,
  granted    boolean not null default true,
  source     text not null default 'grant'
               check (source in ('grant','trial','promo','comp')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, app_slug, feature)
);

drop trigger if exists orka_entitlements_set_updated_at on orka_entitlements;
create trigger orka_entitlements_set_updated_at
  before update on orka_entitlements
  for each row execute function set_updated_at();

create index if not exists orka_entitlements_account_idx on orka_entitlements (account_id);
create index if not exists orka_entitlements_app_idx     on orka_entitlements (app_slug);

alter table orka_entitlements enable row level security;

drop policy if exists orka_entitlements_self_read on orka_entitlements;
create policy orka_entitlements_self_read on orka_entitlements
  for select
  to authenticated
  using (account_id = auth.uid());


-- ═══ Read API for @orka/entitlements ════════════════════════════════════════
-- SECURITY DEFINER only to keep the expiry / plan-resolution logic server-side
-- and identical for both apps; the policies above already permit these reads.
-- search_path is pinned, matching handle_new_user() in 0003.

-- A missing subscription row, or a non-paying status, is 'free'.
create or replace function public.orka_plan()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.plan
       from public.orka_subscriptions s
      where s.account_id = auth.uid()
        and s.status in ('active','trialing')
      limit 1),
    'free');
$$;
revoke all on function public.orka_plan() from public;
grant execute on function public.orka_plan() to authenticated;

-- One round-trip for "what may I do in this app".
create or replace function public.orka_entitlements_for(p_app text)
returns table (feature text, source text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pf.feature, 'plan'::text as source, null::timestamptz as expires_at
    from public.orka_plan_features pf
   where pf.app_slug = p_app
     and pf.plan = public.orka_plan()
  union
  select e.feature, e.source, e.expires_at
    from public.orka_entitlements e
   where e.account_id = auth.uid()
     and e.app_slug   = p_app
     and e.granted
     and (e.expires_at is null or e.expires_at > now());
$$;
revoke all on function public.orka_entitlements_for(text) from public;
grant execute on function public.orka_entitlements_for(text) to authenticated;

create or replace function public.orka_has_entitlement(p_app text, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orka_entitlements_for(p_app) f
     where f.feature = p_feature
  );
$$;
revoke all on function public.orka_has_entitlement(text, text) from public;
grant execute on function public.orka_has_entitlement(text, text) to authenticated;


-- ═══ Signup hook — a SECOND trigger, alongside 0003's ═══════════════════════
-- handle_new_user() (0003_profiles.sql) is left UNTOUCHED. Postgres fires AFTER
-- triggers in alphabetical order by trigger NAME, and 'on_auth_user_created' <
-- 'on_orka_user_created', so the profile row is created first. Orka does not
-- depend on that ordering either way; a separate function is simply
-- independently droppable, whereas amending 0003 would `create or replace` a
-- definition that is load-bearing for every existing Aquarius signup.
--
-- THIS RUNS INSIDE GOTRUE'S SIGNUP TRANSACTION. Any exception aborts signup for
-- BOTH apps with the opaque "Database error saving new user". Hence exactly one
-- plain insert, with `on conflict do nothing`, and nothing that can raise.
create or replace function public.orka_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.orka_accounts (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_orka_user_created on auth.users;
create trigger on_orka_user_created
  after insert on auth.users
  for each row execute function public.orka_handle_new_user();


-- ═══ Backfill — this project already has users ══════════════════════════════
-- Promoting an existing project means auth.users is NOT empty. Without this,
-- every pre-Orka user has no account row, and every entitlement read returns
-- nothing for exactly the people who already trusted the product.
insert into public.orka_accounts (id)
select u.id from auth.users u
on conflict (id) do nothing;


-- ═══ Note on delete_account() (0012) ════════════════════════════════════════
-- No change is needed, and that is load-bearing rather than lucky:
--   orka_accounts.id          -> auth.users(id)     on delete cascade
--   orka_subscriptions.account_id -> orka_accounts(id) on delete cascade
--   orka_entitlements.account_id  -> orka_accounts(id) on delete cascade
-- so `delete from auth.users where id = uid` still removes every Orka row.
--
-- THE TRAP for any future orka_* table: a foreign key to auth.users WITHOUT
-- `on delete cascade` does not merely miss the cascade — it makes that delete
-- raise a foreign-key violation and breaks account deletion outright, which is
-- App Store Guideline 5.1.1(v) compliance. Every orka_* table needs an unbroken
-- cascade path to auth.users.
--
-- One more consequence, now that this is a shared identity: delete_account()
-- destroys the ORKA account, not "your Aquarius data" — every app, every
-- entitlement, and any future payment record. UI copy must say so, and an app
-- that stores nothing server-side (Virgo) must not offer this action at all.
