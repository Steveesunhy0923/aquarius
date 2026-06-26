"use client";

import { TableView } from "@/components/TableView";
import { useAssetUrl } from "@/components/useAssetUrl";
import { blockToKatex } from "@/lib/blocks";
import { boxStyle, calloutColorOf } from "@/lib/blocks/callouts";
import { parseFormat } from "@/lib/blocks/format";
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
                <figcaption className="mt-1 text-center text-sm italic text-muted">
                  {t.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-sm">
          <code>{block.value ?? ""}</code>
        </pre>
      );

    case "tikz":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          <code>{block.value ?? "% tikz diagram"}</code>
        </pre>
      );

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
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
        🖼 image (no source)
      </div>
    );
  }
  const justify =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  return (
    <div
      className="flex flex-wrap items-start gap-3"
      style={{ justifyContent: justify }}
    >
      {items.map((it, i) => (
        <AsyncImage key={`${it.assetId}:${i}`} item={it} />
      ))}
    </div>
  );
}

function AsyncImage({ item }: { item: ImageItem }) {
  const url = useAssetUrl(item.assetId);
  const cap = (item.caption ?? "").trim();
  return (
    <figure
      className="m-0 flex flex-col items-center"
      style={{ width: item.width ? `${item.width}%` : undefined }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object-URL blob
        <img
          src={url}
          alt={item.alt ?? ""}
          className={`block max-h-[480px] rounded-md ${item.width ? "w-full" : "max-w-full"}`}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Loading image…
        </div>
      )}
      {cap && (
        <figcaption className="mt-1 text-center text-sm italic text-muted">
          {cap}
        </figcaption>
      )}
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
    if (s.href)
      return (
        <a
          key={i}
          href={s.href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          {s.text}
        </a>
      );
    if (s.highlight)
      return (
        <mark key={i} style={{ background: s.highlight, color: "inherit" }}>
          {s.text}
        </mark>
      );
    if (s.bold) return <strong key={i}>{s.text}</strong>;
    if (s.italic) return <em key={i}>{s.text}</em>;
    if (s.underline) return <u key={i}>{s.text}</u>;
    if (s.strike) return <s key={i}>{s.text}</s>;
    return <span key={i}>{s.text}</span>;
  });
}
