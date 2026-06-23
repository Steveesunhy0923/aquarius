-- 0002_rls.sql — Row Level Security for Aquarius.
--
-- Model:
--   * Every domain table is owner-only: a row is visible/mutable only to the
--     authenticated user whose auth.uid() matches owner_id.
--   * Public, read-only share links do NOT open any table to anon. Instead a
--     single SECURITY DEFINER function, public.get_shared_note(token), returns
--     the note metadata + package tree for a valid token. anon may EXECUTE it,
--     but cannot read shares/notes/note_packages directly.
--   * Storage objects in the `note-assets` bucket are owner-only, keyed on the
--     first path segment being the owner's uid.

-- ─── Enable RLS ───────────────────────────────────────────────────────────────
alter table subjects      enable row level security;
alter table notebooks     enable row level security;
alter table notes         enable row level security;
alter table note_packages enable row level security;
alter table assets        enable row level security;
alter table shares        enable row level security;

-- ─── Owner-only policies (FOR ALL: using + with check on owner_id) ────────────
create policy subjects_owner_all on subjects
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Child tables additionally require that the parent referenced by the row is
-- owned by the same user (correlated EXISTS in WITH CHECK). Without this, a user
-- could insert a row they "own" that attaches to ANOTHER user's note/notebook/
-- subject — the root cause of the shares/note_packages cross-tenant exposure.

create policy notebooks_owner_all on notebooks
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from subjects s
      where s.id = subject_id and s.owner_id = auth.uid()
    )
  );

create policy notes_owner_all on notes
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from notebooks nb
      where nb.id = notebook_id and nb.owner_id = auth.uid()
    )
    and exists (
      select 1 from subjects s
      where s.id = subject_id and s.owner_id = auth.uid()
    )
  );

-- note_packages is 1:1 with notes (note_id is PK). Constrain BOTH using and
-- with check so a user can neither read nor occupy/poison the package row of a
-- note they do not own.
create policy note_packages_owner_all on note_packages
  for all
  to authenticated
  using (
    auth.uid() = owner_id
    and exists (
      select 1 from notes n
      where n.id = note_id and n.owner_id = auth.uid()
    )
  )
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from notes n
      where n.id = note_id and n.owner_id = auth.uid()
    )
  );

create policy assets_owner_all on assets
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from notes n
      where n.id = note_id and n.owner_id = auth.uid()
    )
  );

-- A user may only create a share over a note they own.
create policy shares_owner_all on shares
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from notes n
      where n.id = note_id and n.owner_id = auth.uid()
    )
  );

-- ─── Public read-only share links ─────────────────────────────────────────────
-- SECURITY DEFINER so the function's owner (table owner) bypasses RLS for the
-- single, scoped lookup below — anon never gets a row policy on the base tables.
-- Returns NULL when the token does not exist. Joins shares -> notes ->
-- note_packages and surfaces only the public-safe note metadata + tree.
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
  -- Scope every join to the share OWNER's own rows, so a share can never
  -- surface another user's note even if one were forged past the policy.
  join notes n              on n.id = s.note_id      and n.owner_id = s.owner_id
  left join note_packages p on p.note_id = n.id      and p.owner_id = s.owner_id
  where s.token = p_token;
$$;

-- Lock down and re-grant: anon (and authenticated) may only EXECUTE the function.
revoke all on function public.get_shared_note(text) from public;
grant execute on function public.get_shared_note(text) to anon, authenticated;

-- ─── Storage policies for the note-assets bucket ──────────────────────────────
-- Owner-only read/write. Object paths are namespaced as `<owner_uid>/...`, so
-- the first folder segment must equal the caller's uid.
create policy "note-assets owner select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "note-assets owner insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "note-assets owner update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "note-assets owner delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
