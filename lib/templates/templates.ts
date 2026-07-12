/**
 * Document templates — Canva-style starting points for a note.
 *
 * A template is just a `DocumentTree` (blocks + style). Note templates are now
 * *presets*: ordered stacks of modules (see `lib/templates/modules.ts`) that
 * concatenate into a tree. Posters remain standalone designs. User-saved
 * templates store a tree and are id-refreshed on use (see `freshTree`); they
 * live in localStorage (browser-only) — small, structural starting points, not
 * the user's content.
 */

import {
  banner,
  builtinPresets,
  bullets,
  centerHeading,
  eq,
  freshBlock,
  presetTree,
} from "@/lib/templates/modules";
import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentStyle, DocumentTree } from "@/lib/blocks/types";

const uid = (): string => crypto.randomUUID();

function posterTree(blocks: Block[], style: Partial<DocumentStyle>): DocumentTree {
  const t = emptyDocument("flow");
  t.blocks = blocks;
  t.style = { ...style };
  return t;
}

/** Deep-clone a tree with brand-new block ids throughout. */
export function freshTree(t: DocumentTree): DocumentTree {
  return { ...t, blocks: t.blocks.map(freshBlock) };
}

// ─── Built-in templates ───────────────────────────────────────────────────────

export type TemplateCategory = "note" | "poster";

export interface BuiltInTemplate {
  id: string;
  name: string;
  scenario: string;
  category: TemplateCategory;
  build: () => DocumentTree;
}

// Note templates ARE the built-in presets: each is an ordered module stack
// materialized into a tree (fresh block ids per use).
const notePresets: BuiltInTemplate[] = builtinPresets().map((p) => ({
  id: p.id,
  name: p.name,
  scenario: p.scenario,
  category: "note" as const,
  build: () => presetTree(p),
}));

// Posters — full designs with a background + centered elements.
const posters: BuiltInTemplate[] = [
  {
    id: "event-poster",
    name: "Event Poster",
    scenario: "Bold title, tagline, and a details banner on a deep gradient.",
    category: "poster",
    build: () =>
      posterTree(
        [
          centerHeading(1, "EVENT TITLE"),
          centerHeading(2, "A short, punchy tagline goes here"),
          banner("📅  Day, Month Date · 0:00 PM      📍  Venue / Location", "#6366f1"),
          centerHeading(3, "Featuring · Hosted by · RSVP link"),
        ],
        { background: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)", foreground: "#f8fafc" },
      ),
  },
  {
    id: "quote-poster",
    name: "Quote Poster",
    scenario: "A large centered quotation with attribution.",
    category: "poster",
    build: () =>
      posterTree(
        [
          centerHeading(1, "“The only way to learn mathematics is to do mathematics.”"),
          centerHeading(2, "— Paul Halmos"),
        ],
        { background: "linear-gradient(135deg, #fdfcfb, #e2d1c3)" },
      ),
  },
  {
    id: "concept-poster",
    name: "Concept Poster",
    scenario: "Headline a single concept with a definition banner and key points.",
    category: "poster",
    build: () =>
      posterTree(
        [
          centerHeading(1, "KEY CONCEPT"),
          banner("Definition — state the concept in one clear sentence.", "#22c55e"),
          centerHeading(2, "Why it matters"),
          bullets(["Reason it's important", "Where it shows up", "A common pitfall"]),
          eq("E = mc^2"),
        ],
        { background: "linear-gradient(135deg, #a1c4fd, #c2e9fb)" },
      ),
  },
];

export const BUILTIN_TEMPLATES: BuiltInTemplate[] = [...notePresets, ...posters];

// ─── Built-in backgrounds (page surface; readable text auto-paired) ───────────

export interface BuiltInBackground {
  id: string;
  name: string;
  /** CSS `background` value. */
  css: string;
  /** Page text color to pair (for dark backgrounds); omit for light ones. */
  text?: string;
}

export const BUILTIN_BACKGROUNDS: BuiltInBackground[] = [
  { id: "white", name: "White", css: "#ffffff" },
  { id: "cream", name: "Cream", css: "#fdf6e3" },
  { id: "sky", name: "Sky", css: "linear-gradient(135deg, #a1c4fd, #c2e9fb)" },
  { id: "mint", name: "Mint", css: "linear-gradient(135deg, #d4fc79, #96e6a1)" },
  { id: "peach", name: "Peach", css: "linear-gradient(135deg, #ffecd2, #fcb69f)" },
  { id: "blush", name: "Blush", css: "linear-gradient(135deg, #ff9a9e, #fad0c4)" },
  { id: "lavender", name: "Lavender", css: "linear-gradient(135deg, #fbc2eb, #a6c1ee)" },
  { id: "dots", name: "Dot grid", css: "radial-gradient(circle, #cbd5e1 1.5px, transparent 1.5px) 0 0 / 22px 22px, #ffffff" },
  { id: "graph", name: "Graph paper", css: "linear-gradient(#e2e8f0 1px, transparent 1px) 0 0 / 100% 24px, linear-gradient(90deg, #e2e8f0 1px, transparent 1px) 0 0 / 24px 100%, #ffffff" },
  { id: "ruled", name: "Ruled", css: "linear-gradient(#dbeafe 1px, transparent 1px) 0 28px / 100% 30px, #ffffff" },
  { id: "stripes", name: "Stripes", css: "repeating-linear-gradient(45deg, #f1f5f9 0 12px, #ffffff 12px 24px)" },
  { id: "midnight", name: "Midnight", css: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)", text: "#f8fafc" },
  { id: "grape", name: "Grape", css: "linear-gradient(135deg, #667eea, #764ba2)", text: "#ffffff" },
  { id: "ember", name: "Ember", css: "linear-gradient(135deg, #f12711, #f5af19)", text: "#1a1a1a" },
];

// ─── User-saved templates (localStorage) ──────────────────────────────────────

export interface SavedTemplate {
  id: string;
  name: string;
  scenario: string;
  tree: DocumentTree;
  createdAt: string;
}

const LS_KEY = "aquarius.templates.v1";

export function listSavedTemplates(): SavedTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (t): t is SavedTemplate =>
        !!t && typeof (t as SavedTemplate).id === "string" && !!(t as SavedTemplate).tree,
    );
  } catch {
    return [];
  }
}

function writeSaved(list: SavedTemplate[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(list));
}

/** Save a tree as a reusable template; returns the stored record. */
export function saveTemplate(name: string, scenario: string, t: DocumentTree, createdAt: string): SavedTemplate {
  const record: SavedTemplate = { id: uid(), name, scenario, tree: t, createdAt };
  writeSaved([record, ...listSavedTemplates()]);
  return record;
}

export function deleteTemplate(id: string): void {
  writeSaved(listSavedTemplates().filter((t) => t.id !== id));
}
