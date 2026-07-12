-- 0009_shared_note_opens.sql — remember when a collaborator first OPENS a note
-- that was shared with them.
--
-- Drives the library UX: a share sits in "Shared with me" (an inbox of new
-- shares) until the recipient first opens it, then moves to the library's
-- "Uncategorized" section. Rows reference note_collaborators, so removing the
-- collaborator (or deleting the note, transitively) also clears the marker.

create table shared_note_opens (
  note_id   uuid not null,
  user_id   uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (note_id, user_id),
  foreign key (note_id, user_id)
    references note_collaborators(note_id, user_id) on delete cascade
);
create index shared_note_opens_user_idx on shared_note_opens (user_id);

alter table shared_note_opens enable row level security;

-- A user manages only their own open-markers. Writes are insert-only
-- (`on conflict do nothing` from the client), so no update policy is needed.
create policy shared_opens_self_select on shared_note_opens
  for select to authenticated using (user_id = auth.uid());
create policy shared_opens_self_insert on shared_note_opens
  for insert to authenticated with check (user_id = auth.uid());
create policy shared_opens_self_delete on shared_note_opens
  for delete to authenticated using (user_id = auth.uid());
