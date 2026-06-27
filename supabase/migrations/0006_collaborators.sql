-- 0006_collaborators.sql — share a note with other users (viewer/commenter/editor).
--
-- A note's OWNER can add collaborators by user id with a role. Access is granted
-- by ADDITIVE RLS policies (OR'd with the owner-only policies from 0002), so a
-- collaborator can read the note + package + assets, and an `editor` can also
-- update them. Membership is checked through a SECURITY DEFINER helper
-- (`note_role`) so the policies never recurse into note_collaborators' own RLS.

create table note_collaborators (
  note_id    uuid not null references notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  owner_id   uuid not null references auth.users(id) on delete cascade, -- the note's owner (denormalized for RLS)
  role       text not null check (role in ('viewer','commenter','editor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
create index note_collaborators_user_idx  on note_collaborators (user_id);
create index note_collaborators_owner_idx on note_collaborators (owner_id);

create trigger note_collaborators_set_updated_at
  before update on note_collaborators
  for each row execute function set_updated_at();

alter table note_collaborators enable row level security;

-- The note owner manages all collaborator rows for notes they own.
create policy collab_owner_all on note_collaborators
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from notes n where n.id = note_id and n.owner_id = auth.uid())
  );
-- A collaborator can read their own membership rows (to discover what's shared).
create policy collab_self_read on note_collaborators
  for select
  to authenticated
  using (user_id = auth.uid());

-- The caller's role on a note, or NULL. SECURITY DEFINER → bypasses RLS on
-- note_collaborators so the policies below don't recurse.
create or replace function public.note_role(p_note uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from note_collaborators where note_id = p_note and user_id = auth.uid();
$$;
revoke all on function public.note_role(uuid) from public;
grant execute on function public.note_role(uuid) to authenticated;

-- ─── Additive collaborator access (OR'd with owner-only policies from 0002) ───
create policy notes_collab_read on notes
  for select to authenticated using (public.note_role(id) is not null);
create policy notes_collab_update on notes
  for update to authenticated
  using (public.note_role(id) = 'editor')
  with check (public.note_role(id) = 'editor');

create policy note_packages_collab_read on note_packages
  for select to authenticated using (public.note_role(note_id) is not null);
create policy note_packages_collab_insert on note_packages
  for insert to authenticated with check (public.note_role(note_id) = 'editor');
create policy note_packages_collab_update on note_packages
  for update to authenticated
  using (public.note_role(note_id) = 'editor')
  with check (public.note_role(note_id) = 'editor');

create policy assets_collab_read on assets
  for select to authenticated using (public.note_role(note_id) is not null);
create policy assets_collab_insert on assets
  for insert to authenticated
  with check (public.note_role(note_id) = 'editor' and split_part(storage_path, '/', 1) = auth.uid()::text);

-- Storage: collaborators may read/insert object bytes whose 2nd path segment
-- (`<uid>/<noteId>/<assetId>`) is a note they're on. Inserts still land in the
-- caller's own `<uid>/...` folder (consistent with the assets check above).
create policy "note-assets collab select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-assets'
    and public.note_role(((storage.foldername(name))[2])::uuid) is not null
  );
create policy "note-assets collab insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.note_role(((storage.foldername(name))[2])::uuid) = 'editor'
  );
