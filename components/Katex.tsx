"use client";

import katex from "katex";
// Side-effect import: registers mhchem's \ce / \pu commands on the katex
// singleton at module load, so chemistry (\ce{2H2 + O2 -> 2H2O}) renders in
// every surface that goes through this component — which is all of them.
import "katex/contrib/mhchem";
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
