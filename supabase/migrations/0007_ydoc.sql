-- 0007_ydoc.sql — persist the authoritative Yjs document for real-time co-editing.
--
-- Real-time co-editing (lib/collab/) represents a note as a Yjs CRDT document so
-- concurrent edits merge instead of clobbering (block-level last-write-wins).
-- This column stores `Y.encodeStateAsUpdate(doc)` so the merged state survives
-- after every collaborator leaves; `tree`/`latex_cache` remain a DERIVED read
-- model used for search/export and non-collaborative opens.
--
-- Nullable: null = the note has never been co-edited, so the collab layer seeds
-- a fresh Y.Doc from `tree`. Only written once a note is actually collaborated on.
--
-- RLS is unchanged: the owner-all policy (0002) and the additive editor
-- INSERT/UPDATE policies (0006) are table-wide, so they already cover this
-- column. The app's saveNote upsert never touches `owner_id`.

alter table note_packages add column ydoc bytea;

comment on column note_packages.ydoc is
  'Yjs CRDT state (Y.encodeStateAsUpdate). Authoritative for co-edited notes; tree/latex_cache are a derived read model. Null until first co-edit.';
