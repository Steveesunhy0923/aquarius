# TODO — path to a mature app on iPad, Desktop (Win/Mac), and Web

_Snapshot 2026-07-20, v0.7.1 (branch `ui-graphite-redesign`). This is the platform-maturity
gap list: what a "real product" on each platform still needs, given what already exists.
[ROADMAP.md](ROADMAP.md) stays the release record and feature build-order; items here
cross-reference it where they overlap. Facts below were verified against the codebase —
"absent" means grep/inspection found nothing, not "probably missing"._

**Already solid (not repeated below):** block tree + KaTeX/LaTeX serializer, math
(MathLive + structural editor) and chem (mhchem) input, modular notes + fillable fields,
note links + backlinks, IndexedDB local-first store with `.aqnote` export/import and
full-text search, trash/restore (local + cloud), Supabase auth/profiles/sharing/RLS,
Yjs realtime co-editing + live cursors, version history (migration `0011` + HistoryPanel),
⌘K palette, undo/redo, dark mode, print CSS, demo-library seeding, `/ink` handwriting lab
+ `ml/` training pipeline, Capacitor iOS dev shell (simulator-verified).

## Highest-leverage first moves — ✅ ALL FOUR SHIPPED (2026-07-20)

1. ✅ **Static-export production build** — `/editor/[id]` became the query-param route
   `/editor?id=…` ([app/editor/page.tsx](../app/editor/page.tsx) Suspense wrapper +
   `EditorClient.tsx`); `CAP_STATIC=1` turns on `output: "export"` + `trailingSlash`;
   `npm run build:static` ([scripts/build-static.mjs](../scripts/build-static.mjs)) parks
   `app/api` during the build and emits `out/`; `npm run ios:sync:static` bundles it into
   the Capacitor shell (`webDir: out`). Shell builds reach the hosted API routes via
   `NEXT_PUBLIC_API_ORIGIN` ([lib/api.ts](../lib/api.ts)) or degrade gracefully.
2. ✅ **Real sync engine** — signed-in users now get the local-first `SyncedStore`
   ([lib/sync/store.ts](../lib/sync/store.ts)): a per-user IndexedDB mirror
   (`aquarius-u-<uid>`) is the read/write path; every mutation enqueues a push op
   ([lib/sync/queue.ts](../lib/sync/queue.ts), persisted, coalescing, FK-ordered) and the
   engine ([lib/sync/engine.ts](../lib/sync/engine.ts)) pushes/pulls in the background
   (debounced after writes, on `online`, every 60 s). Change detection via per-entity
   `rev` = last-synced cloud `updated_at`; both-sides-changed note packages capture the
   cloud tree as a "Sync conflict" snapshot in the 0011 version history before LWW.
   Shared-by-others notes still delegate straight to cloud (collab unchanged).
3. ✅ **Real PDF export** — ExportMenu "PDF (typeset)": client wraps the serialized body
   in a full document + gathers/transcodes image assets ([lib/export/pdf.ts](../lib/export/pdf.ts))
   and POSTs to [/api/pdf](../app/api/pdf/route.ts), which runs **Tectonic**
   (`--untrusted`, temp dir, size caps, timeout). No Tectonic / offline / static shell →
   graceful fallback to the print path. Deploy note: the server needs the `tectonic`
   binary (`brew install tectonic` locally — installed on this machine; set
   `TECTONIC_PATH` in other environments).
4. ✅ **App Store compliance pair** — "Continue with Apple" (+ Apple identity linking) in
   [AuthDialog](../components/auth/AuthDialog.tsx) / [AccountMenu](../components/auth/AccountMenu.tsx),
   and in-app account deletion: type-DELETE confirm dialog
   ([DeleteAccountDialog](../components/auth/DeleteAccountDialog.tsx)) → Storage-API asset
   removal → `delete_account()` RPC (migration
   [0012](../supabase/migrations/0012_account_deletion.sql), cascades everything) → local
   sign-out. **Manual steps left:** `supabase db push` for 0012, and enabling the Apple
   provider in the Supabase dashboard (Apple Service ID + key — needs the Developer
   account; until then the Apple button errors "provider is not enabled").

## Cross-platform core

Product features every platform inherits:

