"use client";

import { blockToKatex } from "@/lib/blocks";
import type { Block, InlineRun } from "@/lib/blocks/types";
import { Katex } from "./Katex";

/**
 * Renders a single block from the tree into the WYSIWYG surface.
 * Math structures/atoms go through KaTeX; text/code/image/tikz render natively.
 * This is the read-rendered view — interactive editing handles come later.
 */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        <p className="leading-relaxed text-foreground">{renderRuns(block)}</p>
      );

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-sm">
          <code>{block.value ?? ""}</code>
        </pre>
      );

    case "image":
      return (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          🖼 image · asset {String(block.attrs?.assetId ?? "unset")}
        </div>
      );

    case "tikz":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          <code>{block.value ?? "% tikz diagram"}</code>
        </pre>
      );

    default:
      // All math atoms & structures (math, fraction, root, script, integral,
      // bigop, matrix, group, symbol, operator, number, identifier).
      return (
        <div className="my-1 overflow-x-auto">
          <Katex display latex={blockToKatex(block)} />
        </div>
      );
  }
}

function renderRuns(block: Block) {
  const runs = block.attrs?.runs as InlineRun[] | undefined;
  if (!runs || runs.length === 0) return block.value ?? "";
  return runs.map((run, i) =>
    run.kind === "text" ? (
      <span key={i}>{run.text}</span>
    ) : (
      <Katex key={i} latex={blockToKatex(run.block)} />
    ),
  );
}
