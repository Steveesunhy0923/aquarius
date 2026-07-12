/**
 * First-run demo content, kept out of the storage entry point (index.ts is
 * store selection/SSR plumbing; this is content authoring).
 */

import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree } from "@/lib/blocks/types";
import type { LibraryStore } from "./types";

/** Build the canonical Pythagoras document: a^2 + b^2 = c^2. */
function pythagorasTree(): DocumentTree {
  const id = (): string => crypto.randomUUID();

  // A `script` whose base is an identifier and whose `sup` is the exponent 2.
  const squared = (name: string): Block => ({
    id: id(),
    type: "script",
    slots: {
      base: [{ id: id(), type: "identifier", value: name }],
      sup: [{ id: id(), type: "number", value: "2" }],
    },
  });

  const op = (value: string): Block => ({
    id: id(),
    type: "operator",
    value,
  });

  // math container: a^2 + b^2 = c^2
  const equation: Block = {
    id: id(),
    type: "math",
    slots: {
      body: [
        squared("a"),
        op("+"),
        squared("b"),
        op("="),
        squared("c"),
      ],
    },
  };

  // A short prose intro, then the standalone equation.
  const intro: Block = {
    id: id(),
    type: "text",
    value: "The Pythagorean theorem relates the sides of a right triangle:",
    attrs: {
      runs: [
        {
          kind: "text",
          text: "The Pythagorean theorem relates the sides of a right triangle:",
        },
      ],
    },
  };

  const doc = emptyDocument("flow");
  doc.blocks = [intro, equation];
  return doc;
}

/**
 * Seed a friendly starter library — but ONLY when the library is empty (no
 * subjects). Safe to call on every client boot: it is idempotent and does
 * nothing once any subject exists.
 */
export async function seedDemoLibrary(store: LibraryStore): Promise<void> {
  const subjects = await store.listSubjects();
  if (subjects.length > 0) return;

  const subject = await store.createSubject({
    name: "Welcome",
    color: "#2563eb",
  });
  const notebook = await store.createNotebook({
    subjectId: subject.id,
    name: "Getting Started",
  });
  const note = await store.createNote({
    notebookId: notebook.id,
    title: "Pythagoras",
    mode: "flow",
  });

  // Fill the heavy package with the a^2 + b^2 = c^2 document.
  const pkg = await store.openNote(note.id);
  await store.saveNote({ ...pkg, tree: pythagorasTree() });
}
