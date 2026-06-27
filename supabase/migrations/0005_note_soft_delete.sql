-- 0005_note_soft_delete.sql — soft delete for notes ("Recently Deleted").
--
-- Mirrors the local store's `NoteMeta.deletedAt`: deleting a note sets
-- `deleted_at` (it leaves normal listings but stays recoverable); the library's
-- Recently Deleted bin lists rows where `deleted_at is not null`. Owner-only RLS
-- from 0002 already covers select/update of these rows.

alter table notes add column deleted_at timestamptz;
create index notes_deleted_at_idx on notes (deleted_at);
