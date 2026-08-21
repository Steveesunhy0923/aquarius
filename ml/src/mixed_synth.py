r"""Synthesize MIXED handwriting: prose and formulas on one line, with per-run
ground truth.

No public dataset has this. MathWriting is isolated expressions with no prose;
IAM-OnDB is prose with no math; neither has a line where the two meet, which is
exactly the case `unified.py` has to get right and the case it was tuned on with
a single 51-stroke fixture. This module builds that corpus by STITCHING:

  - **formula runs are REAL ink** — a whole MathWriting expression, dropped in
    unmodified apart from a similarity transform (uniform scale + translate) so
    its x-height and baseline match the line it is joining. Stroke shape, order
    and relative geometry are untouched, so anything the segmenter reads off a
    formula is read off real handwriting.
  - **prose runs are STITCHED from real ink** — one MathWriting *symbol* sample
    per letter, laid out with `chem_synth`'s engine, which already knows that
    `acemnorsuvwxz` are x-height, `gpqy` descend and the rest ascend.

That asymmetry is deliberate and it is the corpus's main limitation: stitched
words are printed and evenly spaced, so they are EASIER for Apple Vision than
real cursive. Every number this corpus produces about text is therefore an
upper bound on the text side. It is still the right corpus for the question at
hand, because the failures being chased are structural (a letters-only formula
has no math evidence; a two-letter word next to a formula gets swallowed) and
those reproduce under clean printing just as they do under cursive.

Ground truth is recorded per STROKE, not per run: run boundaries are a choice
the pipeline makes (`merge_runs` coalesces neighbours), so the only comparison
that is fair across implementations is "which strokes did you call math".

Output JSONL, one line per sample:

    {"id", "source", "runs": [{"kind","label","strokes":[i,...]}, ...],
     "strokes": [{"x","y","t"}, ...], "xh": float, "template": str}

`source` is the assembled reading in the SAME form `unified.assemble_source`
emits — prose with `\( ... \)` inline math — so it doubles as the seq2seq target
for a mixed-aware decoder (phase 2).

Deterministic: same seed, byte-identical output; ids are `mixed-<seed>-<n>`.

CLI:
    ml/.venv/bin/python -m src.mixed_synth --out data/mixed/eval.jsonl \
        --n 300 --seed 11 --split valid
"""

from __future__ import annotations

import argparse
import json
import random
import re
from html import unescape
from pathlib import Path

import numpy as np

from .chem_synth import SymbolBank, _Layout, _layout
from .inkml import parse_inkml
from .layout import stroke_boxes, xheight
from .render import render_strokes

ML_DIR = Path(__file__).resolve().parents[1]
MW_DIR = ML_DIR / "data" / "mathwriting-2024"

_RAW_RE = re.compile(r'<annotation type="label">([^<]*)</annotation>')
_NORM_RE = re.compile(r'<annotation type="normalizedLabel">([^<]*)</annotation>')


def _label(head: str, pattern: re.Pattern) -> str:
    """Pull a label out of raw InkML text and UNESCAPE it.

    The index is built by regex over the file bytes rather than by parsing 230k
    XML documents, which is ~40x faster — but it means entity decoding is this
    function's job. `parse_inkml` goes through ElementTree and hands back
    `2\\pi a<C`; a raw regex hands back `2\\pi a&lt;C`. **5.38% of the train
    split contains one of `&lt; &gt; &amp;`**, so skipping this step silently
    teaches a decoder to emit `&lt;` where it means `<`.
    """
    m = pattern.search(head)
    return unescape(m.group(1)) if m else ""

# x-height letters get 0.65*h from chem_synth's `_spec`; every gap below is
# quoted in x-heights (the unit layout.py thresholds in) and converted with this.
XH_OF_H = 0.65

# Word gaps measured on the reference fixture were 0.70 and 0.85 xh, against a
# p50 intra-expression gap of 0.386 xh. Sampling ACROSS that boundary is the
# point: a corpus where every word gap is comfortably wide would hide the very
# ambiguity the classifier has to resolve.
WORD_GAP = (0.55, 1.35)
# Letters inside a word sit far tighter than words do.
LETTER_GAP = (0.05, 0.13)


# --------------------------------------------------------------------------
# prose
# --------------------------------------------------------------------------

