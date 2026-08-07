-- 0014_share_notifications.sql — deliver "A note was shared with you" instantly.
--
-- The recipient's client subscribes to Postgres changes on `note_collaborators`
-- filtered to its OWN user_id (components/ShareNotifier.tsx), so a new share pops
-- an in-app toast about a second after the owner clicks Share, instead of on the
-- next background poll.
--
-- Security is unchanged and needs no new policy: Realtime evaluates the same RLS
-- the table already has, and `collab_self_read` (0006) restricts a user to their
-- own membership rows — so a subscriber can only ever be told about shares
-- addressed to them. All that is missing is publication membership.
--
-- The DELETE/UPDATE events (an unshare or a role change) also reach the right
-- user: `user_id` is part of the primary key, so it is present in the replica
-- identity that Postgres emits for old rows — no `replica identity full` needed.

-- Supabase ships this publication, but a bare Postgres (or a reset local stack
-- from an older CLI) may not have it. Both branches are idempotent so the
-- migration is safe to re-run.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'note_collaborators'
  ) then
    alter publication supabase_realtime add table public.note_collaborators;
  end if;
end $$;
