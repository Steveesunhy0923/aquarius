/**
 * A tiny, dependency-free math-expression evaluator for the graph block's
 * "function" shape (e.g. `sin(x)`, `2*x^2 - 1`, `r = 1 + cos(theta)`).
 *
 * Why hand-rolled instead of `eval`/`new Function`: user-typed strings are
 * untrusted document content, and `eval` would expose the whole JS scope. This
 * parses a small, fixed grammar (numbers, named variables, a whitelist of
 * functions/constants, the usual operators) into a closure tree once, so
 * sampling the curve over hundreds of points is just cheap function calls.
 *
 * Grammar (recursive descent, standard precedence):
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := power (('*' | '/' | implicit) power)*
 *   power   := unary ('^' power)?            // right-associative
 *   unary   := ('+' | '-') unary | primary
 *   primary := number | ident '(' args ')' | ident | '(' expr ')'
 *
 * Implicit multiplication ("2x", "3sin(x)", "(x+1)(x-1)") is supported between a
 * value-producing token and the start of another factor.
 */

export type Scope = Record<string, number>;
export type CompiledExpr = (scope: Scope) => number;

export interface CompileResult {
  /** Non-null when parsing succeeded. Call with a scope of variable values. */
  fn: CompiledExpr | null;
  /** Human-readable parse error, or null on success. */
  error: string | null;
}

/** Math constants available unqualified inside an expression. */
const CONSTANTS: Scope = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

/** Unary functions usable as `name(arg)`. */
const FUNCTIONS1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log, // natural log, matching TeX/most CAS conventions
  log2: Math.log2,
  log10: Math.log10,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  cot: (x) => 1 / Math.tan(x),
};

/** Binary functions usable as `name(a, b)`. */
const FUNCTIONS2: Record<string, (a: number, b: number) => number> = {
  pow: Math.pow,
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => ((a % b) + b) % b,
  log: Math.log, // log(value, base) — overloads the unary form
};

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      // scientific notation: 1e-3, 2.5E6
      if (j < n && (src[j] === "e" || src[j] === "E")) {
        let k = j + 1;
        if (k < n && (src[k] === "+" || src[k] === "-")) k++;
        if (k < n && src[k] >= "0" && src[k] <= "9") {
          while (k < n && src[k] >= "0" && src[k] <= "9") k++;
          j = k;
        }
      }
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`bad number "${src.slice(i, j)}"`);
      toks.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ t: ")" });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ t: "," });
      i++;
      continue;
    }
    if ("+-*/^".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  return toks;
}

// ─── Parser (recursive descent → closure tree) ────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[], private readonly vars: Set<string>) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private next(): Tok | undefined {
    return this.toks[this.pos++];
  }

  parse(): CompiledExpr {
    const fn = this.expr();
    if (this.pos !== this.toks.length) throw new Error("unexpected trailing input");
    return fn;
  }

  private expr(): CompiledExpr {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
        this.next();
        const right = this.term();
        const op = t.v;
        const l = left;
        left = op === "+" ? (s) => l(s) + right(s) : (s) => l(s) - right(s);
      } else break;
    }
    return left;
  }

  private term(): CompiledExpr {
    let left = this.factor();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        this.next();
        const right = this.factor();
        const l = left;
        left = t.v === "*" ? (s) => l(s) * right(s) : (s) => l(s) / right(s);
      } else if (t && (t.t === "num" || t.t === "id" || t.t === "(")) {
        // implicit multiplication: "2x", "3sin(x)", "(x+1)(x-1)"
        const right = this.factor();
        const l = left;
        left = (s) => l(s) * right(s);
      } else break;
    }
    return left;
  }

  // Unary +/- binds LOOSER than '^', so "-x^2" parses as "-(x^2)".
  private factor(): CompiledExpr {
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
      this.next();
      const operand = this.factor();
      return t.v === "-" ? (s) => -operand(s) : operand;
    }
    return this.power();
  }

  private power(): CompiledExpr {
    const base = this.primary();
    const t = this.peek();
    if (t && t.t === "op" && t.v === "^") {
      this.next();
      const exp = this.factor(); // right-assoc; exponent may be signed (2^-3)
      return (s) => Math.pow(base(s), exp(s));
    }
    return base;
  }

  private primary(): CompiledExpr {
    const t = this.next();
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num") {
      const v = t.v;
      return () => v;
    }
    if (t.t === "(") {
      const inner = this.expr();
      const close = this.next();
      if (!close || close.t !== ")") throw new Error("missing ')'");
      return inner;
    }
    if (t.t === "id") {
      const name = t.v;
      const after = this.peek();
      if (after && after.t === "(") {
        // function call
        this.next();
        const args: CompiledExpr[] = [];
        if (this.peek()?.t !== ")") {
          args.push(this.expr());
          while (this.peek()?.t === ",") {
            this.next();
            args.push(this.expr());
          }
        }
        const close = this.next();
        if (!close || close.t !== ")") throw new Error("missing ')'");
        return this.makeCall(name, args);
      }
      // constant or variable reference
      if (name in CONSTANTS) {
        const v = CONSTANTS[name];
        return () => v;
      }
      if (this.vars.has(name)) {
        return (s) => s[name];
      }
      throw new Error(`unknown name "${name}"`);
    }
    throw new Error(`unexpected token`);
  }

  private makeCall(name: string, args: CompiledExpr[]): CompiledExpr {
    if (args.length === 1 && name in FUNCTIONS1) {
      const f = FUNCTIONS1[name];
      const a = args[0];
      return (s) => f(a(s));
    }
    if (args.length === 2 && name in FUNCTIONS2) {
      const f = FUNCTIONS2[name];
      const a = args[0];
      const b = args[1];
      return (s) => f(a(s), b(s));
    }
    throw new Error(`unknown function "${name}" with ${args.length} arg(s)`);
  }
}

/**
 * Compile an expression string into a fast evaluator. `vars` lists the free
 * variable names the caller will supply at eval time (e.g. `["x"]` for y=f(x),
 * or `["theta"]` for a polar curve). Returns `{ fn: null, error }` on a parse
 * error so the UI can show feedback without throwing.
 */
export function compileExpr(src: string, vars: string[]): CompileResult {
  try {
    const toks = tokenize(src);
    if (toks.length === 0) return { fn: null, error: "empty expression" };
    const parser = new Parser(toks, new Set(vars));
    const fn = parser.parse();
    return { fn, error: null };
  } catch (e) {
    return { fn: null, error: e instanceof Error ? e.message : "parse error" };
  }
}

/** Convenience: compile and immediately report whether `src` is valid. */
export function isValidExpr(src: string, vars: string[]): boolean {
  return compileExpr(src, vars).error === null;
}