- [x] **Sync engine** — SHIPPED (see above). Still open: a visible sync-status UI
      (last-synced / pending / offline badge — the engine already emits status events).
- [x] **Real PDF export** — SHIPPED (see above). Still open: **Markdown export** and
      **Anki/flashcard export**, both promised in the README's "serializations" pitch.
- [ ] **LaTeX shorthand autocomplete** (`\frac`, `/` → block) — ROADMAP queue #1, last
      unbuilt piece of the input trio.
- [ ] **TikZ canvas** for the scaffolded `tikz` block — ROADMAP queue #3.
- [ ] **Comments** — the `commenter` sharing role exists
      ([lib/sharing/sharing.ts](../lib/sharing/sharing.ts), migration `0006`) but is just
      read-only; no threads/anchors/drawer. Either build comments or drop the role.
- [ ] **Collab-aware undo** — undo is whole-document snapshot stacks in the editor page;
      in a shared session it can revert other people's edits. Switch to Yjs
      `UndoManager` (local-origin only) when collab is active.
- [x] **Google-Docs-grade co-editing + share notifications** — SHIPPED: paragraph text is a
      `Y.Text` merged per CHARACTER ([lib/collab/ydoc.ts](../lib/collab/ydoc.ts)) instead of
      whole-string LWW, so two people can type in the same paragraph; the open draft and
      caret follow a peer's edit ([lib/collab/caret.ts](../lib/collab/caret.ts)); the Share
      dialog reports its collaborator count so the channel opens the instant a note is
      shared (previously the owner stayed disconnected until a reload — the main reason
      co-editing looked like it wasn't live); "A note was shared with you" toasts arrive
      over Realtime ([ShareNotifier](../components/ShareNotifier.tsx)) with the poll kept
      only as a fallback. Still LWW: formulas, tables and figures (short, focused-box
      edits). **Manual step:** `supabase db push` for migration
      [0014](../supabase/migrations/0014_share_notifications.sql).
- [x] **Account deletion** + **Sign in with Apple** — SHIPPED (see above; Apple provider
      still needs its Supabase-dashboard + Developer-portal configuration).
- [ ] **Asset pipeline hardening** — images are stored as raw bytes with no client-side
      downscaling, size cap, or quota surfacing (local IndexedDB and cloud `note-assets`
      bucket both unbounded). Add resize-on-insert, per-note/user limits, storage-usage UI.
- [ ] **Error monitoring + analytics** — nothing exists (console.error only). Add Sentry
      (web + native shells) and minimal privacy-respecting product analytics; an in-app
      feedback channel.
- [ ] **Test/CI maturity** — CI runs only typecheck + build and does **not** run the 8
      vitest suites; no component/E2E tests. Add `npm test` to CI, then Playwright E2E for
      the core loops (edit/save/export, share/collab, history restore).
- [ ] **Ops/security** — rate-limit `/api/unfurl`; RLS audit pass over migrations
      `0001–0011`; backup/restore story for Supabase (PITR or scheduled dumps).
  - [x] RLS hardening batch — migration [0013](../supabase/migrations/0013_rls_hardening.sql):
        editor can't seize/relocate/trash a note, `note_packages.owner_id` pinned, Realtime
        broadcast restricted to writers, soft-deleted notes unshared, `profiles` read scoped.
  - [ ] **Manual steps for 0013:** `supabase db push`; then in the Supabase dashboard →
        **Realtime settings, disable public/anon broadcast** (require private channels) so the
        new `note:<uuid>` send policy can't be bypassed by joining the public channel variant.
- [ ] **Shortcut map + help** — shortcuts are hard-coded per component with no
      cheat-sheet; add a keymap registry + "?" help panel, and a first-run tour beyond the
      seeded Welcome notebook.
- [ ] **Template gallery + likes, shareable module packs** — the social layer's missing
      half (user modules still localStorage-only); ROADMAP "extra targets".
- [ ] _Later:_ i18n scaffold (everything is hard-coded English); billing/subscriptions if
      Aquarius becomes commercial (nothing exists — a deliberate decision, not a gap, until
      there's a business model).

## Orka (franchise account) — manual steps, BLOCKING

Aquarius's Supabase project has been promoted to **the Orka project**: one `auth.users` row
is now one Orka account, shared with [Virgo](https://github.com/Steveesunhy0923/Virgo). The
code is in — `lib/auth/AuthProvider.tsx` delegates to `@orka/auth` (`~/orka/packages/auth`),
and `supabase/migrations/0015_orka.sql` adds the account/app/subscription/entitlement
tables. Nothing below can be done from a repo; all of it is dashboard or database work.

- [ ] **Verify what is actually applied on `zpwztaitfnulbmscznmt` before pushing.**
      `supabase db push` for 0015 will also apply the outstanding **0012, 0013 and 0014**
      in one go (see the notes at lines 48/78/96 of this file). That is not neutral: 0013
      replaces `profiles_read_all` with a scoped policy, restricts Realtime broadcast to
      writers, and unshares soft-deleted notes — live behaviour changes, on a checklist
      [SECURITY_RLS_0013_VERIFY.md](SECURITY_RLS_0013_VERIFY.md) still marks "not yet
      executed against a database". Check the applied-migration list first.
- [ ] **Push `0015_orka.sql`.** Then verify with the two-JWT harness: user A cannot
      `PATCH /orka_subscriptions` (the tables are SELECT-only for `authenticated` on
      purpose — the house `for all` policy would let anyone set their own plan to `pro`);
      user A cannot read user B's entitlements; a new signup gets an `orka_accounts` row;
      `orka_entitlements_for('virgo')` returns `[]` for a free user without erroring.
- [ ] **Enable "Manual linking"** in the dashboard. `linkIdentity()` requires it and it has
      no representation in `config.toml`. Without it the Google/Apple linking UI just
      errors, and "one Orka account" is not actually true.
- [ ] **Add every redirect URL.** `config.toml` sets only `site_url`, so these are all
      dashboard-side: the Orka site origin, Aquarius's origin, Virgo's web origin, and
      `virgo://auth-callback` for the Virgo desktop deep link. A miss shows up as the
      generic provider error on `/auth/callback`. If the custom scheme is refused,
      allowlist `<orka-site>/auth/desktop` instead — that page forwards to the deep link.
- [ ] **Apple provider** — still dashboard-only, and `config.toml` has no
      `[auth.external.*]` blocks, so Google and Apple do not work against a local
      `supabase start` at all. Local dev is email+password only.
- [ ] **Decide on email confirmations.** Not enforced anywhere in code today. Turning them
      on has a real cost: with `flowType: "pkce"` the `code_verifier` lives in the browser
      that STARTED the flow, so a confirmation link opened on a phone after signing up on a
      laptop fails at `exchangeCodeForSession`. `@orka/auth` now explains that in the error
      text, but the failure itself is not fixable client-side.
- [ ] **Rename the project** from "Steveesunhy0923's Project" to "Orka" in the dashboard,
      so the OAuth consent screen says something a user recognises.

## Website

- [ ] **Responsive layout** — the library is a fixed `248px + 1fr` desktop grid with no
      breakpoints; editor chrome is desktop-pointer-first. Needs phone/tablet-browser
      layouts (collapsible sidebar, adaptive toolbars) — this is also most of the iPad
      Safari experience.
- [ ] **PWA** — no manifest, no service worker. Data is offline (IndexedDB) but the app
      shell is not: add web manifest + service-worker caching + install prompt so the
      website works in Airplane Mode and installs to Dock/home screen.
- [ ] **Public share links** — read-only no-account viewing of a note (ROADMAP V1 step 9,
      not started). Today all sharing requires a signed-in collaborator; a mature web app
      needs "copy link → anyone can view".
- [ ] **Import surface** — `.aqnote` import exists; add paste-LaTeX / Markdown-file import
      so switchers aren't typing notes in from scratch.
- [ ] **Legal + landing** — privacy policy and terms pages (also an App Store submission
      requirement), a marketing/landing page, OG metadata for shared links.
- [ ] **Performance pass** — `app/editor/[id]/page.tsx` is a ~2,000-line client
      component; split it, lazy-load heavy panels (Graph editor, pickers), and virtualize
      long documents.
- [ ] **Accessibility pass** — focus order and ARIA on the custom dialogs/menus, contrast
      check on Graphite tokens, `prefers-reduced-motion` handling.

## iPad (Capacitor shell)

Sequenced roughly as [IPAD_APP_PLAN.md](IPAD_APP_PLAN.md) §5; that doc has the detail.

- [x] **Static-export production build** — SHIPPED: `npm run ios:sync:static` bundles
      `out/` into the shell with no server block.
- [ ] **Safe-area fix** — webview extends under the status bar (found in the first
      simulator run): `viewport-fit=cover` + `env(safe-area-inset-*)`.
- [ ] **Pencil ink in the real editor** — `/ink` is a lab; the product feature is an ink
      sheet in the editor inserting recognized math/text/chem at the caret (gated to the
      Capacitor build), with a configurable Ancha endpoint (the hard-coded
      `127.0.0.1:8787` breaks on-device).
- [ ] **Ancha on-device** — native plugin running Ancha's exported CoreML model +
      Apple Vision for text; no PencilKit/CoreML plugin exists yet (shell has only base
      Capacitor).
- [ ] **Train on the collected ink** — every Insert has been saving a labelled sample since
      2026-08-07: corrections in `ml/data/corrections/` (ground truth, oversampled x32) and
      acceptances in `ml/data/accepted/` (self-labelled, currently unused by training). When
      there is enough, fine-tune `xl.pt` on it. Open questions to settle *then*, not now:
      the accepted repeat factor (x1–x2, nowhere near x32), whether to keep only
      low-confidence-but-right acceptances, and holding out a slice of real user ink as a
      test set that is not MathWriting ([HANDWRITING_MODEL.md](HANDWRITING_MODEL.md) Step 14).
- [ ] **Shell-native UX** — verify/replace the export paths in WKWebView (blob downloads
      and `window.print()` behave differently: share sheet for `.tex`/`.aqnote`/PDF),
      haptics, hardware-keyboard shortcuts, Split View/multitasking behavior, larger touch
      targets in editor chrome (overlaps the responsive-layout item).
- [ ] **App Store readiness** — final bundle id (placeholder `com.stevee.aquarius`), full
      icon set + launch screen, entitlements file (none exists), **privacy manifest**
      (required since 2024) + nutrition labels, remove the ATS dev exception from release
      builds, screenshots, TestFlight beta, $99/yr Developer Program enrollment.
- [ ] **Compliance** — Sign in with Apple + account deletion (cross-platform pair above);
      review-proofing per Guideline 4.2 (offline-working app + native Pencil layer, which
      the items above deliver).
- [ ] **Licensing gate** — resolve the MathWriting/CROHME non-commercial-license question
      (legal read vs MyScript license vs synthetic data) **before** shipping Ancha
      commercially ([HANDWRITING_MODEL.md](HANDWRITING_MODEL.md) §3).

## Desktop (Windows/Mac)

Nothing exists today — no shell, no scaffold. First decision: **Tauri v2 vs Electron**
(Capacitor's Electron platform is community-maintained; a separate shell is cleaner).
Tauri is the lighter default; Electron if Chromium-exact rendering (KaTeX/MathLive/print)
proves necessary. Then:

- [ ] **Shell scaffold** loading the same static export the iPad build requires (shared
      prerequisite — build it once).
- [ ] **Desktop integration** — native menu bar, window-state persistence, `.aqnote` file
      association (double-click opens the app), drag-and-drop file/image import.
- [ ] **Storage durability** — decide IndexedDB-in-webview (watch persistence/eviction
      semantics per webview) vs a filesystem-backed store; at minimum an automatic
      local-file backup of the library.
- [ ] **Print-to-PDF via the webview** — desktop shells can render PDFs programmatically;
      a cheap interim "real PDF export" while server/WASM TeX is pending.
- [ ] **Auto-update** — Tauri updater or Squirrel/Sparkle equivalents.
- [ ] **Signing + distribution** — macOS Developer ID signing + notarization (DMG),
      Windows code-signing cert (MSI/NSIS); Mac App Store optional later.
- [ ] **Ancha on desktop** — optional: trackpad/tablet ink is niche on desktop;
      cloud endpoint or ONNX-runtime local inference if wanted.
