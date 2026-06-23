"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders a KaTeX-ready LaTeX string to HTML. `latex` should be the output of
 * `blockToKatex(...)` — i.e. math WITHOUT surrounding `$` delimiters.
 */
export function Katex({
  latex,
  display = false,
  className,
}: {
  latex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: display,
        output: "html",
      });
    } catch {
      return `<span style="color:#dc2626">${latex}</span>`;
    }
  }, [latex, display]);

  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
