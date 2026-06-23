"use client";

import { BlockView } from "@/components/BlockView";
import { documentToLatex } from "@/lib/blocks";
import type { Block, BlockType, Slots } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { NotePackage } from "@/lib/storage/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Minimal WYSIWYG editor. The block tree is the source of truth; the rendered
 * view and the source view are both serializations of it. Inserting a structure
 * mutates the tree and re-renders — never edits LaTeX text directly.
 */
export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [pkg, setPkg] = useState<NotePackage | null>(null);
  const [title, setTitle] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    (async () => {
      const store = getStore();
      const [p, meta] = await Promise.all([
        store.openNote(id),
        store.getNoteMeta(id),
      ]);
      setPkg(p);
      setTitle(meta?.title ?? "Untitled");
    })().catch(console.error);
  }, [id]);

  function appendBlock(block: Block) {
    setPkg((prev) =>
      prev
        ? { ...prev, tree: { ...prev.tree, blocks: [...prev.tree.blocks, block] } }
        : prev,
    );
    setSaved(false);
  }

  async function save() {
    if (!pkg) return;
    const store = getStore();
    await store.saveNote(pkg);
    await store.updateNoteMeta(id, { title });
    setSaved(true);
  }

  if (!pkg) {
    return (
      <main className="grid min-h-screen place-items-center text-muted">
        Opening note…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-border px-6 py-3">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          ← Library
        </Link>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          className="flex-1 bg-transparent text-lg font-semibold outline-none"
        />
        <button
          onClick={() => setShowSource((s) => !s)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
        >
          {showSource ? "WYSIWYG" : "Source"}
        </button>
        <button
          onClick={save}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </header>

      {/* Structure toolbar (Toolbar 1) — demo subset that inserts real blocks */}
      <div className="flex flex-wrap gap-2 border-b border-border px-6 py-2">
        {TOOLBAR.map((t) => (
          <button
            key={t.label}
            onClick={() => appendBlock(t.make())}
            title={t.label}
            className="rounded-md border border-border px-3 py-1 text-sm hover:border-accent"
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 p-8">
        {showSource ? (
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 text-sm">
            <code>{documentToLatex(pkg.tree)}</code>
          </pre>
        ) : pkg.tree.blocks.length === 0 ? (
          <p className="text-muted">
            Empty note. Use the toolbar above to insert a structure.
          </p>
        ) : (
          <div className="space-y-3">
            {pkg.tree.blocks.map((b) => (
              <BlockView key={b.id} block={b} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Demo block builders ─────────────────────────────────────────────────────
// Built directly from the generic Block shape so the editor stays decoupled from
// the factory's exact argument conventions. Real input methods (toolbar, palette,
// shorthand) will share these constructors via lib/blocks/factory.ts.

const uid = () => crypto.randomUUID();
const atom = (type: BlockType, value: string): Block => ({ id: uid(), type, value });
const node = (type: BlockType, slots: Slots, attrs?: Block["attrs"]): Block => ({
  id: uid(),
  type,
  slots,
  ...(attrs ? { attrs } : {}),
});

const TOOLBAR: { label: string; icon: string; make: () => Block }[] = [
  {
    label: "Text",
    icon: "T",
    make: () => atom("text", "New paragraph…"),
  },
  {
    label: "Fraction",
    icon: "a⁄b",
    make: () =>
      node("math", {
        body: [
          node("fraction", {
            num: [atom("identifier", "a")],
            den: [atom("identifier", "b")],
          }),
        ],
      }),
  },
  {
    label: "Square root",
    icon: "√",
    make: () =>
      node("math", {
        body: [node("root", { radicand: [atom("identifier", "x")], index: [] })],
      }),
  },
  {
    label: "Summation",
    icon: "Σ",
    make: () =>
      node("math", {
        body: [
          node(
            "bigop",
            {
              operand: [atom("identifier", "n")],
              lower: [atom("identifier", "n"), atom("operator", "="), atom("number", "1")],
              upper: [atom("symbol", "\\infty")],
            },
            { op: "sum" },
          ),
        ],
      }),
  },
  {
    label: "Integral",
    icon: "∫",
    make: () =>
      node("math", {
        body: [
          node("integral", {
            integrand: [atom("identifier", "f"), atom("identifier", "x")],
            lower: [atom("identifier", "a")],
            upper: [atom("identifier", "b")],
            diff: [atom("identifier", "x")],
          }),
        ],
      }),
  },
];
