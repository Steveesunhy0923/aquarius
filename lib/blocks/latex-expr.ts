/**
 * Best-effort LaTeX → plain-infix converter for the "Plot this equation" action.
 *
 * A display formula stores raw LaTeX (`\frac{1}{x}`, `y = x^2`, `\sin(2x)` …),
 * but the graph block's `function` shape samples a *plain infix* string through
 * `compileExpr` (`lib/blocks/expr.ts`) — a different, much smaller dialect with
 * no backslashes or braces. This module bridges the two: it normalizes the
 * common shapes an intro-level note contains (fractions, roots, powers, the
 * trig/log family, `|x|`, `y = f(x)` framing) into that dialect, then hands the
 * result to `isValidExpr` as the final gate. Anything it can't faithfully
 * translate simply fails validation and returns `null` — the caller then knows
 * the formula isn't plottable rather than plotting something wrong.
 *
 * It is intentionally conservative: we would rather return `null` than produce a
 * subtly wrong curve, so the `isValidExpr` gate is the real contract, not the
 * completeness of the rewrite rules.
 */

import { isValidExpr } from "./expr";

/** LaTeX command name → its infix spelling (or "" to drop it). */
const MACROS: Record<string, string> = {
  // trig + inverse + hyperbolic (map to expr.ts's function whitelist)
  sin: "sin", cos: "cos", tan: "tan", sec: "sec", csc: "csc", cot: "cot",
  arcsin: "asin", arccos: "acos", arctan: "atan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh",
  // logs / exp
  ln: "ln", log: "log", exp: "exp",
  // rounding / misc functions
  abs: "abs", sqrt: "sqrt", min: "min", max: "max",
  // constants
  pi: "pi", tau: "tau", theta: "theta",
  // operators
  cdot: "*", times: "*", ast: "*", div: "/",
  // format-only commands we can safely erase
  left: "", right: "", displaystyle: "", limits: "", bigl: "", bigr: "",
  Bigl: "", Bigr: "", big: "", Big: "", mathopen: "", mathclose: "",
};

/** Given `s[open] === "{"`, return the (nesting-aware) contents and the index just past the closing brace. */
function readBrace(s: string, open: number): [string, number] | null {
  if (s[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return [s.slice(open + 1, i), i + 1];
    }
  }
  return null;
}

/** Strip the outermost `$…$`, `$$…$$`, `\(…\)`, `\[…\]` math delimiters. */
function stripDelimiters(s: string): string {
  let out = s.trim();
  for (let guard = 0; guard < 4; guard++) {
    const before = out;
    if (out.startsWith("$$") && out.endsWith("$$")) out = out.slice(2, -2).trim();
    else if (out.startsWith("$") && out.endsWith("$")) out = out.slice(1, -1).trim();
    else if (out.startsWith("\\(") && out.endsWith("\\)")) out = out.slice(2, -2).trim();
    else if (out.startsWith("\\[") && out.endsWith("\\]")) out = out.slice(2, -2).trim();
    if (out === before) break;
  }
  return out;
}

