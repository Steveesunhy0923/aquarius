r"""Tokenizing a MIXED reading — prose with inline math — for the phase-2 decoder.

The existing tokenizer was built for MathWriting labels, where whitespace is
noise: `_TOKEN_RE` matches non-space runs and everything between them is
discarded. That is correct for `\frac{x}{2}` and fatal for a sentence —
`let \(x\) be the root` tokenizes to `l e t \( x \) b e t h e r o o t`, and
"be the root" cannot be recovered from "betheroot".

So a word separator is injected before tokenizing and removed after. It is
spelled as a LaTeX control word (`\wordsep`) for one reason: the tokenizer
already lexes `\[a-zA-Z]+` as a single token, so the separator survives a round
trip with NO change to `latex_tokenizer`, which the shipped math checkpoints
depend on byte-for-byte.

Round-tripping is a hard requirement, not a nicety: this string is the training
target, and a target that cannot be decoded back to what the user wrote would
teach the model to emit something unreadable. `encode`/`decode` are inverses on
every source `mixed_synth` produces, which the self-test checks over the corpus.
"""

from __future__ import annotations

import re

from .latex_tokenizer import tokenize

SEP = "\\wordsep"

# `\(` and `\)` are already single tokens for the lexer; the separator only ever
# needs to appear BETWEEN things, never inside a formula.
_SPACES = re.compile(r"[ \t]+")


def encode(source: str) -> list[str]:
    """Mixed source -> tokens, word boundaries preserved."""
    # A callable replacement, not a template: `re.sub` reads `\w` in a template
    # string as an escape and raises "bad escape \w" on the separator.
    return tokenize(_SPACES.sub(lambda _m: f" {SEP} ", source.strip()))


def decode(tokens: list[str]) -> str:
    """Tokens -> mixed source. Inverse of `encode` on well-formed input."""
    out: list[str] = []
    for tok in tokens:
        if tok == SEP:
            out.append(" ")
        else:
            out.append(tok)
    # `\(`/`\)` are their own tokens and must not glue to their neighbours in a
    # way that changes them; plain concatenation is right because every other
    # token is exactly the character(s) it stands for.
    return "".join(out).strip()


def vocab_tokens(sources: list[str]) -> list[str]:
    """Every distinct token the corpus needs, in first-seen order."""
    seen: dict[str, None] = {}
    for src in sources:
        for tok in encode(src):
            seen.setdefault(tok, None)
    return list(seen)


if __name__ == "__main__":
    import json
    from pathlib import Path

    failures = []

    def check(name: str, ok: bool) -> None:
        print(("✓ " if ok else "✗ ") + name)
        if not ok:
            failures.append(name)

    cases = [
        "let \\(x^{2}\\) be the root",
        "if \\(a=b\\) then \\(c\\)",
        "more or area height",
        "\\(\\tilde{B}_{n}\\)",
        "we have \\(n+z^{2}\\) for all is",
    ]
    ok = all(decode(encode(s)) == s for s in cases)
    check("M1  encode/decode round-trips the hand cases", ok)
    for s in cases:
        if decode(encode(s)) != s:
            print(f"     {s!r} -> {decode(encode(s))!r}")

    check("M2  the separator survives as one token", encode("a b")[1] == SEP)
    check("M3  prose keeps its word boundaries",
          decode(encode("be the root")) == "be the root")
    check("M4  no separator inside a formula",
          SEP not in encode("\\(x^{2}\\)"))

    corpus = Path("data/mixed/eval.jsonl")
    if corpus.exists():
        srcs = [json.loads(l)["source"] for l in corpus.read_text().splitlines() if l.strip()]
        bad = [s for s in srcs if decode(encode(s)) != s]
        check(f"M5  round-trips all {len(srcs)} corpus sources", not bad)
        for s in bad[:3]:
            print(f"     {s!r}\n  -> {decode(encode(s))!r}")
        toks = vocab_tokens(srcs)
        check(f"M6  corpus vocabulary is small ({len(toks)} tokens)", 0 < len(toks) < 500)

    print(f"cases passed: {6 - len(failures)} / failed: {len(failures)}")
    raise SystemExit(1 if failures else 0)
