/**
 * Environment templates from the symbol catalog — `\begin{bmatrix}\end{bmatrix}`
 * and friends (matrix / pmatrix / cases / aligned / smallmatrix …).
 *
 * Every OTHER template in `lib/symbols.ts` marks its holes with empty braces —
 * `\frac{}{}`, `\sqrt{}`, `\binom{}{}` — and each consumer rewrites `{}` into
 * whatever it needs: nothing for a bracket-only preview, `#?` for a tabbable
 * MathLive box, `\placeholder{}` for the inline-math popover.
 *
 * An environment has no braces to rewrite. Its cells are delimited by `&` and
 * `\\`, so the skeletons passed through every one of those rewrites untouched
 * and inserted an environment with ZERO cells: empty brackets with no caret
 * target, where the next keystroke landed *after* the matrix rather than in it
 * (`\begin{bmatrix}\end{bmatrix}1`, rendering as `[]1`).
 *
 * Environments therefore get the same treatment through this one rewrite —
 * expand the skeleton into a grid whose cells the caller fills — plus the two
 * grid operations the rest of the app needs: knowing which environments are
 * matrices, and filling cells the user left blank.
 */

/** `\begin{env}\end{env}` with nothing between it: the catalog's skeleton form.
 *  Global, so `replace` reaches every environment in a compound snippet. */
const ENV_TEMPLATE = /\\begin\{([A-Za-z]+\*?)\}\s*\\end\{\1\}/g;

/** The shape a bare template expands to. Two rows and two columns read as a
 *  matrix at a glance, and suit the non-matrix environments too — `cases` wants
 *  value & condition, `aligned` wants LHS & RHS. */
export const ENV_ROWS = 2;
export const ENV_COLS = 2;

/**
 * The environments treated as an editable GRID — the ones whose rows and cells
 * the editor grows for you. `displaylines`, `aligned` and `split` are arrays
 * too, but they lay out prose-like maths whose rows are statements rather than
 * cells, so they keep the stock behavior of every key.
 */
export const GRID_ENVS = [
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "cases",
] as const;
export type GridEnvName = (typeof GRID_ENVS)[number];

export function isGridEnv(env: string): env is GridEnvName {
  return (GRID_ENVS as readonly string[]).includes(env);
}

/**
 * `cases` is a grid, but it is NOT a matrix, and the difference is the whole
 * of its editing behavior.
 *
 * Its two columns are fixed by what the notation means — a value and the
 * condition it holds under — so a third column is never what someone writing a
 * piecewise definition wanted; only the rows (the cases) grow. Its blank cells
 * are also never `0` (see `ZERO_FILLED_ENVS`), and its controls say "case", not
 * "row × column".
 */
export const isCasesEnv = (env: string): boolean => env === "cases";

/**
 * Grids whose blank cells default to `0` — every grid EXCEPT `cases`, whose
 * second column holds conditions ("if x > 0"), not numbers. A missing condition
 * is a condition the author still owes; writing `0` there would state something
 * false rather than fill a hole.
 */
const ZERO_FILLED_ENVS = GRID_ENVS.filter((e) => e !== "cases") as readonly string[];
export const isMatrixEnv = (env: string): boolean => ZERO_FILLED_ENVS.includes(env);

/** Environments that draw their own delimiters — the ones that can preview as
 *  delimiters alone. The rest (`matrix`, `smallmatrix`, `aligned`) draw nothing,
 *  so an empty one would be an invisible entry in the picker. */
const DELIMITED_ENVS = ["pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases"];
const envDrawsDelimiters = (env: string): boolean => DELIMITED_ENVS.includes(env);

/** `\begin{env}` … `\end{env}` around `rows × cols` cells from `cell()`. */
function grid(env: string, rows: number, cols: number, cell: () => string): string {
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => cell()).join(" & "),
  ).join("\\\\");
  return `\\begin{${env}}${body}\\end{${env}}`;
}

/**
 * Expand every cell-less environment in `latex` into an `ENV_ROWS × ENV_COLS`
 * grid. `cell` is called once per cell with the environment's name, so callers
 * can hand out distinct values (a preview's a, b, c, d), the same token every
 * time (`#?`), or nothing at all. Snippets with no environment come back
 * untouched, so this is safe to apply to anything.
 */
export function fillEnvCells(latex: string, cell: (env: string) => string): string {
  return latex.replace(ENV_TEMPLATE, (_match, env: string) =>
    grid(env, ENV_ROWS, ENV_COLS, () => cell(env)),
  );
}

/**
 * The ICON form, for the symbol picker and toolbar strip.
 *
 * A delimited environment shrinks to its delimiters around ONE empty cell:
 * that renders at exactly the height of a single-glyph icon like `\alpha`,
 * where a 2×2 grid is twice as tall and towers over every neighbouring entry.
 * Environments that draw no delimiters would be blank at that size, so they
 * keep a sample grid — `sample()` supplies their letters.
 */
export function previewEnvCells(latex: string, sample: () => string): string {
  return latex.replace(ENV_TEMPLATE, (_match, env: string) =>
    envDrawsDelimiters(env) ? `\\begin{${env}} \\end{${env}}` : grid(env, ENV_ROWS, ENV_COLS, sample),
  );
}

