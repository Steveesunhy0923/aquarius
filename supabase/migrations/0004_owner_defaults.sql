-- 0004_owner_defaults.sql — default owner_id to the caller.
--
-- With `owner_id default auth.uid()`, the cloud LibraryStore can INSERT rows
-- without spelling out owner_id; the owner-only RLS `with check (auth.uid() =
-- owner_id)` from 0002_rls.sql still enforces it. (For service-role / trigger
-- inserts where auth.uid() is null, callers must still pass owner_id explicitly.)

alter table subjects      alter column owner_id set default auth.uid();
alter table notebooks     alter column owner_id set default auth.uid();
alter table notes         alter column owner_id set default auth.uid();
alter table note_packages alter column owner_id set default auth.uid();
alter table assets        alter column owner_id set default auth.uid();
alter table shares        alter column owner_id set default auth.uid();
