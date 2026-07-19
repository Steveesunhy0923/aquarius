r"""Post-decode chemistry interpretation: decoder LaTeX -> mhchem source.

Chem mode reuses the stroke->LaTeX decoder (handwritten chemistry IS letters,
digits, sub/superscripts and arrows — all in the MathWriting vocabulary) and
then reinterprets the decoded expression AS CHEMISTRY: `2H_{2}+O_{2}\rightarrow
2H_{2}O` becomes the mhchem source `2H2 + O2 -> 2H2O`, which the server wraps
as `\ce{...}` — the exact storage form of the app's chemistry input system
(lib/blocks/chem.ts). This mirrors latex_normalize.py: a deterministic
serve-time layer, applied INSTEAD of operator normalization (chem letter runs
are element symbols, not `\sin`).

Conversion is conservative: anything mhchem cannot express (\sqrt, matrices,
unknown commands) makes `latex_to_ce` return None and the caller falls back to
plain math LaTeX — chem mode never corrupts a result it does not understand.

Rules (each output form validated against the installed KaTeX + mhchem):
  - digit subscripts after an element/): `H_{2}O` -> `H2O` (mhchem auto-subscripts)
  - variable subscripts:                 `C_{n}`  -> `C_{$n$}` (mhchem math escape)
  - charges:      `SO_{4}^{2-}` -> `SO4^2-`;  `Na^{+}` -> `Na+`
  - isotopes:     `^{235}_{92}U` -> `^{235}_{92}U` (native mhchem form)
  - arrows:       \rightarrow -> `->`, \rightleftharpoons -> `<=>`, ...
  - `+` BETWEEN species is spaced (`A + B`); `-` stays tight (single bond)
  - hydrates \cdot -> ` * `; \equiv -> `#` (triple bond); \frac{1}{2} -> `1/2`
  - Greek letters ride mhchem's `$...$` math escape
"""

from __future__ import annotations

import re

from .latex_tokenizer import tokenize

# Reaction/resonance arrows: decoder command -> mhchem arrow.
_ARROWS = {
    "\\rightarrow": "->",
    "\\longrightarrow": "->",
    "\\Rightarrow": "->",
    "\\hookrightarrow": "->",
    "\\leftarrow": "<-",
    "\\rightleftharpoons": "<=>",
    "\\leftrightarrow": "<->",
    "\\Leftrightarrow": "<->",
}

# TeX spacing atoms -> a plain space in mhchem source.
_SPACES = {"\\;", "\\,", "\\:", "\\!", "\\ ", "\\quad", "\\qquad", "\\enspace"}

# Greek letters legal in chemistry context (α-particle, Δ, μ-bridges, ...);
# emitted through mhchem's $...$ math escape.
_GREEK = {
    "\\alpha", "\\beta", "\\gamma", "\\delta", "\\Delta", "\\lambda", "\\mu",
    "\\nu", "\\pi", "\\sigma", "\\omega", "\\Omega", "\\epsilon", "\\varepsilon",
    "\\eta", "\\theta", "\\rho", "\\tau", "\\phi", "\\chi", "\\psi",
}

_DIGITS = re.compile(r"^\d+$")
_CHARGE = re.compile(r"^\d*[+-]$")  # 2-, 3+, +, -
_SUBMATH = re.compile(r"^[A-Za-z0-9+\-]+$")  # what may ride _{$...$} / ^{$...$}


def _read_group(toks: list[str], i: int) -> tuple[list[str], int] | None:
    """Token(s) forming the argument at position i: a brace group's inner
    tokens, or the single token. None on an unterminated group."""
    if i >= len(toks):
        return None
    if toks[i] != "{":
        return [toks[i]], i + 1
    depth, j = 1, i + 1
    while j < len(toks):
        if toks[j] == "{":
            depth += 1
        elif toks[j] == "}":
            depth -= 1
            if depth == 0:
                return toks[i + 1 : j], j + 1
        j += 1
    return None


def _is_base(ch: str) -> bool:
    """Can a subscript/charge attach here in mhchem? (element letter, closing
    bracket of a group/complex, or a digit). '' (expression start) is NOT a
    base — `'' in ")]"` would be True by substring semantics, which turned a
    leading `_{92}` into a bare coefficient `92`."""
    return bool(ch) and (ch.isalnum() or ch in ")]")


