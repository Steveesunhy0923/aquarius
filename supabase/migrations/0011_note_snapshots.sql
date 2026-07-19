-- 0011_note_snapshots.sql — per-note version history (tree snapshots).
--
-- Each row is one restorable version of a note's document tree, captured on
-- manual "save version" or throttled autosave. `tree` is jsonb, the same shape
-- as note_packages.tree, so restoring is a plain read (no Yjs decode) and the
-- feature works for private notes too (which have no ydoc). Immutable once
-- written — no updated_at / trigger. RLS mirrors note_packages: the note owner
-- has full control (covers private notes), collaborators can read the history,
-- and editor collaborators can add/remove the versions they authored.

create table if not exists note_snapshots (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references notes(id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label      text not null default '',
  kind       text not null default 'manual' check (kind in ('auto', 'manual')),
  tree       jsonb not null,
  created_at timestamptz not null default now()
);

-- History list + prune both order by (note, created_at desc).
create index if not exists note_snapshots_note_created_idx
  on note_snapshots (note_id, created_at desc);
create index if not exists note_snapshots_owner_id_idx
  on note_snapshots (owner_id);

alter table note_snapshots enable row level security;

-- Note owner: full control over the history of their own notes (private + shared).
drop policy if exists note_snapshots_owner_all on note_snapshots;
create policy note_snapshots_owner_all on note_snapshots
  for all to authenticated
  using (exists (select 1 from notes n where n.id = note_id and n.owner_id = auth.uid()))
  with check (exists (select 1 from notes n where n.id = note_id and n.owner_id = auth.uid()));

-- Collaborators: read the full history.
drop policy if exists note_snapshots_collab_read on note_snapshots;
create policy note_snapshots_collab_read on note_snapshots
  for select to authenticated
  using (public.note_role(note_id) is not null);

-- Editor collaborators: add versions (recorded as themselves).
drop policy if exists note_snapshots_collab_insert on note_snapshots;
create policy note_snapshots_collab_insert on note_snapshots
  for insert to authenticated
  with check (public.note_role(note_id) = 'editor' and owner_id = auth.uid());

-- Editor collaborators: remove versions they authored.
drop policy if exists note_snapshots_collab_delete on note_snapshots;
create policy note_snapshots_collab_delete on note_snapshots
  for delete to authenticated
  using (public.note_role(note_id) = 'editor' and owner_id = auth.uid());