# Deliberately not /usr/share/dict/words: that file is 236k entries of mostly
# archaic vocabulary, and a corpus of `zygomaticoauricularis` would measure
# Vision's dictionary rather than the segmenter. This is the vocabulary that
# actually surrounds mathematics in a notebook.
PROSE_WORDS = """
let be the is are for all any some we have has and or with if then thus so
since hence where when that this these those note assume suppose take given
consider define set put write recall observe follows holds implies gives
yields means value case both each every only such other same first next last
above below here there now also still even more less most least
root sum area mass force energy speed time rate limit bound error term line
point curve field space group ring order degree power proof lemma claim fact
result step case check test model data mean total change ratio scale unit
number function graph angle slope volume length width height depth
""".split()
# de-duplicated, order preserved: a word appearing twice would land in BOTH
# halves of `split_vocab` and quietly leak across the train/eval boundary.
PROSE_WORDS = list(dict.fromkeys(PROSE_WORDS))

# One-and two-letter words are the whole point of the text side: S2 converts any
# text run of <= 2 characters within 0.55 xh of a formula into math, and English
# function words are overwhelmingly short. They must appear at natural rate.
SHORT_WORDS = "a i is be if in of to at on no it we so or as an by do go he me my up us".split()

# {F} is a formula slot, {W} a prose word. Frames are ordinary mathematical
# English, chosen so short words land NEXT TO formulas as often as they really
# do — that adjacency is the failure mode, not an edge case.
TEMPLATES = [
    "let {F} be the {W}",
    "if {F} then {F}",
    "where {F} is the {W}",
    "we have {F} for all {W}",
    "since {F} it follows that {F}",
    "note that {F} holds",
    "the {W} of {F} is {F}",
    "assume {F} and {F}",
    "so {F} in {W}",
    "put {F} to get {F}",
    "{F} is the {W}",
    "for {F} we get {F}",
    "take {F} as {W}",
    "this gives {F}",
    "by {F} the {W} is {W}",
    "{W} {F} and {W} {F}",
    "suppose {F} with {W} {F}",
    "define {F} on {W}",
    # regression frames: the pipeline must not get WORSE on the pure cases
    "{F}",
    "{W} {W} {W} {W}",
    "{W} {W} {W} {W} {W} {W}",
]


def split_vocab(half: int | None) -> tuple[list[str], list[str]]:
    """Half the prose vocabulary, or all of it when `half` is None.

    Train and eval corpora take opposite halves so the classifier is scored on
    words it has never been fitted against. This tests the CLASSIFIER, not the
    lexicon: both halves are ordinary English and both are in the dictionary, so
    a model that has genuinely learned "dictionary word next to a formula is
    still a word" transfers, while one that memorized `let`/`be`/`the` does not.
    """
    if half is None:
        return list(PROSE_WORDS), list(SHORT_WORDS)
    return (
        [w for i, w in enumerate(PROSE_WORDS) if i % 2 == half],
        [w for i, w in enumerate(SHORT_WORDS) if i % 2 == half],
    )


def _fill(
    template: str, rng: random.Random, words: list[str], shorts: list[str]
) -> list[tuple[str, str]]:
    """Template -> the run plan: [(kind, payload)] with payload a word or "{F}"."""
    plan: list[tuple[str, str]] = []
    for token in template.split():
        if token == "{F}":
            plan.append(("math", "{F}"))
        elif token == "{W}":
            plan.append(("text", rng.choice(words)))
        else:
            # A literal in the frame ("let", "be") is only usable if it belongs
            # to this half of the vocabulary; otherwise draw a replacement, so a
            # split corpus never leaks a word across the boundary.
            plan.append(("text", token if token in words or token in shorts else rng.choice(words)))
    # sprinkle the short-word vocabulary in at a rate that keeps it adjacent to
    # formulas, which is where it is dangerous
    for i, (kind, payload) in enumerate(plan):
        if kind == "text" and len(payload) > 3 and rng.random() < 0.18:
            plan[i] = ("text", rng.choice(shorts))
    return plan


# --------------------------------------------------------------------------
# expressions
# --------------------------------------------------------------------------


