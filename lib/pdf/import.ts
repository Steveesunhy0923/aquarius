"use client";

/**
 * Importing a PDF as a note.
 *
 * The bytes go to the asset store (the same place image blobs live) and the
 * note's tree carries only a `source` descriptor pointing at them — so a 30 MB
 * PDF never travels inside the document tree, which is cloned on every undo
 * snapshot, serialized for search, and diffed by the sync engine.
 *
 * The tree is deliberately BLOCK-LESS: the content is the file. That is also
 * why `DocumentTree.source` has to survive everywhere a tree goes — it is the
 * only thing distinguishing "an imported PDF" from "an empty note", and the
 * editor deletes empty new notes on exit.
 */

import { emptyDocument, type DocumentSource } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { EntityId } from "@/lib/storage/types";
import { readPdf } from "./pdfjs";

/** Anything larger than this is refused rather than wedged into IndexedDB. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export class PdfImportError extends Error {}

/** Strip the extension for the note title — "Lecture 4.pdf" → "Lecture 4". */
export function titleFromFilename(name: string): string {
  return name.replace(/\.pdf$/i, "").trim() || "Imported PDF";
}

export interface ImportedPdf {
  noteId: EntityId;
  title: string;
  pageCount: number;
}

/**
 * Read a picked PDF, store it, and create the note that displays it.
 *
 * Order matters: the file is PARSED before anything is written, so a corrupt or
 * password-protected PDF fails without leaving an unopenable note behind.
 */
export async function importPdfAsNote(file: File, notebookId: EntityId): Promise<ImportedPdf> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfImportError(
      `That PDF is ${(file.size / 1e6).toFixed(0)} MB. The limit is ${MAX_PDF_BYTES / 1e6} MB.`,
    );
  }
  const bytes = await file.arrayBuffer();

  let pageCount: number;
  let sizes: { width: number; height: number }[];
  try {
    const read = await readPdf(bytes);
    pageCount = read.pageCount;
    sizes = read.sizes;
    read.destroy();
  } catch (e) {
    // pdf.js reports encrypted files through a PasswordException; everything
    // else here means the bytes are not a PDF we can render.
    const name = (e as { name?: string })?.name;
    throw new PdfImportError(
      name === "PasswordException"
        ? "That PDF is password-protected, so it can't be imported."
        : "That file couldn't be read as a PDF.",
    );
  }
  if (pageCount === 0) throw new PdfImportError("That PDF has no pages.");

  const store = getStore();
  const title = titleFromFilename(file.name);
  const note = await store.createNote({ notebookId, title });

  const asset = await store.putAsset(note.id, new Blob([bytes], { type: "application/pdf" }), {
    kind: "pdf",
    mime: "application/pdf",
  });

  const source: DocumentSource = {
    kind: "pdf",
    assetId: asset.id,
    pageCount,
    pageSizes: sizes,
    filename: file.name,
    importedAt: new Date().toISOString(),
  };
  const tree = { ...emptyDocument(), source };
  await store.saveNote({
    noteId: note.id,
    tree,
    latexCache: "",
    assets: [asset],
    updatedAt: new Date().toISOString(),
  });

  return { noteId: note.id, title, pageCount };
}
