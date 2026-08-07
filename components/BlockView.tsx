"use client";

import { AsyncImage, ImageEmpty } from "@/components/AsyncImage";
import { CodeOutputs } from "@/components/CodeOutputs";
import { codeExecCount, codeLangInfo, codeOutputs } from "@/lib/blocks/codeblock";
import { GraphView } from "@/components/GraphView";
import { ExternalLink } from "@/components/ExternalLink";
import { NoteLink } from "@/components/NoteLink";
import { TableView } from "@/components/TableView";
import { blockToKatex } from "@/lib/blocks";
import { boxStyle, calloutColorOf } from "@/lib/blocks/callouts";
import { splitFieldTokens } from "@/lib/blocks/fields";
import { parseFormat } from "@/lib/blocks/format";
import { isNoteHref } from "@/lib/blocks/notelink";
import { headingAlign, headingLevel } from "@/lib/blocks/headings";
import { listItems, listMarker, listOrdered } from "@/lib/blocks/lists";
import {
  imageAlign,
  imageItems,
  type ImageAlign,
  type ImageItem,
} from "@/lib/blocks/images";
import { tableAlign, tableItems } from "@/lib/blocks/tables";
import type { Block, InlineRun } from "@/lib/blocks/types";
import type { ReactNode } from "react";
import { Katex } from "./Katex";

const CAPTION = "mt-1 text-center text-sm italic text-muted";

/** Renders a single block from the tree into the WYSIWYG surface. */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text": {
      const color = calloutColorOf(block);
      if (color) {
        const s = boxStyle(color);
        return (
          <div
            className="whitespace-pre-wrap break-words rounded-md px-3 py-2 leading-relaxed"
            style={{
              background: s.background,
              border: `1px solid ${s.borderColor}`,
              color: s.color,
            }}
          >
            {renderRuns(block)}
          </div>
        );
      }
      return (
        <p
          className="whitespace-pre-wrap break-words text-foreground"
          style={{ textIndent: "var(--indent, 0)" }}
        >
          {renderRuns(block)}
        </p>
      );
    }

    case "heading": {
      const lvl = headingLevel(block);
      const size =
        lvl === 1 ? "1.9em" : lvl === 2 ? "1.45em" : lvl === 3 ? "1.2em" : "1.05em";
      return (
        <div
          className={lvl === 1 ? "font-bold" : "font-semibold"}
          style={{ fontSize: size, textAlign: headingAlign(block) }}
        >
          {block.value || "Untitled heading"}
        </div>
      );
    }

    case "list": {
      const items = listItems(block).filter((x) => x.trim());
      const inner = items.map((it, i) => <li key={i}>{renderFormatted(it)}</li>);
      const style = { listStyleType: listMarker(block) };
      return listOrdered(block) ? (
        <ol className="ml-6 list-decimal space-y-0.5 leading-relaxed" style={style}>{inner}</ol>
      ) : (
        <ul className="ml-6 list-disc space-y-0.5 leading-relaxed" style={style}>{inner}</ul>
      );
    }

    case "image":
      return <ImageRow items={imageItems(block)} align={imageAlign(block)} />;

    case "table": {
      const tables = tableItems(block);
      const align = tableAlign(block);
      const justify =
        align === "left"
          ? "flex-start"
          : align === "right"
            ? "flex-end"
            : "center";
      return (
        <div
          className="flex flex-wrap items-start gap-4"
          style={{ justifyContent: justify }}
        >
          {tables.map((t, i) => (
            <figure key={i} className="m-0 overflow-x-auto">
              <TableView data={t} />
              {(t.caption ?? "").trim() && (
                <figcaption className={CAPTION}>{t.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      );
    }

    // A listing, matching the live editor (components/CodeBlockView): a single
    // hairline rule, the result hung off a `→`, and a caption for the language.
    case "code": {
      const lang = codeLangInfo(block);
      const outputs = codeOutputs(block);
      const execCount = codeExecCount(block);
      return (
        <div className="my-1">
          <div className="border-l-2 border-border pl-4">
            <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.62]">
              <code>{block.value ?? ""}</code>
            </pre>
          </div>
          <CodeOutputs outputs={outputs} />
          {lang.id !== "text" && (
            <div className="mt-1.5 pl-4 text-[10.5px] uppercase tracking-[0.07em] text-muted">
              {lang.label}
              {execCount > 0 && ` · Run ${execCount}`}
            </div>
          )}
        </div>
      );
    }

    case "tikz":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          <code>{block.value ?? "% tikz diagram"}</code>
        </pre>
      );

    case "graph":
      return <GraphView block={block} />;

    default:
      return (
        <div className="my-1 overflow-x-auto">
          <Katex display latex={blockToKatex(block)} />
        </div>
      );
  }
}

/** A horizontally-aligned row of one or more images (read-only). */
export function ImageRow({
  items,
  align,
}: {
  items: ImageItem[];
  align: ImageAlign;
}) {
  if (items.length === 0) return <ImageEmpty />;
  const justify =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  return (
    <div
      className="flex flex-wrap items-start gap-3"
      style={{ justifyContent: justify }}
    >
      {items.map((it, i) => (
        <ImageFigure key={`${it.assetId}:${i}`} item={it} />
      ))}
    </div>
  );
}

function ImageFigure({ item }: { item: ImageItem }) {
  const cap = (item.caption ?? "").trim();
  return (
    <figure
      className="m-0 flex flex-col items-center"
      style={{ width: item.width ? `${item.width}%` : undefined }}
    >
      <AsyncImage item={item} />
      {cap && <figcaption className={CAPTION}>{cap}</figcaption>}
    </figure>
  );
}

/** Render prose runs with inline math + bold/italic markers. */
function renderRuns(block: Block): ReactNode {
  const runs = block.attrs?.runs as InlineRun[] | undefined;
  if (!runs || runs.length === 0) return renderFormatted(block.value ?? "");
  return runs.map((run, i) =>
    run.kind === "text" ? (
      <span key={i}>{renderFormatted(run.text)}</span>
    ) : (
      <Katex key={i} latex={blockToKatex(run.block)} />
    ),
  );
}

function renderFormatted(text: string): ReactNode {
  return parseFormat(text).map((s, i) => {
    if (s.href && isNoteHref(s.href)) return <NoteLink key={i} href={s.href} text={s.text} />;
    if (s.href) return <ExternalLink key={i} href={s.href} text={s.text} />;
    const t = withFieldChips(s.text);
    if (s.highlight)
      return (
        <mark key={i} style={{ background: s.highlight, color: "inherit" }}>
          {t}
        </mark>
      );
    if (s.bold) return <strong key={i}>{t}</strong>;
    if (s.italic) return <em key={i}>{t}</em>;
    if (s.underline) return <u key={i}>{t}</u>;
    if (s.strike) return <s key={i}>{t}</s>;
    return <span key={i}>{t}</span>;
  });
}

/** Unfilled `{{field}}` tokens render as placeholder chips, not literal braces. */
function withFieldChips(text: string): ReactNode {
  if (!text.includes("{{")) return text;
  return splitFieldTokens(text).map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <span
        key={i}
        className="mx-0.5 rounded border border-dashed border-accent/60 bg-accent-soft/40 px-1 py-px text-[0.85em] text-accent"
        title="Fill-in field — click the text to edit"
      >
        {part.field}
      </span>
    ),
  );
}