class ExpressionBank:
    """Real MathWriting expressions, indexed by file and filtered to a size that
    plausibly appears INLINE in a sentence.

    The index is cached: walking 230k InkML headers takes ~40 s, and every
    caller (eval build, train build, a re-run with another seed) needs the same
    walk.
    """

    #: A formula that is nothing but letters — `PQ`, `AB`, `nRT`, `lnx`. The
    #: router has no evidence for math on these at all (no operator, no digit,
    #: no structure), so they are the sharpest test of the classifier. MathWriting
    #: has almost none (41 of 15,674 in valid, 0.26%) because it collects
    #: expressions, not the inline notation that fills a geometry or physics
    #: notebook — so they get their own stress corpus rather than being forced
    #: into the natural one, where they would distort the mix.
    LETTERS_ONLY = re.compile(r"^[A-Za-z]{2,}$")

    def __init__(
        self,
        split: str,
        *,
        max_label: int = 28,
        limit: int = 0,
        cache: Path | None = None,
        letters_only: bool = False,
    ):
        self.split = split
        src = MW_DIR / split
        cache = cache or (ML_DIR / "data" / "mixed" / f"index3_{split}.json")
        if cache.exists():
            entries = json.loads(cache.read_text())
        else:
            entries = []
            for f in sorted(src.glob("*.inkml")):
                head = f.open("rb").read(4096).decode("utf-8", "ignore")
                raw, norm = _label(head, _RAW_RE), _label(head, _NORM_RE)
                if raw or norm:
                    entries.append([f.name, raw, norm])
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(entries))
        # Two different labels, two different jobs. Size is judged on the RAW
        # label because that is what tracks visual width (`\binom{j}{m+1}` is a
        # small glyph stack), while the label carried into the corpus is the
        # NORMALIZED one, because `parse_inkml` prefers it and so every existing
        # checkpoint was trained against it. Filtering on the normalized string
        # would throw away exactly the compact notation this corpus wants.
        self.entries = [
            (src / n, norm or raw)
            for n, raw, norm in entries
            if 0 < len(raw or norm) <= max_label and (norm or raw)
        ]
        if letters_only:
            self.entries = [e for e in self.entries if self.LETTERS_ONLY.match(e[1].strip())]
        if limit:
            self.entries = self.entries[:limit]
        if not self.entries:
            raise FileNotFoundError(f"no usable expressions in {src}")
        self._cache: dict[Path, list[dict]] = {}

    def sample(self, rng: random.Random) -> tuple[list[dict], str]:
        path, label = self.entries[rng.randrange(len(self.entries))]
        strokes = self._cache.get(path)
        if strokes is None:
            strokes = [s for s in parse_inkml(path).strokes if s["x"]]
            self._cache[path] = strokes
        return strokes, label


def _baseline_of(strokes: list[dict], boxes: list, xh: float) -> float:
    """Estimate an expression's baseline as the median of its glyph bottoms.

    The median, not the max: a descender (`g`), a subscript or a fraction's
    denominator all hang below the baseline, and anchoring on the lowest ink
    would float every fraction well above the line it is joining.
    """
    bottoms = [b[3] for b in boxes if b[3] - b[1] >= 0.20 * xh]
    return float(np.median(bottoms)) if bottoms else float(np.median([b[3] for b in boxes]))


def _place_expression(
    st: _Layout, strokes: list[dict], x: float, baseline: float, h: float, rng: random.Random
) -> float:
    """Drop a real expression's ink on the line; return the new cursor x.

    Similarity transform only — one uniform scale, no shear, no per-stroke
    jitter. Anything else would edit real handwriting into something that is no
    longer evidence about real handwriting.
    """
    boxes = stroke_boxes(strokes)
    src_xh = xheight(boxes) or 1.0
    scale = (XH_OF_H * h * rng.uniform(0.94, 1.08)) / src_xh
    base_src = _baseline_of(strokes, boxes, src_xh)
    left = min(b[0] for b in boxes)

    dx = x - left * scale
    dy = baseline - base_src * scale
    for s in strokes:
        p = np.column_stack([s["x"], s["y"]]).astype(np.float64) * scale
        st.strokes.append(p + np.array([dx, dy]))
    right = max(b[2] for b in boxes)
    return right * scale + dx


# --------------------------------------------------------------------------
# a mixed line
# --------------------------------------------------------------------------


