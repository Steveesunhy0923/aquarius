# Storage

> **Status: working foundation.** The entity shapes and the `LibraryStore` contract live in
> [`../lib/storage/types.ts`](../lib/storage/types.ts), and the IndexedDB implementation
> ([`../lib/storage/local.ts`](../lib/storage/local.ts)) is **complete** — including the
> light/heavy split, assets as separate blobs, and `.aqnote` export/import. The Postgres
> schema + Row Level Security exist under
> [`../supabase/migrations/`](../supabase/migrations/). The sync engine
> ([`../lib/sync/`](../lib/sync/)) is a type-correct **skeleton**: reconciliation is
> deferred. A dedicated Supabase-backed `LibraryStore` is still **planned**.

## Modeled on Notability

Aquarius's storage is deliberately patterned after how Notability stores files, because
that model has already solved two things we want: a fast, browsable library and portable,
self-contained notes.

Notability organizes content as a **3-level library**:

```
Subject  ▸  Notebook (divider)  ▸  Note
```

…and it stores each *note* as a self-contained **package**: the note's content lives
separately from its media (images, audio, handwriting are SEPARATE files), and a
lightweight library index keeps track of which subjects/notebooks/notes exist without
loading any heavy content. We replicate both ideas locally.

## The 3-level hierarchy

The real type names (from [`../lib/storage/types.ts`](../lib/storage/types.ts)):

- **`Subject`** — top of the hierarchy (Notability "Subject"). Has a `color` for the
  spine/tab, an `order`, timestamps.
- **`Notebook`** — middle (Notability "Divider"/"Notebook"), grouped under a subject via
  `subjectId`.
- **`NoteMeta`** — the **light** record for a note: `title`, `order`, `tags`, `thumbnail`,
  `mode`, timestamps — and crucially **no document content**.

## Light index vs heavy package — and why

The single most important design decision: the **light library index** is kept apart from
the **heavy note content**.

