-- 0001_init.sql — Aquarius cloud schema.
--
-- This schema mirrors the local storage entities in `lib/storage/types.ts` 1:1
-- (Subject, Notebook, NoteMeta, NotePackage, AssetRef, and the share-link
-- concept), so cloud <-> local sync is a straight row-for-row reconciliation.
--
-- NAMING: cloud columns are snake_case; the local entities are camelCase. The
-- sync layer maps camelCase <-> snake_case (e.g. subjectId <-> subject_id,
-- sortOrder/order <-> sort_order, latexCache <-> latex_cache). Keep this in mind
-- when adding/renaming columns: a column rename here is a sync-layer change.

create extension if not exists pgcrypto;

-- ─── Reusable updated_at trigger ──────────────────────────────────────────────
-- Sets NEW.updated_at = now() on every UPDATE. Attached to every table below.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── subjects (mirrors Subject) ───────────────────────────────────────────────
create table subjects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text,
  icon        text,
  sort_order  int not null default 0,   -- local `order`
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger subjects_set_updated_at
  before update on subjects
  for each row execute function set_updated_at();

create index subjects_owner_id_idx on subjects (owner_id);

-- ─── notebooks (mirrors Notebook) ─────────────────────────────────────────────
create table notebooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  name        text not null,
  color       text,
  sort_order  int not null default 0,   -- local `order`
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger notebooks_set_updated_at
  before update on notebooks
  for each row execute function set_updated_at();

create index notebooks_owner_id_idx   on notebooks (owner_id);
create index notebooks_subject_id_idx on notebooks (subject_id);

-- ─── notes (mirrors NoteMeta — the light library index record) ────────────────
create table notes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  notebook_id  uuid not null references notebooks(id) on delete cascade,
  subject_id   uuid not null references subjects(id) on delete cascade,  -- denormalized, as in NoteMeta
  title        text not null default 'Untitled',
  sort_order   int not null default 0,   -- local `order`
  tags         text[] not null default '{}',
  thumbnail    text,                     -- base64 PNG preview
  mode         text not null default 'flow' check (mode in ('flow','spatial')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger notes_set_updated_at
  before update on notes
  for each row execute function set_updated_at();

create index notes_owner_id_idx    on notes (owner_id);
create index notes_notebook_id_idx on notes (notebook_id);
create index notes_subject_id_idx  on notes (subject_id);

-- ─── note_packages (mirrors NotePackage — heavy content; 1:1 with notes) ──────
-- note_id is the primary key, enforcing the 1:1 relationship with notes.
create table note_packages (
  note_id      uuid primary key references notes(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  tree         jsonb not null default '{}'::jsonb,  -- DocumentTree block content
  latex_cache  text,                                 -- local `latexCache`
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger note_packages_set_updated_at
  before update on note_packages
  for each row execute function set_updated_at();

create index note_packages_owner_id_idx on note_packages (owner_id);
-- note_id is already indexed by the primary key.

-- ─── assets (mirrors AssetRef — media metadata) ───────────────────────────────
-- Bytes live in the Storage bucket `note-assets`; this table is metadata only.
create table assets (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  note_id       uuid not null references notes(id) on delete cascade,
  kind          text not null,                 -- 'image' | 'audio' | 'handwriting' | 'pdf'
  mime          text not null,
  size          bigint not null default 0,     -- bytes, for quota/UX
  storage_path  text not null,                 -- object path inside the note-assets bucket
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Keep metadata consistent with the Storage RLS, which scopes object bytes to
  -- the `<owner_uid>/...` path prefix. This stops a row from recording a path
  -- outside the owner's folder (which a service-role consumer might trust).
  constraint assets_path_owner_prefix
    check (split_part(storage_path, '/', 1) = owner_id::text)
);

create trigger assets_set_updated_at
  before update on assets
  for each row execute function set_updated_at();

create index assets_owner_id_idx on assets (owner_id);
create index assets_note_id_idx  on assets (note_id);

-- ─── shares (read-only public share links) ────────────────────────────────────
-- A row grants public read access to one note via an unguessable token.
-- Public reads go through public.get_shared_note() (see 0002_rls.sql); the
-- table itself is never exposed to anon.
create table shares (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  note_id     uuid not null references notes(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger shares_set_updated_at
  before update on shares
  for each row execute function set_updated_at();

create index shares_owner_id_idx on shares (owner_id);
create index shares_note_id_idx  on shares (note_id);
-- token already indexed by the unique constraint.

-- ─── Storage bucket for asset bytes ───────────────────────────────────────────
-- Private bucket; objects are namespaced by owner uid (folder = auth.uid()).
-- See 0002_rls.sql for the storage.objects policies.
insert into storage.buckets (id, name, public)
values ('note-assets', 'note-assets', false)
on conflict (id) do nothing;
