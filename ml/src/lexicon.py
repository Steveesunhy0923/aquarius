r"""Is this token an English word?

The single most discriminative piece of evidence separating a prose run from a
formula run, and the one the router never had: `PQ`, `nRT`, `xy` and `mc` are
not words, `let`, `be` and `follows` are. The router could only ask whether a
token was ALPHABETIC, which both groups are, which is why it read every
letters-only formula as prose (99.1% of them, measured).

Two corrections to the naive "look it up in /usr/share/dict/words":

  - **the two-letter tail is noise.** web2 lists `ab`, `am`, `ar`, `hu`, `mr`,
    `od` and `si` as words; every one of them is far more likely to be two
    variables on a page of mathematics. English has about thirty genuinely
    common one- and two-letter words, so those are enumerated explicitly and
    everything else that short is treated as not-a-word.
  - **web2 holds base forms only.** `follows`, `gives`, `holds` and `implies`
    are all absent from it. Rather than materialize every inflection, the
    lookup strips regular English suffixes and retries — which also keeps the
    shipped file to the base vocabulary.

The word list is a GENERATED artifact (`ml/data/lexicon.txt`, like every other
corpus under data/): built from the host dictionary by `python -m src.lexicon
--build`. It is not the training vocabulary and must never be — a lexicon built
from the words the classifier trains on would make the feature a lookup table
for the test set. See the honesty note in `train_run_clf.py`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
LEXICON_PATH = ML_DIR / "data" / "lexicon.txt"
SYSTEM_DICTS = ("/usr/share/dict/words", "/usr/dict/words")

MIN_LEN = 3  # below this, only the explicit list below counts

#: The one- and two-letter words English actually uses. Everything else of that
#: length on a page of mathematics is variables — `PQ` is a segment, not a word.
SHORT_WORDS = frozenset(
    "a i o "
    "am an as at ax be by do go he hi id if in is it me my no of oh ok on or ox "
    "pi so to up us we"
    .split()
)

#: Regular English suffixes, longest first so `-ies` is tried before `-s`.
#: Each entry is (suffix, list of stems to try).
_SUFFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ies", ("y",)),
    ("ied", ("y",)),
    ("ing", ("", "e")),
    ("est", ("", "e")),
    ("ers", ("", "e")),
    ("es", ("", "e")),
    ("ed", ("", "e")),
    ("er", ("", "e")),
    ("ly", ("",)),
    ("s", ("",)),
)


class Lexicon:
    """A word set plus the morphology needed to use it."""

    def __init__(self, words: frozenset[str]):
        self.words = words

    def __len__(self) -> int:
        return len(self.words)

    def is_word(self, token: str) -> bool:
        """True when `token` is plausibly an English word.

        Case-insensitive: Vision returns `LET` as readily as `let`, and a page
        written in capitals is prose just the same.
        """
        t = "".join(ch for ch in token.strip().lower() if ch.isalpha())
        if not t:
            return False
        if len(t) < MIN_LEN:
            return t in SHORT_WORDS
        if t in self.words:
            return True
        for suffix, stems in _SUFFIXES:
            if not t.endswith(suffix):
                continue
            base = t[: -len(suffix)]
            if len(base) < MIN_LEN:
                continue
            for stem in stems:
                if base + stem in self.words:
                    return True
            # doubled final consonant: `stopped` -> `stop`, `running` -> `run`
            if len(base) > MIN_LEN and base[-1] == base[-2] and base[:-1] in self.words:
                return True
        return False


_CACHE: Lexicon | None = None


def load(path: Path | None = None) -> Lexicon:
    """The lexicon, built on first use and cached for the process."""
    global _CACHE
    if _CACHE is not None and path is None:
        return _CACHE
    p = path or LEXICON_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"{p} missing — build it with:  ml/.venv/bin/python -m src.lexicon --build"
        )
    words = frozenset(w.strip() for w in p.read_text(encoding="utf-8").splitlines() if w.strip())
    lex = Lexicon(words)
    if path is None:
        _CACHE = lex
    return lex


def build(out: Path | None = None) -> int:
    """Distil the host dictionary into the shipped word list."""
    src = next((Path(p) for p in SYSTEM_DICTS if Path(p).exists()), None)
    if src is None:
        raise FileNotFoundError(f"no system dictionary in {SYSTEM_DICTS}")
    words = set()
    for raw in src.read_text(encoding="utf-8", errors="ignore").splitlines():
        w = raw.strip().lower()
        # Alphabetic only: web2 carries hyphenated and apostrophised entries
        # that no OCR token will ever match exactly.
        if len(w) >= MIN_LEN and w.isalpha() and w.isascii():
            words.add(w)
    out = out or LEXICON_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")
    return len(words)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if args.build:
        n = build(Path(args.out) if args.out else None)
        print(f"wrote {n} words -> {args.out or LEXICON_PATH}")
        return 0

    lex = load()
    print(f"{len(lex)} words")
    cases = [
        # (token, expected)
        ("let", True), ("be", True), ("the", True), ("follows", True),
        ("implies", True), ("gives", True), ("holds", True), ("running", True),
        ("PQ", False), ("AB", False), ("nRT", False), ("xy", False),
        ("mc", False), ("lnx", False), ("aR", False), ("hu", False),
    ]
    bad = [(t, e, lex.is_word(t)) for t, e in cases if lex.is_word(t) != e]
    for t, e, g in bad:
        print(f"  MISMATCH {t!r}: expected {e}, got {g}")
    print(f"self-check: {len(cases) - len(bad)}/{len(cases)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
