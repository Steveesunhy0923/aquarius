-- 0008_realtime_authz.sql — authorize the live co-editing channel `note:<uuid>`.
--
-- Real-time co-editing uses a PRIVATE Supabase Realtime channel per note, named
-- `note:<note_id>`. Private channels gate broadcast/presence with RLS on
-- `realtime.messages`: a client may receive (SELECT) and send (INSERT) on the
-- channel only if it is a participant of the note named in the topic.
--
-- `note_role()` (0006) returns a role for COLLABORATORS only — the owner has no
-- note_collaborators row — so we add a participant helper that also matches the
-- owner, and reuse it for the channel policy. SECURITY DEFINER so the check
-- never trips over the caller's own RLS.

create or replace function public.note_participant(p_note uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from notes n where n.id = p_note and n.owner_id = auth.uid())
      or public.note_role(p_note) is not null;
$$;
revoke all on function public.note_participant(uuid) from public;
grant execute on function public.note_participant(uuid) to authenticated;

-- The channel topic is `note:<uuid>`; the uuid begins at character 6 (after
-- `note:`). Authorize both receiving (SELECT) and sending (INSERT) for note
-- participants only. Messages whose topic is not a `note:` channel are not
-- matched here and fall through to Supabase's defaults.
alter table realtime.messages enable row level security;

-- Drop-then-create so this migration is safe to re-run (CREATE POLICY is not
-- idempotent and would abort the whole script with "already exists").
drop policy if exists "note channel: participants receive" on realtime.messages;
create policy "note channel: participants receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'note:%'
    and public.note_participant(substring(realtime.topic() from 6)::uuid)
  );

drop policy if exists "note channel: participants send" on realtime.messages;
create policy "note channel: participants send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'note:%'
    and public.note_participant(substring(realtime.topic() from 6)::uuid)
  );