def synth_mixed(
    bank: SymbolBank,
    exprs: ExpressionBank,
    rng: random.Random,
    sample_id: str,
    template: str | None = None,
    vocab: tuple[list[str], list[str]] | None = None,
) -> dict:
    """One mixed line: strokes + per-run ground truth + assembled source."""
    template = template or rng.choice(TEMPLATES)
    words, shorts = vocab or (list(PROSE_WORDS), list(SHORT_WORDS))
    plan = _fill(template, rng, words, shorts)
    h = rng.uniform(60.0, 110.0)
    xh = XH_OF_H * h
    st = _Layout(bank=bank, rng=rng, gap=rng.uniform(*LETTER_GAP))

    runs: list[dict] = []
    parts: list[str] = []
    x, baseline = 0.0, 0.0
    for i, (kind, payload) in enumerate(plan):
        if i:
            x += rng.uniform(*WORD_GAP) * xh
        # each run drifts a little off the shared baseline, as a written line does
        base = baseline + rng.uniform(-0.06, 0.06) * xh
        start = len(st.strokes)
        if kind == "math":
            ink, label = exprs.sample(rng)
            x = _place_expression(st, ink, x, base, h, rng)
            parts.append(f"\\({label}\\)")
        else:
            label = payload
            x = _layout(st, list(payload), x, base, h)
            parts.append(label)
        if len(st.strokes) == start:  # a glyph the bank could not draw
            continue
        runs.append({"kind": kind, "label": label, "strokes": list(range(start, len(st.strokes)))})

    if not runs:
        raise ValueError(f"nothing laid out for {template!r}")

    # global slant, then shift into positive coordinates (chem_synth's contract)
    slant = rng.uniform(-0.06, 0.22)
    slanted = [p - np.column_stack([p[:, 1] * slant, np.zeros(len(p))]) for p in st.strokes]
    mn = np.concatenate(slanted).min(axis=0) - 16.0

    # monotone timestamps from arc length. Nothing in the recognizer reads `t`
    # (layout.py has a self-test proving it), but a stored sample that lies
    # about time would poison anything later that does.
    speed = rng.uniform(0.4, 1.2)
    out: list[dict] = []
    t = 0.0
    for p in slanted:
        q = p - mn
        if out:
            t += rng.uniform(80.0, 250.0)
        sp = speed * rng.uniform(0.85, 1.15)
        ts = [t]
        for k in range(1, len(q)):
            t += max(float(np.hypot(*(q[k] - q[k - 1]))) / sp, 0.4)
            ts.append(t)
        out.append(
            {
                "x": [round(float(v), 2) for v in q[:, 0]],
                "y": [round(float(v), 2) for v in q[:, 1]],
                "t": [round(v, 1) for v in ts],
            }
        )

    return {
        "id": sample_id,
        "source": " ".join(parts),
        "runs": runs,
        "strokes": out,
        "xh": round(xh, 2),
        "template": template,
    }


def stroke_kinds(record: dict) -> list[str]:
    """Ground-truth kind per stroke index; "" for a stroke no run claims."""
    kinds = [""] * len(record["strokes"])
    for run in record["runs"]:
        for i in run["strokes"]:
            kinds[i] = run["kind"]
    return kinds


def split_bank(bank: SymbolBank, half: int) -> SymbolBank:
    """Half the symbol INSTANCES of every label, so an eval line is never drawn
    with a glyph sample the classifier trained on. Labels with a single sample
    keep it in both halves — refusing to draw `q` at all would bias the corpus
    harder than sharing one instance of it does."""
    out = SymbolBank.__new__(SymbolBank)
    out.index = {}
    for label, files in bank.index.items():
        part = [f for i, f in enumerate(files) if i % 2 == half]
        out.index[label] = part or files
    out._cache = bank._cache  # parsing is instance-independent; sharing is free
    return out


def build(
    n: int, seed: int, split: str, half: int, *, expr_limit: int = 0, letters_only: bool = False,
    vocab_half: int | None = None
) -> list[dict]:
    rng = random.Random(seed)
    full = SymbolBank(MW_DIR / "symbols")
    bank = split_bank(full, half)
    exprs = ExpressionBank(split, limit=expr_limit, letters_only=letters_only)
    vocab = split_vocab(vocab_half)
    records = []
    for i in range(n):
        try:
            records.append(synth_mixed(bank, exprs, rng, f"mixed-{seed}-{i}", vocab=vocab))
        except (KeyError, ValueError):
            continue  # a template needing a glyph this half lacks; skip the sample
    return records


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--split", default="valid", choices=["train", "valid", "test"])
    ap.add_argument("--half", type=int, default=0, choices=[0, 1],
                    help="which half of the symbol instances to draw prose from")
    ap.add_argument("--expr-limit", type=int, default=0)
    ap.add_argument("--previews", type=int, default=0)
    ap.add_argument("--vocab-half", type=int, default=None, choices=[0, 1],
                    help="use half the prose vocabulary (train and eval take opposite halves)")
    ap.add_argument("--letters-only", action="store_true",
                    help="draw every formula from the letters-only stress pool")
    args = ap.parse_args()

    records = build(args.n, args.seed, args.split, args.half,
                    expr_limit=args.expr_limit, letters_only=args.letters_only,
                    vocab_half=args.vocab_half)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    n_math = sum(1 for r in records for run in r["runs"] if run["kind"] == "math")
    n_text = sum(1 for r in records for run in r["runs"] if run["kind"] == "text")
    print(f"wrote {len(records)} lines -> {out}  ({n_text} text runs, {n_math} math runs)")

    for r in records[: args.previews]:
        png = out.with_suffix("")
        png.mkdir(parents=True, exist_ok=True)
        render_strokes(r["strokes"]).save(png / f"{r['id']}.png")
    if args.previews:
        print(f"previews -> {out.with_suffix('')}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