```
┌──────────── LIGHT (always loaded — the "library index") ─────────────┐
│  Subject[]    top-level folders                                       │
│  Notebook[]   grouped under a subject                                 │
│  NoteMeta[]   title / thumbnail / order only — NO content             │
└──────────────────────────────────────────────────────────────────────┘
┌──────────── HEAVY (lazy-loaded per note — the "note package") ───────┐
│  NotePackage  block tree + latex cache, keyed by note                 │
│  AssetBlob    media stored as SEPARATE blobs by id                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Why split them?**

1. **Instant library browsing.** Listing subjects, notebooks, and the note grid only
   touches `NoteMeta` (titles, small base64 thumbnails, order). The library renders without
   deserializing a single document tree.
2. **Lazy content load.** Opening a note loads exactly **one** `NotePackage`, and its asset
   blobs are fetched only on demand. You never pay for documents you aren't looking at.

`NotePackage` (the heavy record) holds:

- `tree: DocumentTree` — the actual block-tree content.
- `latexCache: string` — a cached LaTeX serialization, regenerated from `tree`, used for
  search/export so we don't re-serialize on every query.
- `assets: AssetRef[]` — metadata for media belonging to the note (blobs fetched
  separately via `getAsset`).

## Assets as separate blobs

Media is never inlined into the document tree. An `image` block carries only
`attrs.assetId`; the bytes live in a separate store.

- **`AssetRef`** — metadata: `id`, `noteId`, `kind` (`"image" | "audio" | "handwriting" |
  "pdf"`), `mime`, `size`, `createdAt`.
- **`AssetBlob`** — `AssetRef` plus the actual `data: Blob`, kept in its own object store
  (the analogue of Notability's media files).

This keeps the block tree small and serializable, lets the library load thumbnails without
loading full-resolution media, and makes media de-duplication / quota accounting tractable.

## Portable `.aqnote` bundles

A single note can be exported as a self-contained file and re-imported into any Aquarius
library — exactly like dragging a Notability note between libraries. The shape is
**`NoteBundleFile`** (`format: "aqnote"`, JSON):

- `meta` — the note metadata (a trimmed `NoteMeta`).
- `pkg` — the `NotePackage` (tree + latex cache + asset refs).
- `assets` — each `AssetRef` with its bytes **inlined as base64** for portability.

The `LibraryStore` contract exposes `exportNote(id)` and
`importNote(bundle, toNotebookId)` for this round-trip, and `LocalLibraryStore` **implements
both**: export snapshots meta + package + asset blobs in one consistent transaction and
inlines each asset as base64; import assigns fresh ids everywhere and remaps every image
block's `attrs.assetId` (deep through slots and inline runs) to its new id.

## IndexedDB object-store layout

The IndexedDB store ([`../lib/storage/local.ts`](../lib/storage/local.ts), **implemented**)
is the local-first primary and maps the light/heavy split directly onto object stores:

| Object store   | Holds                  | Keyed by   | Tier  |
| -------------- | ---------------------- | ---------- | ----- |
| `subjects`     | `Subject`              | `id`       | light |
| `notebooks`    | `Notebook`             | `id`       | light |
| `notes`        | `NoteMeta`             | `id`       | light |
| `notePackages` | `NotePackage`          | `noteId`   | heavy |
| `assets`       | `AssetBlob`            | `id`       | heavy |

Browsing the library reads only the light stores; opening a note reads one `notePackages`
row and pulls `assets` lazily. These are the exact store names and indexes created by
`local.ts` (`by-order` on subjects, `by-subject`/`by-notebook` on notes, `by-note` on
assets), and deletes cascade subject → notebooks → notes → packages → asset blobs within a
single transaction.

## Storage modes: local / cloud / both

`StorageMode` is `"local" | "cloud" | "both"`, user-selectable per the product spec:

- **local** — IndexedDB only; fully offline, no account required. This is the default and
  the mode that is fully implemented today (`LocalLibraryStore`).
- **cloud** — a Supabase-backed `LibraryStore` satisfying the same contract. The Postgres
  schema + RLS exist; a dedicated cloud `LibraryStore` adapter is still **planned**.
- **both** — local primary with the sync engine reconciling against the cloud store. The
  sync engine is a **skeleton** today (reconciliation deferred).

Every backend implements the single **`LibraryStore`** interface (subjects, notebooks,
notes, packages, assets, bundles), so the editor is agnostic to where data physically
lives.

## 1:1 mapping to Supabase

The same entity shapes mirror **1:1** into the Supabase Postgres schema, which **exists**
under [`../supabase/migrations/`](../supabase/migrations/)
([`0001_init.sql`](../supabase/migrations/0001_init.sql) defines the tables;
[`0002_rls.sql`](../supabase/migrations/0002_rls.sql) adds Row Level Security), so local and
cloud are structurally identical and the sync layer is a straight row-for-row
reconciliation:

| Local shape   | Supabase table           |
| ------------- | ------------------------ |
| `Subject`     | `subjects`               |
| `Notebook`    | `notebooks`              |
| `NoteMeta`    | `notes`                  |
| `NotePackage` | `note_packages`          |
| `AssetBlob`   | `assets` (+ object store)|

There is also a `shares` table backing read-only share links. RLS is owner-only on every
table (with correlated parent-ownership checks in `WITH CHECK`), plus a `SECURITY DEFINER`
`get_shared_note(token)` function that lets `anon` read a single shared note without opening
the base tables, and an owner-scoped private `note-assets` storage bucket. (Column names are
snake_case, e.g. `order` ↔ `sort_order`; the sync layer maps camelCase ↔ snake_case.)

Each entity carries a `rev?: string | null` CRDT/causal sync marker (`null` until first
cloud sync), and `NoteMeta` carries a `dirty?` flag indicating the heavy package has
unsynced local changes — the hooks the sync engine will use. The Supabase client is already
wired as **optional** ([`../lib/supabase/client.ts`](../lib/supabase/client.ts)): with no
keys configured it returns `null` and the app stays in local-only mode.
