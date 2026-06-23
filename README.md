# Aquarius

**A WYSIWYG math note editor — LaTeX is the output format, not the input format.**

Aquarius lets you write math the way you think about it: you edit a structured tree of
visual blocks (a fraction, a script, an integral) rather than typing backslash commands.
LaTeX, PDF, Markdown, Anki cards, and share links are all *serializations* of that single
block tree, not the thing you author. The library is modeled on Notability — Subjects
hold Notebooks hold Notes — and everything runs local-first in the browser.

> **Status: working foundation.** The core loop is implemented end-to-end: the block tree,
> the LaTeX/KaTeX serializer, the IndexedDB store (with `.aqnote` export/import), the
> Supabase Postgres schema + RLS, and a minimal library browser and WYSIWYG editor all
> exist and run. The sync engine is a type-correct **skeleton** (reconciliation deferred),
> and several features below are still **planned** — see [`docs/ROADMAP.md`](docs/ROADMAP.md)
> for exactly what is done versus not yet started.

## Quick start

Aquarius is **local-first**. It runs with **no Supabase keys** — all data lives in
IndexedDB in your browser, and the app is fully usable offline. Cloud sync is optional.

```bash
npm install

# Optional — ONLY if you want cloud backup/sync later.
# The app runs fine without this step.
cp .env.example .env.local   # then fill in Supabase keys

npm run dev                  # http://localhost:3000
```

Leaving `.env.local` absent (or its keys blank) is the supported default: the Supabase
client returns `null` and the app treats cloud sync as unavailable instead of crashing
(see [`lib/supabase/client.ts`](lib/supabase/client.ts)).

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`.

## Tech stack

| Concern            | Choice                                  | Notes                                              |
| ------------------ | --------------------------------------- | -------------------------------------------------- |
| Framework          | Next.js 15 (App Router) + TypeScript    | Editor is client-side; server components for shell |
| Math rendering     | KaTeX                                   | `tree → LaTeX → KaTeX` render pipeline (implemented) |
| Styling            | Tailwind CSS v4                         | via `@tailwindcss/postcss`                          |
| Local storage      | IndexedDB (`idb`)                       | local-first primary store (implemented)            |
| Cloud (optional)   | Supabase (`@supabase/supabase-js`)      | backup / sync target; `null` when unconfigured     |
| Realtime collab    | Yjs                                     | **planned (V2)** — dependency present, type-only in sync skeleton |

## Repository layout

```
aquarius/
├── app/                  Next.js App Router: shell + library browser + editor
│   ├── page.tsx          Notability-style library (minimal)
│   └── editor/[id]/      WYSIWYG block-tree editor (minimal)
├── components/           Katex + BlockView render components
├── lib/
│   ├── blocks/           block tree (types) + LaTeX/KaTeX serializer + factory
│   ├── storage/          Notability-style library model + IndexedDB store
│   ├── sync/             local ⇄ cloud reconciliation        [skeleton]
│   └── supabase/         optional cloud client (client.ts)
├── supabase/
│   └── migrations/       Postgres schema + RLS mirroring storage
└── docs/                 architecture / storage / roadmap
```

The implemented `lib/` modules include the block tree (`blocks/types.ts`,
`blocks/serialize.ts`, `blocks/factory.ts`), the storage layer (`storage/types.ts`,
`storage/local.ts`, `storage/index.ts`), and `supabase/client.ts`. The Supabase migrations
(`supabase/migrations/0001_init.sql`, `0002_rls.sql`) exist. `lib/sync/*` is a type-correct
**skeleton** — the reconciliation logic is deferred (see [`docs/ROADMAP.md`](docs/ROADMAP.md)).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the block-tree-as-source-of-truth model, input/output adapters, and render pipeline.
- [`docs/STORAGE.md`](docs/STORAGE.md) — deep dive on the Notability-modeled, local-first storage layer.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — V1 build order and V2 plans, with what is scaffolded vs not started.