def latex_to_ce(latex: str) -> str | None:
    """Decoded math LaTeX -> mhchem source, or None when not expressible.

    The output is meant for `\\ce{...}`: `latex_to_ce(r"2H_{2}+O_{2}\\rightarrow
    2H_{2}O")` -> `"2H2 + O2 -> 2H2O"`.
    """
    toks = tokenize(latex)
    out: list[str] = []

    def last_char() -> str:
        for piece in reversed(out):
            s = piece.rstrip()
            if s:
                return s[-1]
        return ""

    i, n = 0, len(toks)
    while i < n:
        t = toks[i]

        if t in _ARROWS:
            out.append(f" {_ARROWS[t]} ")
            i += 1
        elif t in _SPACES:
            out.append(" ")
            i += 1
        elif t in _GREEK:
            out.append(f"${t}$")
            i += 1
        elif t == "\\cdot":
            out.append(" * ")
            i += 1
        elif t == "\\equiv":
            out.append("#")
            i += 1
        elif t == "\\uparrow":
            out.append(" ^")
            i += 1
        elif t == "\\downarrow":
            out.append(" v")
            i += 1
        elif t in ("\\left", "\\right"):
            i += 1  # the delimiter itself follows as its own token
        elif t == "\\frac":
            num = _read_group(toks, i + 1)
            den = _read_group(toks, num[1]) if num else None
            if not num or not den:
                return None
            a, b = "".join(num[0]), "".join(den[0])
            if not (_DIGITS.match(a) and _DIGITS.match(b)):
                return None  # symbolic fraction — not a stoichiometric coefficient
            out.append(f"{a}/{b} ")
            i = den[1]
        elif t == "_":
            grp = _read_group(toks, i + 1)
            if not grp:
                return None
            content = "".join(grp[0])
            j = grp[1]
            # Subscript-FIRST isotope prefix: _{92}^{235}U (atomic number
            # written before the mass number) — keep mhchem's native stacked
            # form, mirroring the ^-first branch below.
            if _DIGITS.match(content) and not _is_base(last_char()) and j < n and toks[j] == "^":
                sup = _read_group(toks, j + 1)
                if (
                    sup
                    and _DIGITS.match("".join(sup[0]))
                    and sup[1] < n
                    and toks[sup[1]].isalpha()
                ):
                    out.append(f"_{{{content}}}^{{{''.join(sup[0])}}}")
                    i = sup[1]
                    continue
            if _DIGITS.match(content) and _is_base(last_char()):
                out.append(content)  # H_{2} -> H2: mhchem auto-subscripts
            elif _SUBMATH.match(content):
                out.append(f"_{{${content}$}}")  # C_{n} -> C_{$n$}
            else:
                return None
            i = j
        elif t == "^":
            grp = _read_group(toks, i + 1)
            if not grp:
                return None
            content = "".join(grp[0])
            j = grp[1]
            # Isotope prefix: ^{a}(_{b})?Element — keep mhchem's native form.
            if _DIGITS.match(content):
                if j < n and toks[j] == "_":
                    sub = _read_group(toks, j + 1)
                    if (
                        sub
                        and _DIGITS.match("".join(sub[0]))
                        and sub[1] < n
                        and toks[sub[1]].isalpha()
                    ):
                        out.append(f"^{{{content}}}_{{{''.join(sub[0])}}}")
                        i = sub[1]
                        continue
                if j < n and toks[j].isalpha():
                    out.append(f"^{{{content}}}")  # ^{14}C mass number
                    i = j
                    continue
            if _CHARGE.match(content) and _is_base(last_char()):
                # Charge: lone sign rides directly (Na+), digit+sign via ^ (SO4^2-).
                out.append(content if content in "+-" else f"^{content}")
            elif _DIGITS.match(content):
                out.append(f"^{{{content}}}")
            elif _SUBMATH.match(content):
                out.append(f"^{{${content}$}}")
            else:
                return None
            i = j
        elif t == "+":
            out.append(" + ")  # between species; charges never reach here
            i += 1
        elif t == "{":
            i += 1  # transparent grouping — contents process at this level
        elif t == "}":
            i += 1
        elif len(t) == 1 and (t.isalnum() or t in "()[]=-./'"):
            out.append(t)
            i += 1
        else:
            return None  # \sqrt, &, unknown commands, ... — not chemistry

    src = re.sub(r"\s+", " ", "".join(out)).strip()
    return src or None


if __name__ == "__main__":
    cases = [
        (r"2H_{2}+O_{2}\rightarrow 2H_{2}O", "2H2 + O2 -> 2H2O"),
        (r"SO_{4}^{2-}", "SO4^2-"),
        (r"Fe^{3+}", "Fe^3+"),
        (r"Na^{+}+Cl^{-}\rightarrow NaCl", "Na+ + Cl- -> NaCl"),
        (r"CuSO_{4}\cdot 5H_{2}O", "CuSO4 * 5H2O"),
        (r"Ca(OH)_{2}", "Ca(OH)2"),
        (r"[Fe(CN)_{6}]^{3-}", "[Fe(CN)6]^3-"),
        (r"^{235}_{92}U", "^{235}_{92}U"),
        (r"^{14}C", "^{14}C"),
        (r"2H_{2}O\rightleftharpoons H_{3}O^{+}+OH^{-}", "2H2O <=> H3O+ + OH-"),
        (r"\frac{1}{2}O_{2}", "1/2 O2"),
        (r"CH_{3}-CH_{3}", "CH3-CH3"),
        (r"CH_{2}=CH_{2}", "CH2=CH2"),
        (r"N\equiv N", "N#N"),
        (r"2HCl(aq)", "2HCl(aq)"),
        (r"C_{n}H_{2n+2}", "C_{$n$}H_{$2n+2$}"),
        (r"X\longrightarrow Y", "X -> Y"),
        (r"A\leftrightarrow B", "A <-> B"),
        (r"\Delta H", "$\\Delta$H"),
        (r"x^{2}", "x^{2}"),  # bare-digit superscript, no element context
        (r"H_2O", "H2O"),  # unbraced single-token subscript
        # subscript with no attachable base must NOT become a bare coefficient
        (r"_{92}^{235}U", "_{92}^{235}U"),  # subscript-first isotope stack
        (r"_{3}He", "_{$3$}He"),  # lone leading subscript: math escape, not "3He"
        (r"\sqrt{x}", None),  # not chemistry -> caller falls back to math
        (r"\frac{x}{2}", None),
        (r"a&b", None),
    ]
    ok = True
    for src, want in cases:
        got = latex_to_ce(src)
        mark = "✓" if got == want else "✗"
        if got != want:
            ok = False
        print(f"{mark} {src!r} -> {got!r}" + ("" if got == want else f"   (wanted {want!r})"))
    raise SystemExit(0 if ok else 1)
