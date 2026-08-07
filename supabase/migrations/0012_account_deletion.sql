-- 0012_account_deletion.sql — self-service account deletion.
--
-- Required for App Store submission (Guideline 5.1.1(v): apps that support
-- account creation must offer in-app account deletion) and the right thing
-- under GDPR regardless of the store.
--
-- Every application table cascades from auth.users (`on delete cascade` FKs in
-- 0001/0003/0006/0009/0011), so deleting the auth user row removes profiles,
-- subjects, notebooks, notes, packages, asset metadata, collaborator rows,
-- share-opens, and snapshots in one statement. The only thing that does NOT
-- cascade is storage.objects: the client deletes its note-assets objects
-- through the Storage API first (which also removes the underlying bytes);
-- the sweep here is a backstop that unlinks anything the client missed.

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_account: not authenticated';
  end if;

  -- Backstop sweep. Objects are namespaced <owner uid>/… — enforced by the
  -- assets-table check constraint (0001) and the storage policies (0002).
  delete from storage.objects
   where bucket_id = 'note-assets'
     and split_part(name, '/', 1) = uid::text;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;