// ─── Blank cells → 0 (stored) / → a placeholder box (being edited) ───────────

/** A cell holding nothing the reader would see: whitespace, MathLive's unfilled
 *  `\placeholder{}` box, or an empty group left behind by one. */
function isBlankCell(cell: string): boolean {
  return cell.replace(/\\placeholder\{\}|\{\}|\s/g, "") === "";
}

/**
 * Split a row/body at `sep`, ignoring separators nested inside braces or inner
 * environments — a matrix in a cell keeps its own `&` and `\\`.
 */
function splitTop(s: string, sep: "&" | "\\\\"): string[] {
  const parts: string[] = [];
  let braces = 0;
  let envs = 0;
  let buf = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      if (s[i + 1] === "\\") {
        if (sep === "\\\\" && braces === 0 && envs === 0) { parts.push(buf); buf = ""; i += 2; continue; }
        buf += "\\\\";
        i += 2;
        continue;
      }
      const cmd = /^\\[A-Za-z]+\*?/.exec(s.slice(i));
      if (cmd) {
        if (cmd[0] === "\\begin") envs++;
        else if (cmd[0] === "\\end") envs--;
        buf += cmd[0];
        i += cmd[0].length;
        continue;
      }
      buf += s.slice(i, i + 2); // an escaped character, e.g. \{
      i += 2;
      continue;
    }
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    if (ch === "&" && sep === "&" && braces === 0 && envs === 0) { parts.push(buf); buf = ""; i++; continue; }
    buf += ch;
    i++;
  }
  parts.push(buf);
  return parts;
}

/** Rebuild a grid body with every blank cell replaced by `filler`. */
function fillBlankCells(body: string, applies: (env: string) => boolean, filler: string): string {
  return splitTop(body, "\\\\")
    .map((row) =>
      splitTop(row, "&")
        .map((cell) => {
          const inner = fillGrids(cell, applies, filler); // a nested grid fills too
          return isBlankCell(inner) ? filler : inner.trim();
        })
        .join(" & "),
    )
    .join("\\\\");
}

/**
 * Walk `latex` and give the blank cells of every environment `applies` accepts
 * the value `filler`. Environments it rejects are still descended into, so a
 * matrix nested inside an `aligned` is reached.
 */
function fillGrids(latex: string, applies: (env: string) => boolean, filler: string): string {
  let out = "";
  let i = 0;
  while (i < latex.length) {
    const begin = /^\\begin\{([A-Za-z]+\*?)\}/.exec(latex.slice(i));
    if (!begin) {
      out += latex[i];
      i += 1;
      continue;
    }
    const env = begin[1];
    const openTag = `\\begin{${env}}`;
    const closeTag = `\\end{${env}}`;
    const bodyStart = i + begin[0].length;
    // Matching close, counting same-name environments nested inside.
    let depth = 1;
    let j = bodyStart;
    while (j < latex.length && depth > 0) {
      if (latex.startsWith(openTag, j)) { depth++; j += openTag.length; continue; }
      if (latex.startsWith(closeTag, j)) { depth--; if (depth === 0) break; j += closeTag.length; continue; }
      j += 1;
    }
    if (depth !== 0) { // unterminated — leave the rest exactly as it is
      out += latex.slice(i);
      break;
    }
    const body = latex.slice(bodyStart, j);
    out += openTag + (applies(env) ? fillBlankCells(body, applies, filler) : fillGrids(body, applies, filler)) + closeTag;
    i = j + closeTag.length;
  }
  return out;
}

/**
 * Give every blank cell of every matrix in `latex` a value — `0` by default.
 *
 * Growing a matrix leaves holes: `addRowAfter` fills the new row with
 * `\placeholder{}` boxes and `addColumnAfter` with nothing at all, and whatever
 * the user does not type into stays blank. Rather than storing a ragged matrix,
 * the unfilled positions default to zero when the edit ends — the value a blank
 * slot in a matrix conventionally has.
 *
 * Only matrices are touched; `cases`, other environments, and any maths outside
 * an environment pass through unchanged.
 */
export function zeroFillCells(latex: string, zero = "0"): string {
  return fillGrids(latex, isMatrixEnv, zero);
}

/**
 * The inverse view, for a field about to be EDITED: every blank cell becomes a
 * `\placeholder{}` box.
 *
 * A stored grid holds its blanks as nothing at all (`\begin{cases} & \\ & \end
 * {cases}` — what MathLive's placeholder-free output gives us, and what KaTeX
 * can render). Handed back to MathLive verbatim, that is a set of braces with
 * no visible cells and no obvious way in: the reason an empty `cases` reads as
 * one enormous brace rather than as a piecewise definition waiting to be
 * filled. Restoring the boxes makes the cells visible, clickable and tabbable
 * again; MathLive drops them from its output, so nothing is stored.
 *
 * Unlike `zeroFillCells` this covers `cases` too — a case with no value is
 * exactly what wants a box.
 */
export function showBlankCells(latex: string): string {
  return fillGrids(latex, isGridEnv, "\\placeholder{}");
}
