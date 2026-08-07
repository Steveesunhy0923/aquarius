-- 0013_rls_hardening.sql — access-control fixes from the pre-release security review.
--
-- Batch of RLS/authorization hardening. Every change is additive or a tightened
-- replacement of a policy from 0002/0003/0006/0008; none alter table shape, so
-- this is safe to apply on a live project. Grouped changes:
--
--   1. notes: an editor collaborator can no longer seize ownership, relocate, or
--      soft-delete a note they don't own (BEFORE UPDATE guard).
--   2. note_packages: owner_id is pinned to the parent note's owner on every
--      insert/update, closing the "editor creates the package row first and
--      becomes its owner" hole.
--   3. Realtime: only the note owner or an `editor` may BROADCAST (Yjs document
--      state); viewers/commenters keep presence (avatars) but can't inject edits.
--   4. Shared/soft-deleted notes: a trashed note is no longer served by a public
--      share link, nor readable by collaborators.
--   5. profiles: the whole-directory read policy is replaced with a scoped one +
--      an exact-match lookup RPC, removing the user-enumeration surface.
--
-- A related setting lives OUTSIDE this migration: disable public/anon Realtime
-- broadcast at the project level so the private-channel RLS below can't be
-- bypassed by joining the public variant of `note:<uuid>` (see docs/TODO.md).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. notes — freeze ownership / location / deletion state for NON-owners.
--
-- notes_collab_update (0006) lets an `editor` UPDATE the note, gated only on
-- note_role(id)='editor'. Nothing stopped an editor from also rewriting
-- owner_id (→ ownership takeover + lockout of the real owner), notebook_id /
-- subject_id (→ relocating the note out of the owner's library), or deleted_at
-- (→ hiding the owner's note). A policy WITH CHECK can't see OLD, so we enforce
-- immutability in a BEFORE UPDATE trigger, which can.
--
-- The owner path is unaffected: when auth.uid() = owner_id the guard is skipped
-- and notes_owner_all's WITH CHECK (owner-owned notebook/subject) still governs,
-- so the owner keeps moving notes between notebooks. Service-role/admin updates
-- (auth.uid() is null) are also skipped.
create or replace function public.notes_guard_collab_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and auth.uid() <> old.owner_id then
    if new.owner_id    is distinct from old.owner_id
    or new.notebook_id is distinct from old.notebook_id
    or new.subject_id  is distinct from old.subject_id
    or new.deleted_at  is distinct from old.deleted_at then
      raise exception
        'collaborators may not change a note''s ownership, location, or deletion state'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_guard_collab_update on notes;
create trigger notes_guard_collab_update
  before update on notes
  for each row execute function public.notes_guard_collab_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. note_packages — pin owner_id to the parent note's owner.
--
-- owner_id defaults to auth.uid() (0004). note_packages_collab_insert only
-- checks note_role='editor', so if an editor was the first to insert the package
-- row, owner_id became the EDITOR's uid and the real owner then failed
-- note_packages_owner_all and lost access to their own note body. Forcing
-- owner_id = the note's owner on every insert/update makes that impossible and
-- is a no-op for the owner's own writes. SECURITY DEFINER so it can read the
-- parent note's owner regardless of the caller's RLS.
create or replace function public.note_packages_force_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.notes where id = new.note_id;
  if v_owner is null then
    raise exception 'note_packages: parent note % does not exist', new.note_id
      using errcode = 'foreign_key_violation';
  end if;
  new.owner_id := v_owner;
  return new;
end;
$$;

drop trigger if exists note_packages_force_owner on note_packages;
create trigger note_packages_force_owner
  before insert or update on note_packages
  for each row execute function public.note_packages_force_owner();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Realtime — restrict BROADCAST to writers; keep presence open to viewers.
--
-- The co-editing channel `note:<uuid>` carries Yjs document state as broadcast
-- events ("update"/"sync"/"sync-reply" — and "sync" ships an applied full
-- state), while avatars/cursors travel via presence (channel.track). The 0008
-- send policy authorized ANY participant (note_participant, incl. viewer/
-- commenter) to send, so a read-only collaborator could broadcast edits that
-- peers applied and the owner's autosave persisted. Split it: presence for any
-- participant, broadcast for writers (owner or editor) only.
create or replace function public.note_writer(p_note uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.notes n where n.id = p_note and n.owner_id = auth.uid())
      or public.note_role(p_note) = 'editor';
$$;
revoke all on function public.note_writer(uuid) from public;
grant execute on function public.note_writer(uuid) to authenticated;

-- Receive (SELECT) is unchanged from 0008 (note_participant). Replace only send.
-- Drop both the old (0008) name and the new name so this migration is re-runnable.
drop policy if exists "note channel: participants send" on realtime.messages;
drop policy if exists "note channel: writers send" on realtime.messages;
create policy "note channel: writers send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'note:%'
    and case
          when realtime.messages.extension = 'presence'
            then public.note_participant(substring(realtime.topic() from 6)::uuid)
          else
            public.note_writer(substring(realtime.topic() from 6)::uuid)
        end
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Soft-deleted notes — stop serving them to share links and collaborators.
--
-- 0005 added notes.deleted_at ("Recently Deleted"). get_shared_note and the
-- collaborator read policies never checked it, so a trashed note kept flowing
-- through an old share token and stayed readable by collaborators. The owner is
-- unaffected — notes_owner_all has no deleted_at filter, so the owner still sees
-- and restores their own trashed notes.
create or replace function public.note_active(p_note uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.notes n where n.id = p_note and n.deleted_at is null);
$$;
revoke all on function public.note_active(uuid) from public;
grant execute on function public.note_active(uuid) to authenticated;

-- Public share link: return nothing for a trashed note.
create or replace function public.get_shared_note(p_token text)
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select json_build_object(
    'id',        n.id,
    'title',     n.title,
    'tags',      n.tags,
    'mode',      n.mode,
    'thumbnail', n.thumbnail,
    'createdAt', n.created_at,
    'updatedAt', n.updated_at,
    'tree',      coalesce(p.tree, '{}'::jsonb),
    'latexCache', p.latex_cache
  )
  from shares s
  join notes n              on n.id = s.note_id  and n.owner_id = s.owner_id
  left join note_packages p on p.note_id = n.id  and p.owner_id = s.owner_id
  where s.token = p_token
    and n.deleted_at is null;   -- ← trashed notes are not shared
$$;
revoke all on function public.get_shared_note(text) from public;
grant execute on function public.get_shared_note(text) to anon, authenticated;

-- Collaborators: hide trashed notes and their content.
drop policy if exists notes_collab_read on notes;
create policy notes_collab_read on notes
  for select to authenticated
  using (public.note_role(id) is not null and deleted_at is null);

drop policy if exists note_packages_collab_read on note_packages;
create policy note_packages_collab_read on note_packages
  for select to authenticated
  using (public.note_role(note_id) is not null and public.note_active(note_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. profiles — remove the whole-directory read; scope it, add an exact lookup.
--
-- profiles_read_all (0003) used `using (true)`, letting any authenticated user
-- enumerate every username, display name (real names from Google), and avatar
-- URL. Replace with: (a) your own row + rows of users you actually share notes
-- with (either direction), which is all the app's UI needs (owner viewing their
-- collaborators; a collaborator seeing the sharer); and (b) a SECURITY DEFINER
-- lookup for exact-username share targets you don't yet collaborate with.
drop policy if exists profiles_read_all on profiles;
drop policy if exists profiles_read_scoped on profiles;
create policy profiles_read_scoped on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (   -- profiles of collaborators on notes I own
      select 1 from note_collaborators nc
      where nc.user_id = profiles.id and nc.owner_id = auth.uid()
    )
    or exists (   -- profile of the owner of a note shared with me
      select 1 from note_collaborators nc
      where nc.owner_id = profiles.id and nc.user_id = auth.uid()
    )
  );

-- Exact-match lookup for "share with @username". Discloses only a single row for
-- a handle the caller already knows — not the directory. SECURITY DEFINER so it
-- resolves users the caller doesn't yet collaborate with.
create or replace function public.lookup_profile(p_username citext)
returns table (id uuid, username citext, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where p.username = p_username
  limit 1;
$$;
revoke all on function public.lookup_profile(citext) from public;
grant execute on function public.lookup_profile(citext) to authenticated;
