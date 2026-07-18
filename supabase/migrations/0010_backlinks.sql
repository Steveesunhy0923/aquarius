-- 0010_backlinks.sql — find notes whose content links to a target note.
--
-- Wiki-style note links are stored as [text](note://<noteId>) markers inside
-- the tree JSON. They are deliberately NOT serialized into latex_cache (a PDF
-- can't follow them — see lib/blocks/format.ts), so the backlinks panel can't
-- reuse the body-search path; it needs a tree scan. Doing that scan in
-- Postgres keeps it one round-trip instead of downloading every package.
--
-- SECURITY INVOKER (the default): RLS on note_packages/notes applies, so a
-- user only ever sees backlinks from notes they can already read.

create or replace function public.backlink_note_ids(target uuid)
returns table (note_id uuid)
language sql
stable
as $$
  select p.note_id
  from public.note_packages p
  join public.notes n on n.id = p.note_id
  where p.note_id <> target
    and n.deleted_at is null
    and p.tree::text like '%note://' || target || '%';
$$;
