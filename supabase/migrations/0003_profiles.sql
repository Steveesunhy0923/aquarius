-- 0003_profiles.sql — public user profiles.
--
-- Every auth user gets a `profiles` row (username, display name, avatar). The
-- username is the social handle used to share documents and to attribute likes
-- later. Profiles are readable by any authenticated user (so share-by-username
-- lookups work), but writable only by their owner. A row is auto-created on
-- signup by an AFTER INSERT trigger on auth.users.

create extension if not exists citext;

-- ─── profiles ─────────────────────────────────────────────────────────────────
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      citext not null unique,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 3–30 chars, letters/digits/underscore only (citext → case-insensitive unique).
  constraint profiles_username_format check (
    char_length(username::text) between 3 and 30
    and username::text ~ '^[A-Za-z0-9_]+$'
  )
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;

-- Any authenticated user can read profiles (needed for share-by-username).
create policy profiles_read_all on profiles
  for select
  to authenticated
  using (true);

-- A user may create/update/delete only their own profile row.
create policy profiles_write_own on profiles
  for all
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─── Auto-create a profile on signup ──────────────────────────────────────────
-- SECURITY DEFINER so the insert bypasses RLS. The default username is derived
-- from the user id (collision-free in practice) and stays within the 30-char
-- length check; the user can rename it afterwards. display_name / avatar_url are
-- lifted from the OAuth metadata (Google) when present.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 12),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
