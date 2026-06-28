/**
 * Structural math editor — editable DOM renderer (pure).
 *
 * Renders the block tree as our OWN positioned DOM (not KaTeX-from-string, which
 * is a static blob with no caret insertion points). Each row/atom carries
 * `data-row-owner`/`data-slot`/`data-index` so a click maps back to a cursor
 * position (hit-testing in components/MathEdit.tsx). KaTeX is reused only to draw
 * single glyphs (a `\alpha` symbol, the `∫`/`∑` operators) — static, no caret.
 *
 * The caret is a blinking span drawn at `cursor.index` when a row is active.
 */

import { Fragment, type ReactNode } from "react";

import type { Block } from "@/lib/blocks/types";
import { Katex } from "@/components/Katex";

import type { Cursor } from "./model";

// Optional slots are hidden when empty + inactive (so `x^2` shows no empty sub
// box); required slots always show a placeholder so the structure stays visible.
const OPTIONAL_SLOTS = new Set(["sup", "sub", "upper", "lower", "index", "diff", "integrand"]);

const BIGOP_GLYPH: Record<string, string> = {
  sum: "\\sum", prod: "\\prod", coprod: "\\coprod", bigcup: "\\bigcup", bigcap: "\\bigcap", lim: "\\lim",
};

function Caret() {
  return <span className="me-caret" aria-hidden />;
}

/** A single static glyph via KaTeX (operator / symbol command). */
function Glyph({ latex }: { latex: string }) {
  return <Katex latex={latex} className="me-glyph" />;
}

function SymbolAtom({ value }: { value: string }) {
  // A LaTeX command (\alpha) → KaTeX glyph; plain text → as-is.
  if (value.startsWith("\\")) return <Glyph latex={value} />;
  return <span>{value}</span>;
}

function renderRow(owner: Block, slot: string, cursor: Cursor): ReactNode {
  const row = owner.slots?.[slot] ?? [];
  const active = cursor.rowOwnerId === owner.id && cursor.slot === slot;
  const data = { "data-row-owner": owner.id, "data-slot": slot } as const;

  if (row.length === 0) {
    if (!active && OPTIONAL_SLOTS.has(slot)) {
      return <span className="me-slot me-empty-hidden" {...data} data-index={0} />;
    }
    return (
      <span className="me-slot me-empty" {...data} data-index={0}>
        {active ? <Caret /> : <span className="me-box" />}
      </span>
    );
  }
  return (
    <span className="me-slot" {...data}>
      {active && cursor.index === 0 && <Caret />}
      {row.map((child, i) => (
        <Fragment key={child.id}>
          <span className="me-cell" {...data} data-index={i}>{renderBlock(child, cursor)}</span>
          {active && cursor.index === i + 1 && <Caret />}
        </Fragment>
      ))}
    </span>
  );
}

export function renderBlock(block: Block, cursor: Cursor): ReactNode {
  switch (block.type) {
    case "number":
      return <span className="me-num">{block.value}</span>;
    case "operator":
      return <span className="me-op">{block.value}</span>;
    case "identifier":
      return <span className="me-id">{block.value}</span>;
    case "symbol":
      return <SymbolAtom value={block.value ?? ""} />;

    case "math":
    case "group": {
      const d = block.attrs?.delimiters;
      const body = renderRow(block, "body", cursor);
      if (block.type === "math") return body;
      return (
        <span className="me-group">
          <span className="me-delim">{d?.[0] ?? "("}</span>
          {body}
          <span className="me-delim">{d?.[1] ?? ")"}</span>
        </span>
      );
    }

    case "fraction":
      return (
        <span className="me-frac">
          <span className="me-frac-num">{renderRow(block, "num", cursor)}</span>
          <span className="me-frac-bar" />
          <span className="me-frac-den">{renderRow(block, "den", cursor)}</span>
        </span>
      );

    case "script":
      return (
        <span className="me-script">
          <span className="me-base">{renderRow(block, "base", cursor)}</span>
          <span className="me-scripts">
            <span className="me-sup">{renderRow(block, "sup", cursor)}</span>
            <span className="me-sub">{renderRow(block, "sub", cursor)}</span>
          </span>
        </span>
      );

    case "root":
      return (
        <span className="me-root">
          <span className="me-root-index">{renderRow(block, "index", cursor)}</span>
          <span className="me-radical">√</span>
          <span className="me-radicand">{renderRow(block, "radicand", cursor)}</span>
        </span>
      );

    case "integral":
      return (
        <span className="me-bigop">
          <span className="me-int-glyph"><Glyph latex="\int" /></span>
          <span className="me-scripts">
            <span className="me-sup">{renderRow(block, "upper", cursor)}</span>
            <span className="me-sub">{renderRow(block, "lower", cursor)}</span>
          </span>
          <span className="me-operand">{renderRow(block, "integrand", cursor)}</span>
          {(block.slots?.diff?.length ?? 0) > 0 && (
            <span className="me-operand"><span className="me-op">d</span>{renderRow(block, "diff", cursor)}</span>
          )}
        </span>
      );

    case "bigop":
      return (
        <span className="me-bigop">
          <span className="me-stack">
            <span className="me-over">{renderRow(block, "upper", cursor)}</span>
            <Glyph latex={BIGOP_GLYPH[String(block.attrs?.op ?? "sum")] ?? "\\sum"} />
            <span className="me-under">{renderRow(block, "lower", cursor)}</span>
          </span>
          <span className="me-operand">{renderRow(block, "operand", cursor)}</span>
        </span>
      );

    case "matrix": {
      const rows = Number(block.attrs?.rows ?? 0);
      const cols = Number(block.attrs?.cols ?? 0);
      return (
        <span className="me-matrix">
          <span className="me-delim">(</span>
          <span className="me-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, auto)` }}>
            {Array.from({ length: rows }, (_, r) =>
              Array.from({ length: cols }, (_, c) => (
                <span className="me-mcell" key={`r${r}c${c}`}>{renderRow(block, `r${r}c${c}`, cursor)}</span>
              )),
            )}
          </span>
          <span className="me-delim">)</span>
        </span>
      );
    }

    default:
      return <span>{block.value}</span>;
  }
}

/** Render the whole editor tree (its top-level body row). */
export function renderMathTree(tree: Block, cursor: Cursor): ReactNode {
  return renderRow(tree, "body", cursor);
}
