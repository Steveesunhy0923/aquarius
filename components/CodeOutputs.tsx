"use client";

import type { CodeOutput } from "@/lib/blocks/codeblock";

/**
 * Rendered run outputs of a code block — shared by the interactive listing
 * (CodeBlockView) and the static render (BlockView, used in previews and
 * read-only surfaces).
 *
 * The result is a consequence of the code, so it reads like one: quieter ink,
 * hung off a single `→` in the margin rather than fenced in a second pane.
 * Errors keep the danger token — a failed run should be unmissable.
 */
export function CodeOutputs({ outputs }: { outputs: CodeOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="relative mt-2 pl-4 font-mono text-[12.5px] leading-[1.62]">
      <span aria-hidden className="absolute left-0 top-0 select-none text-faint">
        →
      </span>
      <span className="sr-only">Output: </span>
      {outputs.map((o, i) => (
        <pre
          key={i}
          className={`overflow-x-auto whitespace-pre-wrap break-words ${
            o.kind === "stderr" || o.kind === "error" ? "text-danger" : "text-muted"
          }`}
        >
          {o.text.replace(/\n$/, "")}
        </pre>
      ))}
    </div>
  );
}
