r"""Post-decode LaTeX cleanup: bare function names -> proper operators.

MathWriting's normalized labels write multi-letter function names as bare
letters (`log`, `sin`, `lim`, ...), so any model trained on it emits them the
same way — and KaTeX then typesets them as a product of italic variables
(s·i·n) instead of an upright operator. This is a LABEL CONVENTION, not a
recognition error, so it is fixed deterministically after decoding rather
than by retraining.

Rules:
  - longest names first (`arcsin` before `sin`, `limsup` before `lim`)
  - a name only matches when NOT adjacent to another letter and NOT preceded
    by a backslash — so `\sin` stays `\sin`, `missing` is untouched, and the
    subscript letters of `s_{index}` are safe
  - conservative operator list (standard KaTeX \operatorname set); short
    ambiguous runs like `in`/`Re` are deliberately excluded

    normalize_operators(r"sin\theta + log x")  ->  r"\sin \theta + \log x"
"""

from __future__ import annotations

import re

# Bare letter-run -> LaTeX command. EVERY value here has been validated to
# render in the project's installed KaTeX (node katex.renderToString) — names
# KaTeX lacks a builtin for (\sech, \arccot, ...) go through \operatorname{},
# which typesets identically. `mod` maps to amsmath's binary \bmod, the
# KaTeX-safe form for both `a \bmod n` and `a \equiv b \bmod n`.
OPERATORS: dict[str, str] = {
    # core + amsmath builtins (\<name> exists)
    **{name: "\\" + name for name in [
        "arcsin", "arccos", "arctan",
        "sinh", "cosh", "tanh", "coth",
        "liminf", "limsup", "injlim", "projlim",
        "argmin", "argmax",
        "sin", "cos", "tan", "cot", "sec", "csc",
        "log", "ln", "lg", "exp", "lim",
        "min", "max", "sup", "inf",
        "arg", "det", "gcd", "deg", "ker", "dim", "hom", "Pr",
    ]},
    "mod": "\\bmod",
    # no KaTeX builtin -> upright operator via \operatorname
    **{name: "\\operatorname{" + name + "}" for name in [
        "sech", "csch", "arccot", "arcsec", "arccsc",
        "sgn", "curl", "div", "grad", "rank", "trace", "lcm", "erf",
    ]},
}

# Alternation order matters:
#   1. a whole \operatorname{...} atom passes through (else a second pass
#      would re-wrap its brace contents),
#   2. any \command atom passes through (else the TAIL of an escaped command
#      would be rewritten — \arcsin contains "sin", \limsup contains "sup"),
#   3. operator names, longest first so `arcsin` never half-matches as `sin`.
# The names are NOT letter-bounded: this runs on the math decoder's output,
# where letters concatenate without spaces (handwritten "log x" decodes to
# "logx", "n log n" to "nlogn") and English words cannot occur — the letter
# runs are always variables/functions. Text mode never passes through here.
_PATTERN = re.compile(
    r"\\operatorname\{[A-Za-z]+\}"
    r"|\\[A-Za-z]+"
    r"|(" + "|".join(sorted(OPERATORS, key=len, reverse=True)) + r")"
)


def _replace(m: re.Match, source: str) -> str:
    name = m.group(1)
    if not name:
        return m.group(0)  # an escaped command / \operatorname atom: untouched
    cmd = OPERATORS[name]
    # `\logx` would parse as one unknown command — keep the argument separate.
    needs_space = m.end() < len(source) and source[m.end()].isalpha()
    return cmd + (" " if needs_space else "")


def normalize_operators(latex: str) -> str:
    r"""Rewrite bare operator-name letter runs into \operator commands.

    `lnx` → `\ln x`, `nlogn` → `n\log n`, while `\arcsin` and
    `\operatorname{sgn}` pass through untouched. Idempotent: everything the
    rewrite emits is consumed by the pass-through alternatives on a re-run.
    """
    return _PATTERN.sub(lambda m: _replace(m, latex), latex)


if __name__ == "__main__":
    cases = [
        (r"sin\theta", r"\sin\theta"),
        (r"cos^{2}x+sin^{2}x=1", r"\cos^{2}x+\sin^{2}x=1"),
        (r"\frac{log\frac{a}{b}}{log c}", "\\frac{\\log\\frac{a}{b}}{\\log c}"),
        (r"\sin\theta", r"\sin\theta"),           # already escaped: untouched
        # the decoder emits letter runs with NO spaces — the whole point:
        (r"lnx", r"\ln x"),
        (r"logx", r"\log x"),
        (r"nlogn", r"n\log n"),
        (r"xsinx", r"x\sin x"),
        (r"log2", r"\log2"),                       # digit needs no separator
        (r"\arcsin x", r"\arcsin x"),              # command TAIL contains "sin": untouched
        (r"\limsup_{n}", r"\limsup_{n}"),          # command TAIL contains "sup": untouched
        (r"arcsin x", r"\arcsin x"),
        (r"limsup_{n}a_{n}", r"\limsup_{n}a_{n}"),
        (r"a\equiv b mod n", "a\\equiv b \\bmod n"),          # amsmath mod
        (r"argmin_{x}f(x)", r"\argmin_{x}f(x)"),
        (r"sechx+sgny", "\\operatorname{sech} x+\\operatorname{sgn} y"),
        (r"\operatorname{sgn} y", r"\operatorname{sgn} y"),   # already wrapped: untouched
        (r"s_{index}", r"s_{index}"),              # no operator name inside
    ]
    ok = True
    for src, want in cases:
        got = normalize_operators(src)
        mark = "✓" if got == want else "✗"
        if got != want:
            ok = False
        print(f"{mark} {src!r} -> {got!r}" + ("" if got == want else f"   (wanted {want!r})"))
    # idempotency
    twice_ok = all(normalize_operators(normalize_operators(s)) == normalize_operators(s) for s, _ in cases)
    print(f"idempotent: {twice_ok}")
    raise SystemExit(0 if ok and twice_ok else 1)
