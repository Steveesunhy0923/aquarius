# Aquarius — Supabase backend

The cloud schema mirrors the local storage entities in
[`lib/storage/types.ts`](../lib/storage/types.ts) **1:1** (Subject, Notebook,
NoteMeta, NotePackage, AssetRef, share links), so cloud <-> local sync is a
straight row-for-row reconciliation. Cloud columns are `snake_case`; the sync
layer maps `camelCase <-> snake_case`.

## Layout

```
supabase/
  config.toml                  # local CLI config (project_id, ports)
  migrations/
    0001_init.sql              # extensions, tables, indexes, storage bucket
    0002_rls.sql               # RLS policies + public share-link function
  seed.sql                     # no-op (RLS requires an authenticated user)
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) running locally.
- The Supabase CLI:

  ```bash
  # macOS (Homebrew)
  brew install supabase/tap/supabase

  # or via npm
  npm install -g supabase
  ```

## Start the local stack

From the repo root:

```bash
supabase start
```

This boots Postgres, Auth, Storage, and Studio in Docker and prints a block of
local credentials (API URL, anon key, service_role key, DB URL, Studio URL).

## Apply the migrations

```bash
supabase db reset
```

`db reset` recreates the local database and applies every file in
`migrations/` in order (`0001_init.sql`, then `0002_rls.sql`), then runs
`seed.sql` (a no-op). Run it whenever you add or change a migration.

What the migrations set up:

- All tables (`subjects`, `notebooks`, `notes`, `note_packages`, `assets`,
  `shares`) with the `updated_at` trigger, foreign-key + `owner_id` indexes.
- Owner-only Row Level Security on every table.
- A private Storage bucket **`note-assets`** — **auto-created by the migration**
  (`0001_init.sql`), no manual setup needed. Asset bytes live here, namespaced
  per user as `<owner_uid>/...`; metadata lives in the `assets` table.
- A `public.get_shared_note(token)` function (SECURITY DEFINER) that powers
  read-only public share links without exposing any table to `anon`.

## Wire up the app

Copy the printed **API URL** and **anon key** into `.env.local` at the repo
root:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed by `supabase start`>
```

(Re-run `supabase status` at any time to reprint these values.)

## Share links

Public, read-only note sharing is served by `public.get_shared_note(p_token)`.
Call it as the `anon` role (e.g. from an RPC) with a share token; it returns the
note metadata + package tree for a valid token, or `null` otherwise. The
`shares`, `notes`, and `note_packages` tables themselves are never readable by
`anon`.

## Notes

- `supabase stop` tears the stack down; `supabase stop --no-backup` also wipes
  local data.
- Production: link the project (`supabase link`) and push migrations with
  `supabase db push`.
