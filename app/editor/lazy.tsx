"use client";

/**
 * The editor's panels that are loaded ON DEMAND.
 *
 * Every component here is mounted only after a deliberate action — opening the
 * graph editor, the design gallery, sharing, version history, the ink sheet,
 * a PDF — and most sessions touch one or two of them, if any. They used to be
 * static imports of the editor, so their code (the graph editor alone is
 * ~1,200 lines) was downloaded and parsed before the first note could render.
 * `next/dynamic` moves each into its own chunk, fetched the first time it is
 * shown.
 *
 * `ssr: false`: they are client-only by nature (they open in response to
 * input), and the editor route renders on the client anyway.
 *
 * Nothing renders while a chunk loads, which is right for a dialog (it simply
 * appears a moment later). Offline is covered: the service worker precaches
 * every chunk of the build, including these (scripts/build-precache.mjs).
 *
 * To add one: it must be conditionally MOUNTED where it is used
 * (`{open && <Panel />}`) — a panel that is always mounted and merely hidden
 * would be fetched immediately and gain nothing.
 */

import dynamic from "next/dynamic";

export const GraphEditor = dynamic(() => import("@/components/GraphEditor").then((m) => m.GraphEditor), { ssr: false });
export const DesignPicker = dynamic(() => import("@/components/DesignPicker").then((m) => m.DesignPicker), { ssr: false });
export const ShareDialog = dynamic(() => import("@/components/ShareDialog").then((m) => m.ShareDialog), { ssr: false });
export const HistoryPanel = dynamic(() => import("@/components/HistoryPanel").then((m) => m.HistoryPanel), { ssr: false });
export const TemplateApplyDialog = dynamic(() => import("@/components/TemplateApplyDialog").then((m) => m.TemplateApplyDialog), { ssr: false });
export const ModuleFileEditor = dynamic(() => import("@/components/ModuleFileEditor").then((m) => m.ModuleFileEditor), { ssr: false });
export const SectionToModuleDialog = dynamic(() => import("@/components/SectionToModuleDialog").then((m) => m.SectionToModuleDialog), { ssr: false });
export const ModuleFieldsDialog = dynamic(() => import("@/components/ModuleFieldsDialog").then((m) => m.ModuleFieldsDialog), { ssr: false });
export const NoteLinkPicker = dynamic(() => import("@/components/NoteLinkPicker").then((m) => m.NoteLinkPicker), { ssr: false });
export const InkInsertPanel = dynamic(() => import("@/components/ink/InkInsertPanel").then((m) => m.InkInsertPanel), { ssr: false });
export const CommandPalette = dynamic(() => import("@/components/CommandPalette").then((m) => m.CommandPalette), { ssr: false });

/** An imported PDF IS the note's body, so unlike the dialogs above it leaves a
 *  hole while loading; hold the canvas area open rather than collapsing it. */
export const PdfDocumentView = dynamic(() => import("@/components/pdf/PdfDocumentView").then((m) => m.PdfDocumentView), {
  ssr: false,
  loading: () => <div className="flex-1" />,
});
