# Verification checklist — migration 0013 (RLS hardening)

Covers the access-control fixes in [`supabase/migrations/0013_rls_hardening.sql`](../supabase/migrations/0013_rls_hardening.sql)
and the client change in `lib/profile/profile.ts`. Each section has a **positive**
check (a legitimate flow still works) and a **negative** check (the attack is now
blocked). Not yet executed against a database — run after deploy.

## 0. Deploy
- [ ] `npm run db:push` (applies 0013). Confirm no errors; 0013 shows as applied.
- [ ] Supabase dashboard → **Realtime → disable public/anon broadcast** (require
      private channels). This closes the public-channel bypass the new send policy
      can't reach from SQL.
- [x] `tsc --noEmit` clean · `vitest run` 84/84 (already verified locally).

### Impersonation harness (run negatives without two browsers)
In the Supabase **SQL editor**, wrap an attack in a transaction that impersonates
a user, then `rollback`:
```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','<USER_B_UUID>','role','authenticated')::text, true);
set local role authenticated;
-- ... attack statement here ...
rollback;
```
Setup for A–D: account **A** owns note **N**; account **B** is an `editor` on N;
account **V** is a `viewer` on N.

## A. Editor can't seize/relocate/trash a note *(critical)*
- [ ] **Positive** — as B, `update notes set title='x' where id='<N>'` → succeeds.
- [ ] **Negative** — as B, `update notes set owner_id='<B>' where id='<N>'`
      → `insufficient_privilege`; re-select shows `owner_id` still A.
- [ ] **Negative** — as B, changing `notebook_id`, `subject_id`, or `deleted_at`
      on N → same error.
- [ ] **Positive** — as A, move N to another notebook → succeeds (owner path
      unaffected).

## B. note_packages owner is pinned to the note owner *(high)*
- [ ] **Negative** — as B, `insert into note_packages(note_id, owner_id, tree)
      values('<N>','<B>','{}')` (or upsert) → row is created but `owner_id` is
      forced to **A**, not B.
- [ ] **Positive** — as A, `select owner_id from note_packages where note_id='<N>'`
      → A still owns and can read the package (no lockout).
- [ ] **Positive** — a real editor content save from B's app session still writes
      the tree (collab editing works).

## C. Realtime broadcast restricted to writers *(critical)*
Use two signed-in browsers on the same shared note.
- [ ] **Positive** — V opens N: sees the current document and appears as an avatar
      to A/B (presence still works for viewers).
- [ ] **Positive** — B types: the edit appears live in A's and V's windows, and
      persists after reload (writer broadcast + autosave intact).
- [ ] **Negative** — V types (or force a `channel.send({type:'broadcast',…})`):
      the change does **not** appear in A's/B's windows and is not persisted.
      In dashboard → Realtime logs, V's broadcast insert is denied by RLS.
- [ ] **Negative (bypass)** — after the dashboard setting, V joining
      `note:<N>` with `{ private:false }` receives no messages.

## D. Soft-deleted notes are no longer served *(medium)*
Create a share link for N and confirm it loads; then as A soft-delete N.
- [ ] **Negative** — `select public.get_shared_note('<TOKEN>')` → `null`; the
      public share page shows "not found".
- [ ] **Negative** — as B (collaborator), N and its package are no longer readable
      (`select … from notes where id='<N>'` returns 0 rows).
- [ ] **Positive** — as A, N still appears in **Recently Deleted** and restores
      cleanly (owner access unaffected).

## E. profiles enumeration scoped + exact lookup *(medium)*
- [ ] **Negative** — as B, `select count(*) from profiles` → only rows B is
      entitled to (self + users B shares notes with), **not** the whole directory.
- [ ] **Positive** — share-by-username: in the app, share a note with a brand-new
      user by exact `@handle` → resolves (via `lookup_profile` RPC) and the share
      succeeds.
- [ ] **Positive** — owner's Share dialog lists existing collaborators with their
      usernames/display names (`listCollaborators` still reads their profiles).
- [ ] **Positive** — Account menu shows your own profile; changing username works.

## F. App smoke (owner path untouched)
- [ ] Sign in → create → edit → save → export a note.
- [ ] Share → co-edit both directions with an editor → history restore.
- [ ] Set a collaborator to `viewer` → they can read but their edits don't
      propagate (ties to C).

## Follow-ups (not in this migration)
- [ ] Add an automated authorization suite (pgTAP or two-JWT integration) asserting
      A–E above, plus "every table has `relrowsecurity=true`", run in CI — currently
      no server-side authz test coverage.
- [ ] Optional defense-in-depth: carry collaborator role in Yjs presence and have
      clients ignore inbound `update`/`sync` from non-writer peers (RLS is the
      real enforcement; this is belt-and-suspenders).
- [ ] `assets_collab_read` still allows fetching asset *rows* of a soft-deleted
      note (bytes are meaningless without the tree, which is now blocked) — tighten
      later if desired.