/** Unwrap `\operatorname{…}`, `\mathrm{…}`, `\text{…}`, `\mathbf{…}` → their contents. */
function unwrapText(s: string): string {
  const re = /\\(?:operatorname|mathrm|mathbf|mathit|textrm|text)\s*\{/;
  let out = s;
  for (let guard = 0; guard < 200; guard++) {
    const m = out.match(re);
    if (!m || m.index == null) break;
    const brace = m.index + m[0].length - 1;
    const g = readBrace(out, brace);
    if (!g) break;
    out = out.slice(0, m.index) + g[0] + out.slice(g[1]);
  }
  return out;
}

/** Replace every `\frac{A}{B}` / `\dfrac` / `\tfrac` / `\cfrac` with `((A)/(B))` (outermost-first, iterating over nested fractions). */
function replaceFrac(s: string): string {
  const re = /\\(?:d|t|c)?frac\s*/;
  let out = s;
  for (let guard = 0; guard < 500; guard++) {
    const m = out.match(re);
    if (!m || m.index == null) break;
    let i = m.index + m[0].length;
    while (out[i] === " ") i++;
    const a = readBrace(out, i);
    if (!a) break;
    let j = a[1];
    while (out[j] === " ") j++;
    const b = readBrace(out, j);
    if (!b) break;
    out = out.slice(0, m.index) + `((${a[0]})/(${b[0]}))` + out.slice(b[1]);
  }
  return out;
}

/** `\sqrt{A}` → `sqrt(A)`, `\sqrt[n]{A}` → `((A)^(1/(n)))`. */
function replaceSqrt(s: string): string {
  const re = /\\sqrt\s*(\[)?/;
  let out = s;
  for (let guard = 0; guard < 500; guard++) {
    const m = out.match(re);
    if (!m || m.index == null) break;
    let i = m.index + m[0].length;
    let nth: string | null = null;
    if (m[1] === "[") {
      const close = out.indexOf("]", i);
      if (close < 0) break;
      nth = out.slice(i, close);
      i = close + 1;
    }
    while (out[i] === " ") i++;
    const a = readBrace(out, i);
    if (!a) break;
    // Cube root maps to cbrt() so it stays real for negative inputs; other roots
    // become a fractional power (real only where the base is non-negative).
    const repl =
      nth == null ? `sqrt(${a[0]})` : nth.trim() === "3" ? `cbrt(${a[0]})` : `((${a[0]})^(1/(${nth})))`;
    out = out.slice(0, m.index) + repl + out.slice(a[1]);
  }
  return out;
}

/** `^{A}` → `^(A)` (single-token exponents like `^2` are left for the parser). */
function replaceSupBraces(s: string): string {
  let out = s;
  for (let guard = 0; guard < 500; guard++) {
    const idx = out.indexOf("^{");
    if (idx < 0) break;
    const a = readBrace(out, idx + 1);
    if (!a) break;
    out = out.slice(0, idx) + "^(" + a[0] + ")" + out.slice(a[1]);
  }
  return out;
}

/** Paired `|…|` → `abs(…)`; returns the input unchanged if the bars don't pair up. */
function replacePipes(s: string): string {
  if (!s.includes("|")) return s;
  let out = "";
  let open = false;
  for (const ch of s) {
    if (ch === "|") {
      out += open ? ")" : "abs(";
      open = !open;
    } else out += ch;
  }
  return open ? s : out;
}

/**
 * Convert a single (already `=`-resolved) LaTeX side into the infix dialect.
 * Ordering matters: structural rewrites (frac/sqrt/sup) run before the flat
 * macro pass so their brace contents survive.
 */
function toInfix(side: string): string {
  let s = side;
  // spacing macros
  s = s.replace(/\\[,;:!]/g, "").replace(/\\ /g, " ").replace(/~/g, " ");
  // delimiters that carry their own bar/bracket
  s = s.replace(/\\left\|/g, "|").replace(/\\right\|/g, "|").replace(/\\lvert/g, "|").replace(/\\rvert/g, "|");
  s = s.replace(/\\lfloor/g, "floor(").replace(/\\rfloor/g, ")").replace(/\\lceil/g, "ceil(").replace(/\\rceil/g, ")");
  // log with a base subscript → expr.ts's log2 / log10 (before the bare \log macro)
  s = s.replace(/\\log_\{?10\}?/g, "log10").replace(/\\log_\{?2\}?/g, "log2");
  s = unwrapText(s);
  s = replaceFrac(s);
  s = replaceSqrt(s);
  s = replaceSupBraces(s);
  s = replacePipes(s);
  // named commands → infix (unknown \commands are left intact so validation rejects them)
  s = s.replace(/\\([a-zA-Z]+)/g, (whole, name: string) => (name in MACROS ? MACROS[name] : whole));
  // any leftover braces were plain grouping
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");
  return s.trim();
}

/** True when `side` is just an output name like `y`, `f(x)`, `r`, `g(t)`. */
function isOutputVar(side: string): boolean {
  return /^[a-zA-Z]\s*(\(\s*[a-zA-Z]\s*\)\s*)?$/.test(side.trim());
}

/** Does the expression reference a standalone `y` (i.e. it's an implicit relation, not y = f(x))? */
function mentionsY(s: string): boolean {
  return /(^|[^a-zA-Z])y([^a-zA-Z]|$)/.test(s);
}

export interface PlottableExpr {
  /** Infix expression sampled with the variable `x`. */
  expr: string;
  /** The independent variable as written in the source (informational). */
  variable: "x" | "t";
}

/**
 * Translate a display formula's LaTeX into a plottable `y = f(x)` expression, or
 * `null` when it isn't a single-variable function of x (or t). The returned
 * `expr` always validates against `["x"]`, so callers can hand it straight to a
 * graph `function` shape.
 */
export function latexToExpr(latex: string): PlottableExpr | null {
  if (!latex || typeof latex !== "string") return null;
  const cleaned = stripDelimiters(latex);

  // Resolve `y = f(x)` framing down to a single expression.
  let side = cleaned;
  const eqCount = (cleaned.match(/=/g) ?? []).length;
  if (eqCount === 1) {
    const [lhs, rhs] = cleaned.split("=");
    if (isOutputVar(lhs)) side = rhs;
    else if (isOutputVar(rhs)) side = lhs;
    else if (mentionsY(cleaned)) return null; // implicit relation (e.g. x^2 + y^2 = 1)
    else side = rhs;
  } else if (eqCount > 1) {
    return null; // ambiguous chained equation
  }

  const infix = toInfix(side);
  if (!infix) return null;

  // The graph block samples with `x` in rect coords; accept `t` by renaming it.
  if (isValidExpr(infix, ["x"])) return { expr: infix, variable: "x" };
  if (isValidExpr(infix, ["t"])) {
    // Rename the sole variable `t` → `x`, matching whole identifier runs so
    // `2t`/`t*t` rename fully while `tan`/`sqrt`/`atan2` are left alone.
    const asX = infix.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (id) => (id === "t" ? "x" : id));
    if (isValidExpr(asX, ["x"])) return { expr: asX, variable: "t" };
  }
  return null;
}
