r"""Unified recognition: one page of mixed ink -> prose with formulas in it.

This is the layer that lets the user stop picking a mode. It takes the two
evidence sources apart and gives each the job it is actually good at:

  * `layout.py` (geometry) owns the PARTITION — pages, lines, and the
    structural facts (a vinculum, a big operator) that say "these strokes are
    one expression no matter what anybody read here";
  * `vision_layout.py` (Apple Vision) owns WORD BOUNDARIES and PROSE — its
    word boxes partitioned all 51 strokes of the mixed reference fixture with
    100% purity against ground truth;
  * the ink->LaTeX decoder owns MATH CONTENT, and is never asked what class a
    run is except at S3, where the residue is a handful of single glyphs.

Four measured facts shape everything below, and each one is easy to undo by
accident:

  1. **Vision is confidently wrong about structured math.** On that same
     fixture it read `\nabla I=(I_{x},I_{y})` as `'VI (I×I'` at line
     confidence **1.000**. So the router's cascade puts the STRUCTURAL test
     (`run.spanning`) first, above every lexical test, and Vision's line
     confidence never routes anything.

  2. **Vision box gaps carry no distance information.** The boxes are
     uniformly padded: measured inter-box gaps 0.164 / 0.163 / 0.164 xh where
     the true stroke gaps were 0.85 and 0.70 xh. S2 therefore measures
     `layout.extent_gap`, which recomputes from raw points. Measuring the box
     gap instead converts the genuine word `BE` (0.70 xh from the formula) into
     math — U3 pins both halves of that.

  3. **A run must never be decoded with its neighbour on the next line.** Two
     math lines decoded jointly hallucinated `\begin{matrix}` and scored
     similarity .413; decoded per line, .903 with 2/3 exact. `merge_runs`
     therefore works strictly within one `Line`.

  4. **Batch cost is set by the LONGEST sequence in the batch, not by the
     count.** Eight short expressions batched: 220 ms. The same eight with one
     41-token straggler: 958 ms — SLOWER than the 863 ms of decoding all eight
     serially. Bucketed (seven short together, the long one alone): 508 ms. So
     `decode_math` sorts by rendered ink width and only batches runs that are
     within 2x of each other, with a per-bucket `max_len`.

And one that is counter-intuitive enough to be worth stating twice: **an
isolated text segment can never be re-read.** Re-rendering a single word and
asking Vision again returns NO OBSERVATION — its language model needs the
whole line. A text segment's string is therefore SLICED out of the line
candidate Vision already produced, by the character ranges of the words that
claimed its strokes. That is also why `Segment.vision_text` is kept on math
segments: flipping math->text in the UI has to be a client-side splice,
because the round trip does not exist.

Index space: `Segment.strokes` indexes THE ARRAY PASSED TO `recognize_unified`,
including any point-less strokes in it (`layout.stroke_boxes` keeps their
slots; nothing else here ever renumbers). Callers must hand over the request's
stroke array whole — `serve.py`'s historical `[s for s in req.strokes if s.x]`
filter renumbers and would silently shift every index the client gets back.

Nothing here imports `serve.py`; the model, the tokenizer and even the Vision
entry point are injected, so `python -m src.unified` self-tests the whole
router, merge and assembly pipeline with no checkpoint and no macOS.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, replace
from typing import Callable, Literal, Sequence

import numpy as np

from .chem_normalize import latex_to_ce
from .latex_normalize import OPERATORS, normalize_operators
from .layout import (
    Box,
    LayoutParams,
    Line,
    Run,
    attach_orphans,
    claim_by_boxes,
    cluster_strokes,
    extent_gap,
    segment_geometric,
    stroke_boxes,
    xheight,
)
from .render import strokes_to_array

Kind = Literal["text", "math", "chem"]

TEXT: str = "text"
MATH: str = "math"
CHEM: str = "chem"
# Internal only: what C6 returns and what S1/S3 resolve. A Segment may never
# carry it — `build_segments` asserts that.
AMBIGUOUS: str = "ambiguous"

# ---- router / smoothing constants, all measured -----------------------------

# C3: leading/trailing punctuation Vision attaches to a word. Parentheses are
# stripped too, because Vision brackets its guesses at expression edges (`(I×I`);
# what is left still fails C5 on the `×`, so nothing is lost by stripping them.
STRIP_CHARS = ".,;:!?'\"…()"

# C4: any of these ANYWHERE in the core means the token cannot be a word. Kept
# deliberately wide — a false "math" is repaired by the next stroke or one chip
# tap, a false "text" ships prose into the LaTeX field.
MATH_CHARS = frozenset("=+*/^_<>\\|{}[]~0123456789")

# S1: the only English words that are one letter. Anything else of length 1 is
# a variable until something else says otherwise.
ONE_LETTER_WORDS = frozenset({"a", "i", "o"})

# S2: a text run of at most this many characters, this close (in x-heights, on
# STROKE EXTENTS) to a math run, is part of that formula. 0.55 xh sits under
# the fixture's true word gaps (0.70 / 0.85 xh) and over intra-expression gaps
# (p50 0.386 xh), which is the whole reason the measurement matters.
SHORT_TEXT_LEN = 2
SHORT_TEXT_GAP = 0.55

# S3: the math decoder's confidence is a self-consistency score, not a
# calibrated posterior — it reads 0.889 on a random scribble. At 0.95 it
# separates 27/33 math from ~56/64 text: weak, and used ONLY on runs where
# lexical and geometric evidence are both exhausted.
S3_MATH_CONF = 0.95

# ---- decode batching --------------------------------------------------------

MAX_BATCH = 8
# Two groups share a batch only if the wider one is at most this many times the
# narrower. See fact 4 in the module docstring: without this test a single long
# expression makes the whole batch pay its length.
BATCH_WIDTH_RATIO = 2.0
# max_len budget from the glyph count: ~6 tokens per glyph blob (a fraction is
# `\frac{}{}`, a script is `^{}`), floored so a two-glyph run can still emit a
# command, ceilinged at the decoder's trained maximum.
LEN_PER_CLUSTER = 6
LEN_BASE = 24
LEN_MIN = 32
LEN_MAX = 160


@dataclass(frozen=True)
class Segment:
    """One recognized run of ink: a phrase, or a formula.

    `strokes` indexes the caller's stroke array (see the module docstring).
    `[source_start, source_end)` slices this segment out of the assembled
    source, which is what lets the UI re-label a segment by splicing in place.
    `vision_text` is kept even on math segments — it is the only way a
    math->text correction can be served without a round trip that does not work.
    """

    id: str
    line: int
    page: int
    order: int
    kind: Kind
    text: str | None
    latex: str | None
    vision_text: str | None
    confidence: float
    box: Box
    strokes: tuple[int, ...]
    source_start: int
    source_end: int
    degraded: bool


@dataclass(frozen=True)
class _WordRef:
    """Where a stroke's Vision word came from: which line candidate, and the
    character range inside it. Held per stroke rather than on the Run because
    `attach_orphans` merges and re-splits runs, and only one of the merged runs
    keeps its `vision_word`."""

    line: int  # index into the flattened VLine list
    char_range: tuple[int, int]


# --------------------------------------------------------------------------
# router
# --------------------------------------------------------------------------


def route_word(run: Run) -> str:
    """The ordered cascade C1-C7, first match wins.

    C1  run.spanning              -> math   structure outranks everything
    C2  no Vision word here       -> math   the no-Vision default
    C3  nothing but punctuation   -> math
    C4  a math character present  -> math
    C5  not alphabetic            -> math
    C6  a single letter           -> ambiguous  (S1/S3 decide)
    C7  otherwise                 -> text

    C1 sits ABOVE the lexical tests deliberately. Vision reads structured math
    as confident prose (`'VI'`, `'(I×I'` at line confidence 1.000), so the one
    piece of evidence it cannot fake — a vinculum or a 2 xh operator found by
    the geometry — has to win. The measured basis for C5/C7 is Vision word
    `isalpha()`: true for 60/64 text tokens and 3/33 math tokens.
    """
    if run.spanning:
        return MATH
    if run.vision_word is None:
        return MATH
    core = run.vision_word.strip(STRIP_CHARS)
    if not core:
        return MATH
    if any(ch in MATH_CHARS for ch in core):
        return MATH
    if not core.isalpha():
        return MATH
    if len(core) == 1:
        return AMBIGUOUS
    return TEXT


def classify_runs(
    line: Line,
    p: LayoutParams = LayoutParams(),
    *,
    strokes: Sequence[dict] | None = None,
    clf=None,
) -> bool:
    """Write `run.kind` for every run of a line (in place); True if the trained
    classifier decided, False if the C1-C7 cascade did.

    The trained model (`src/run_classifier.py`) is used when one is loaded AND
    the caller passed the strokes its features are measured from; otherwise this
    is exactly the cascade it has always been. That fallback is load-bearing,
    not decorative: a checkout with no `checkpoints/run_clf.json`, a Linux box
    with no lexicon file, or a corrupt model must still recognize, and every
    self-test in this module deliberately exercises the cascade path by not
    passing a classifier.

    Runs the user has already corrected (`run.forced`) keep the kind they were
    given: a correction that the router could overturn is not a correction.
    """
    free = [r for r in line.runs if not r.forced]
    if clf is not None and strokes is not None and free:
        try:
            from .run_features import line_features

            probs = clf.proba(line_features(line, strokes))
            for run, pm in zip(line.runs, probs):
                if run.forced:
                    continue
                run.kind = MATH if pm >= clf.threshold else TEXT
            return True
        except Exception:
            # A missing lexicon, a stale model, anything: degrade to the rules
            # rather than fail the request. Recognition losing accuracy is
            # recoverable; recognition raising is not.
            pass
    for run in free:
        run.kind = route_word(run)
    return False


def _core(run: Run) -> str:
    return (run.vision_word or "").strip(STRIP_CHARS)


def smooth_line(
    line: Line,
    strokes: Sequence[dict],
    p: LayoutParams = LayoutParams(),
    *,
    decode: Callable[[list[list[int]]], list[tuple[str, float]]] | None = None,
    heuristics: bool = True,
) -> None:
    """S0-S3: the per-line repair pass, where the residual router errors die.

    `heuristics=False` disables S0 and S2 — the two rules that OVERRULE a kind
    already assigned. They exist to patch the cascade's lexical blind spots, and
    the trained classifier already has both signals as features
    (`is_operator_name`, `is_differential`, `core_len`, `gap_left_xh`,
    `gap_right_xh`) weighed against everything else rather than applied as a
    hard override. Left on, S2 alone re-converted three quarters of the short
    words the classifier had just got right — it is the single largest source of
    text->math error in the measured baseline. S1/S3 are unaffected either way:
    they resolve AMBIGUOUS, which only the cascade ever emits.

    Classification is not independent per word — a token's neighbours carry
    most of the evidence about it — so this runs after `classify_runs` over the
    whole line, in x order.

      S0 operator stoplist  a text run whose word is an operator name
         (`sin`, `log`, `Pr`, ...) or a differential (`dx`) next to a math run
         is part of that formula. Vision reads all of them as clean words and
         C7 would ship them as prose.
      S1 ambiguous -> text  for a lone `a`/`i`/`o` beside prose. Every other
         single letter stays ambiguous for S3; without a decoder it falls to
         math, which is C2's default and the only safe one.
      S2 short text -> math when the gap to an adjacent math run is under
         0.55 xh MEASURED ON STROKE EXTENTS (`layout.extent_gap`). This is
         resolved disagreement #2 and the one rule in this file that a
         plausible-looking rewrite silently breaks: Vision's own box gaps are a
         constant ~0.163 xh whatever the true spacing, so the box version of
         this test converts the genuine word `BE` into math while looking
         identical in a diff.
      S3 anything still ambiguous is decoded once and taken as math at
         confidence >= 0.95.

    S0 and S2 read a SNAPSHOT of the kinds taken before they start. Cascading
    would let one conversion walk down a line of short words — `a` turns math,
    so `be` next to it turns math, and so on — and the effect would depend on
    which end of the line we started from.
    """
    runs = line.runs
    if not runs:
        return
    free = [i for i, r in enumerate(runs) if not r.forced]

    def neighbours(i: int) -> list[int]:
        return [j for j in (i - 1, i + 1) if 0 <= j < len(runs)]

    # ---- S0 operator stoplist
    snap = [r.kind for r in runs]
    for i in free if heuristics else ():
        if snap[i] != TEXT:
            continue
        core = _core(runs[i]).lower()
        if core in OPERATORS or _is_differential(core):
            if any(snap[j] == MATH for j in neighbours(i)):
                runs[i].kind = MATH

    # ---- S1 lone letters that are really words
    for i in free:
        if runs[i].kind != AMBIGUOUS:
            continue
        if _core(runs[i]).lower() in ONE_LETTER_WORDS and any(
            runs[j].kind == TEXT for j in neighbours(i)
        ):
            runs[i].kind = TEXT

    # ---- S2 short text swallowed by an adjacent formula
    snap = [r.kind for r in runs]
    for i in free if heuristics else ():
        if snap[i] != TEXT or len(_core(runs[i])) > SHORT_TEXT_LEN:
            continue
        for j in neighbours(i):
            if snap[j] != MATH:
                continue
            if extent_gap(runs[i], runs[j], strokes, line.xh) < SHORT_TEXT_GAP:
                runs[i].kind = MATH
                break

    # ---- S3 the residue: one decode, or the math default
    left = [i for i in free if runs[i].kind == AMBIGUOUS]
    if not left:
        return
    if decode is None:
        for i in left:
            runs[i].kind = MATH
        return
    for i, (_latex, conf) in zip(left, decode([sorted(runs[i].strokes) for i in left])):
        runs[i].kind = MATH if conf >= S3_MATH_CONF else TEXT


def _is_differential(core: str) -> bool:
    """`dx`, `dy`, `dt` — the one two-letter math token Vision reliably reads as
    a word, and the one the plan's operator stoplist misses (`latex_normalize.
    OPERATORS` has no `d*` entry: it exists to typeset function names)."""
    return len(core) == 2 and core[0] == "d" and core[1].isalpha()


def merge_runs(line: Line) -> list[list[Run]]:
    """Adjacent same-kind runs on ONE line coalesce, in x order.

    This is the repair pass that makes over-splitting free: `layout`'s run
    threshold is deliberately loose (tau = 1.00 xh splits ~5% of intra-math
    gaps) precisely because every spurious split lands here. It never crosses a
    line — decoding two lines as one unit measured similarity .413 against .903
    per line, and invented `\\begin{matrix}` out of the vertical offset.
    """
    out: list[list[Run]] = []
    for run in line.runs:
        if run.kind is None:
            raise AssertionError("merge_runs before classify_runs")
        if out and out[-1][-1].kind == run.kind:
            out[-1].append(run)
        else:
            out.append([run])
    return out


# --------------------------------------------------------------------------
# decode
# --------------------------------------------------------------------------


def interpret_math(latex: str, *, chem: bool = False) -> tuple[str, str]:
    """Decoded LaTeX -> (final latex, kind), the ONLY post-processing applied.

    `normalize_operators` is math-only and that is not a style preference:
    `latex_normalize.py:56-59` states its assumption that "English words cannot
    occur", and over prose it turns "the sine of" into `\\sin e`. It is called
    here, next to the chem branch, so the text path in `build_segments` can be
    read at a glance as doing nothing at all.

    chem: the expression is reinterpreted as mhchem and wrapped `\\ce{...}` —
    with NO operator normalization, because the user declared this ink
    chemistry and `Pr` is praseodymium, `Sn` is tin. Not chemistry-expressible
    -> the raw decoded LaTeX, and the kind stays `math`, because that is what
    it turned out to be.
    """
    if chem:
        ce = latex_to_ce(latex)
        if ce is not None:
            return f"\\ce{{{ce}}}", CHEM
        return latex, MATH
    return normalize_operators(latex), MATH


def _live_points(group: Sequence[dict]) -> bool:
    return any(s["x"] for s in group)


def _ink_width(group: Sequence[dict]) -> float:
    """Width of the group AFTER render normalization, in decoder pixels.

    The decode cost proxy has to be measured post-normalization: the renderer
    fits every group to the same 96 px height, so raw stroke width says nothing
    about how much of the 768 px canvas a group will occupy — and it is the
    occupied width that predicts the token count.
    """
    from .render import normalize_strokes

    pts = normalize_strokes(list(group))
    if not pts:
        return 0.0
    lo = min(float(q[:, 0].min()) for q in pts)
    hi = max(float(q[:, 0].max()) for q in pts)
    return hi - lo


def _glyph_count(group: Sequence[dict], p: LayoutParams) -> int:
    boxes = stroke_boxes(list(group))
    if not boxes:
        return 0
    return len(cluster_strokes(boxes, xheight(boxes), p))


def max_len_for(n_clusters: int) -> int:
    """Token budget for a group of `n_clusters` glyph blobs."""
    return min(LEN_MAX, max(LEN_MIN, LEN_BASE + LEN_PER_CLUSTER * n_clusters))


def bucket_batches(
    widths: Sequence[float], *, max_batch: int = MAX_BATCH, width_ratio: float = BATCH_WIDTH_RATIO
) -> list[list[int]]:
    """Group indices into decode batches: sorted by width, at most `max_batch`
    per batch, and never mixing a group with one more than `width_ratio` times
    its width.

    Both limits are load-bearing and for the same reason. `greedy_decode` runs
    until every row in the batch has emitted `<eos>` (or `max_len` steps), so
    one long expression makes every short one beside it pay its length:
    measured 8 short = 220 ms, 8 with one straggler = 958 ms, the same 8
    serially = 863 ms, bucketed = 508 ms. Blind batching is not an optimization.
    """
    order = sorted(range(len(widths)), key=lambda i: (widths[i], i))
    out: list[list[int]] = []
    for i in order:
        if (
            out
            and len(out[-1]) < max_batch
            and widths[i] <= width_ratio * max(widths[out[-1][0]], 1e-9)
        ):
            out[-1].append(i)
        else:
            out.append([i])
    return out


def _confidence(value) -> float:
    """exp(mean token log-prob), clamped — the decoder's own score."""
    return float(min(1.0, max(0.0, math.exp(float(value)))))


def decode_math(
    groups: Sequence[Sequence[dict]],
    model,
    tokenizer,
    *,
    max_batch: int = MAX_BATCH,
    width_ratio: float = BATCH_WIDTH_RATIO,
    device=None,
    params: LayoutParams = LayoutParams(),
) -> list[tuple[str, float]]:
    """Decode math groups to RAW LaTeX + confidence, in the caller's order.

    Each group is rendered INDIVIDUALLY through the shared 96x768 renderer.
    Never render several groups as one page: `render.normalize_strokes` fits
    the whole bounding box to 96 px, so a second line costs the first half its
    resolution, and `Encoder.pos2d` is registered for exactly that grid
    (`model.py:61-62`) so a bigger canvas is not an option either.

    `model`/`tokenizer` are parameters, not imports: `serve.py` imports this
    module and owns the checkpoints, and the self-test has neither. torch is
    imported lazily for the same reason — the router, the merge and the
    assembly are pure functions that must stay importable without it.

    Empty groups (all strokes point-less) return ("", 0.0) rather than being
    handed to the decoder as a blank canvas, which reliably hallucinates.
    """
    out: list[tuple[str, float]] = [("", 0.0)] * len(groups)
    live = [i for i, g in enumerate(groups) if _live_points(g)]
    if not live:
        return out

    import torch

    widths = [_ink_width(groups[i]) for i in live]
    lens = [max_len_for(_glyph_count(groups[i], params)) for i in live]
    for bucket in bucket_batches(widths, max_batch=max_batch, width_ratio=width_ratio):
        arrays = np.stack([strokes_to_array(list(groups[live[k]])) for k in bucket])
        images = torch.from_numpy(arrays)
        if device is not None:
            images = images.to(device)
        with torch.no_grad():
            seqs, mean_logp = model.greedy_decode(images, max_len=max(lens[k] for k in bucket))
        for row, k in enumerate(bucket):
            out[live[k]] = (tokenizer.decode(seqs[row]), _confidence(mean_logp[row]))
    return out


# --------------------------------------------------------------------------
# segments and source
# --------------------------------------------------------------------------


def _box_of(boxes: Sequence[Box], ids: Sequence[int], fallback: Box) -> Box:
    live = [boxes[i] for i in ids]
    if not live:
        return fallback
    return (
        min(b[0] for b in live),
        min(b[1] for b in live),
        max(b[2] for b in live),
        max(b[3] for b in live),
    )


def build_segments(
    lines: Sequence[Line],
    strokes: Sequence[dict],
    *,
    decode: Callable[[list[list[int]]], list[tuple[str, float]]],
    text_for: Callable[[Sequence[Run]], tuple[str, float]],
    chem: bool = False,
    degraded: bool = False,
) -> list[Segment]:
    """Merged runs -> Segments, with every math group decoded in ONE call.

    The single `decode` call across the whole page is what lets `decode_math`
    bucket: batching decisions can only be made when every group is known.

    Text segments are built by `text_for` and are then touched by nothing —
    no normalization, no LaTeX escaping, no stripping beyond what the slice
    already did. Math segments are the only ones that go through
    `interpret_math`. `source_start`/`source_end` are placeholders here;
    `assemble_source` is what knows where a segment lands.
    """
    boxes = stroke_boxes(list(strokes))
    plan: list[tuple[Line, int, str, list[Run]]] = []
    for line in lines:
        for order, group in enumerate(merge_runs(line)):
            kind = group[0].kind
            if kind == AMBIGUOUS:
                raise AssertionError("ambiguous run reached build_segments; smooth_line first")
            plan.append((line, order, kind, group))

    math_at = [k for k, (_l, _o, kind, _g) in enumerate(plan) if kind != TEXT]
    decoded = (
        decode([sorted(i for r in plan[k][3] for i in r.strokes) for k in math_at])
        if math_at
        else []
    )
    if len(decoded) != len(math_at):
        raise AssertionError(f"decoder returned {len(decoded)} results for {len(math_at)} groups")
    by_index = dict(zip(math_at, decoded))

    out: list[Segment] = []
    for k, (line, order, kind, group) in enumerate(plan):
        ids = tuple(sorted(i for r in group for i in r.strokes))
        vision_text = " ".join(r.vision_word for r in group if r.vision_word) or None
        if kind == TEXT:
            text, conf = text_for(group)
            latex = None
        else:
            raw, conf = by_index[k]
            latex, kind = interpret_math(raw, chem=chem or kind == CHEM)
            text = None
        out.append(
            Segment(
                id=f"s{len(out)}",
                line=line.index,
                page=line.page,
                order=order,
                kind=kind,  # type: ignore[arg-type]
                text=text,
                latex=latex,
                vision_text=vision_text,
                confidence=float(conf),
                box=_box_of(boxes, ids, group[0].box),
                strokes=ids,
                source_start=-1,
                source_end=-1,
                degraded=degraded,
            )
        )
    return out


def assemble_source(segments: Sequence[Segment]) -> tuple[str, list[tuple[int, int]]]:
    r"""Segments -> the app's paragraph source grammar, plus one span each.

        math / chem  ->  \( latex \)          (lib/blocks/source.ts:50's INLINE_MATH)
        text         ->  the text, verbatim
        within a line -> joined with " " ;  across lines -> "\n"

    Every LaTeX token has to sit inside `\(...\)`: prose runs are escaped on
    export (`lib/blocks/format.ts`), so a bare `\alpha` in a text segment would
    ship as `\textbackslash alpha`.

    The delimiter check is provably never triggered — the checkpoint's
    231-token vocabulary contains `(` and `)` and no `\(` / `\)` token, so the
    decoder cannot emit one — and it raises anyway. A math segment that did
    contain `\)` would silently terminate its own formula and turn the rest of
    the expression into prose, which is exactly the kind of corruption that is
    unreadable downstream and trivial to catch here. `raise` rather than
    `assert` because `python -O` deletes asserts.

    An empty segment contributes nothing and gets a zero-width span at the
    current position, so `segments[i]` and `spans[i]` stay index-aligned for
    the client's splice arithmetic.
    """
    parts: list[str] = []
    spans: list[tuple[int, int]] = []
    pos = 0
    prev_line: int | None = None
    for seg in segments:
        if seg.kind == TEXT:
            piece = seg.text or ""
        else:
            latex = seg.latex or ""
            if "\\(" in latex or "\\)" in latex:
                raise AssertionError(f"math segment {seg.id} carries an inline-math delimiter: {latex!r}")
            piece = f"\\({latex}\\)"
        if not piece:
            spans.append((pos, pos))
            continue
        if prev_line is not None:
            sep = "\n" if seg.line != prev_line else " "
            parts.append(sep)
            pos += len(sep)
        parts.append(piece)
        spans.append((pos, pos + len(piece)))
        pos += len(piece)
        prev_line = seg.line
    return "".join(parts), spans


# --------------------------------------------------------------------------
# the pipeline
# --------------------------------------------------------------------------


def _interval_gap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(a0, b0) - min(a1, b1)


def _apply_overrides(lines: Sequence[Line], overrides) -> None:
    """Force run kinds from the user's per-segment corrections, BEFORE routing.

    Forcing the run (rather than patching the finished segment) is what makes a
    correction behave the way a user expects: the corrected run re-merges with
    its neighbours and a math correction re-decodes together with them, so
    fixing one word in the middle of a formula repairs the formula.

    A run is claimed by an override when the override names more than half its
    strokes — segments and runs need not correspond one-to-one, because the ink
    may have changed since the override was made.
    """
    for ov in overrides or ():
        # dicts on the JSON path, pydantic models on serve.py's.
        want = set(ov["strokes"] if isinstance(ov, dict) else ov.strokes)
        kind = ov["kind"] if isinstance(ov, dict) else ov.kind
        if not want:
            continue
        for line in lines:
            for run in line.runs:
                if not run.strokes:
                    continue
                hit = sum(1 for i in run.strokes if i in want)
                if hit * 2 > len(run.strokes):
                    run.kind, run.forced = kind, True


def _vision_pass(
    strokes: Sequence[dict],
    lines: Sequence[Line],
    p: LayoutParams,
    analyze: Callable[[list[dict], float], object],
) -> tuple[list, dict[int, _WordRef]]:
    """Run Vision once per ink PAGE and rewrite each line's runs from its words.

    Once per page, not once per document: cost is flat in pixels but linear in
    lines (a 12.0 Mpx A4 page measured 179 ms, the same page at 3.6 Mpx 161 ms),
    and a page break means the strokes below it are a different sheet.

    Every `analyze` call happens before any line is rewritten, so a
    `VisionUnavailable` raised on the first page leaves the geometric
    segmentation untouched for the caller to fall back on.

    Stroke->box assignment is `claim_by_boxes`, i.e. POINT CONTAINMENT: 28 of
    the reference fixture's 51 stroke bounding boxes have zero area, so an
    area test claims 23/51 where containment claims 51/51.
    """
    boxes = stroke_boxes(list(strokes))
    pages: dict[int, list[Line]] = {}
    for line in lines:
        pages.setdefault(line.page, []).append(line)

    layouts: dict[int, object] = {}
    for page, page_lines in sorted(pages.items()):
        idx = sorted(i for ln in page_lines for r in ln.runs for i in r.strokes)
        if not idx:
            continue
        layouts[page] = analyze([strokes[i] for i in idx], xheight([boxes[i] for i in idx]))

    vlines: list = []
    page_words: dict[int, list[tuple[int, object]]] = {}
    for page, lay in sorted(layouts.items()):
        offset = len(vlines)
        vlines.extend(lay.lines)  # type: ignore[attr-defined]
        page_words[page] = [
            (offset + k, w) for k, vl in enumerate(lay.lines) for w in vl.words  # type: ignore[attr-defined]
        ]

    wordrefs: dict[int, _WordRef] = {}
    for line in lines:
        idx = sorted(i for r in line.runs for i in r.strokes)
        # Only words whose band actually meets this line may claim its strokes.
        # Point containment is 2D and rarely reaches across lines on its own,
        # but this also keeps the claim loop at O(line strokes x line words).
        words = [
            (vi, w)
            for vi, w in page_words.get(line.page, ())
            if _interval_gap(w.box[1], w.box[3], line.box[1], line.box[3]) <= 0.5 * line.xh
        ]
        if not words or not idx:
            continue
        assign, unclaimed = claim_by_boxes(strokes, idx, [w.box for _vi, w in words], line.xh, p)
        if not assign:
            continue

        by_word: dict[int, list[int]] = {}
        for i, wi in assign.items():
            by_word.setdefault(wi, []).append(i)
        runs: list[Run] = []
        for wi, ids in by_word.items():
            vi, w = words[wi]
            ids.sort()
            runs.append(
                Run(
                    strokes=ids,
                    box=_box_of(boxes, ids, w.box),
                    line=line.index,
                    vision_word=w.text,
                    vision_range=w.char_range,
                )
            )
            for i in ids:
                wordrefs[i] = _WordRef(vi, w.char_range)
        runs.sort(key=lambda r: (r.box[0], r.box[1], r.strokes[0]))
        runs = attach_orphans(strokes, runs, line.xh, p, orphans=unclaimed)
        for r in runs:
            r.line = line.index
        line.runs = runs

        seen = Counter(wordrefs[i].line for i in idx if i in wordrefs)
        if seen:
            dom = max(seen, key=lambda k: (seen[k], -k))
            line.vision_conf = float(vlines[dom].conf)
            line.vision_text = vlines[dom].text
    return vlines, wordrefs


def _text_slicer(vlines: Sequence, wordrefs: dict[int, _WordRef]):
    """Build the `text_for` callback: slice the line candidate Vision already
    produced, never re-run it.

    Re-rendering an isolated word and asking Vision again returns NO
    OBSERVATION — measured for `BE`, `THEN`, `GET`. The language model needs
    the whole line, and by segment time that context is gone. So a text segment
    is `line.text[min(start) : max(end)]` over its words' character ranges.

    Taking min..max rather than concatenating the words is deliberate on two
    counts: it preserves the punctuation and casing Vision emitted BETWEEN the
    words, and it heals the holes in `VLine.words` — Vision refuses a bounding
    box for some tokens, and `vision_layout` drops those rather than invent one,
    so the word list is a subset of the line and never a tiling of it.
    """

    def text_for(group: Sequence[Run]) -> tuple[str, float]:
        by_line: dict[int, list[tuple[int, int]]] = {}
        for run in group:
            for i in run.strokes:
                ref = wordrefs.get(i)
                if ref is not None:
                    by_line.setdefault(ref.line, []).append(ref.char_range)
        parts: list[str] = []
        conf = 1.0
        for li in sorted(by_line):
            lo = min(r[0] for r in by_line[li])
            hi = max(r[1] for r in by_line[li])
            piece = vlines[li].text[lo:hi].strip()
            if piece:
                parts.append(piece)
                conf = min(conf, float(vlines[li].conf))
        if not parts:
            # No line candidate behind this run — every box was dropped, or the
            # run is text only because the user said so. Fall back to whatever
            # word the run carries. A forced run scores 1.0 because the user IS
            # the evidence; otherwise 0.5, since the page confidence is a min
            # and 0.0 there would gate Insert shut over one unclaimed word.
            fallback = " ".join(r.vision_word for r in group if r.vision_word).strip()
            if any(r.forced for r in group):
                return fallback, 1.0
            return fallback, 0.5 if fallback else 0.0
        return " ".join(parts), conf

    return text_for


def recognize_unified(
    strokes: Sequence[dict],
    *,
    chem: bool = False,
    page_breaks: Sequence[float] = (),
    vision: bool = True,
    overrides: Sequence = (),
    model=None,
    tokenizer=None,
    chem_model=None,
    chem_tokenizer=None,
    decoder: Callable[[list[list[int]]], list[tuple[str, float]]] | None = None,
    analyze: Callable[[list[dict], float], object] | None = None,
    params: LayoutParams = LayoutParams(),
    device=None,
    engine_name: str | None = None,
    use_classifier: bool = True,
) -> tuple[list[Segment], str, float, dict]:
    """The whole pipeline: strokes -> (segments, source, confidence, engine).

    `strokes` must be the request array WHOLE, point-less strokes included —
    that is what makes `Segment.strokes` index the caller's array.

    Everything external is injected. `model`/`tokenizer` (and their chem
    counterparts) belong to `serve.py`, which imports this module; `decoder`
    replaces them wholesale for tests; `analyze` defaults to
    `vision_layout.analyze` looked up THROUGH THE MODULE so a monkeypatch on
    `src.vision_layout.analyze` — which is how the no-Vision path is exercised
    — is honored.

    Degradation is total and silent by design: no Apple Vision means no word
    boundaries and no prose, so every run falls to C2 and the page comes back
    as per-line math with `degraded=True` on every segment and `engine["text"]`
    null. That is still strictly better than the whole page as one expression
    (measured similarity .903 vs .413). This function does not raise for it and
    the caller must not turn it into a 501.

    `confidence` is the MINIMUM over segments, never a mean: the Insert button
    is gated on this number, and an unweighted mean is precisely what lets one
    garbage segment hide behind three good ones.
    """
    lines, vlines, wordrefs, vision_ok = prepare_lines(
        strokes, page_breaks=page_breaks, vision=vision, analyze=analyze, params=params
    )

    _apply_overrides(lines, overrides)

    decode = decoder
    if decode is None:
        # chem decodes with the chem checkpoint when the caller has one; the
        # fallback to the math model is `serve.py`'s existing behaviour, where
        # CHEM_MODEL IS the math model until a chem fine-tune exists.
        use_model = chem_model if (chem and chem_model is not None) else model
        use_tok = chem_tokenizer if (chem and chem_tokenizer is not None) else tokenizer

        def decode(groups: list[list[int]]) -> list[tuple[str, float]]:
            # Demanded lazily so a page of pure prose recognizes on a server
            # that has no checkpoint loaded at all.
            if not groups:
                return []
            if use_model is None or use_tok is None:
                raise ValueError("recognize_unified needs a model+tokenizer or a decoder")
            return decode_math(
                [[strokes[i] for i in g] for g in groups],
                use_model,
                use_tok,
                device=device,
                params=params,
            )

    clf = None
    if use_classifier:
        from .run_classifier import load_default

        clf = load_default()
    for line in lines:
        trained = classify_runs(line, params, strokes=strokes, clf=clf)
        smooth_line(line, strokes, params, decode=decode, heuristics=not trained)

    segments = build_segments(
        lines,
        strokes,
        decode=decode,
        text_for=_text_slicer(vlines, wordrefs),
        chem=chem,
        degraded=not vision_ok,
    )
    source, spans = assemble_source(segments)
    segments = [
        replace(s, source_start=a, source_end=b) for s, (a, b) in zip(segments, spans)
    ]
    confidence = min((s.confidence for s in segments), default=0.0)
    engine = {
        "layout": "vision" if vision_ok else "geometry",
        "text": "apple-vision" if vision_ok else None,
        "math": engine_name,
    }
    return segments, source, confidence, engine


def prepare_lines(
    strokes: Sequence[dict],
    *,
    page_breaks: Sequence[float] = (),
    vision: bool = True,
    analyze: Callable[[list[dict], float], object] | None = None,
    params: LayoutParams = LayoutParams(),
) -> tuple[list[Line], list, dict[int, _WordRef], bool]:
    """Everything before classification: geometry, then Vision's word boundaries.

    Split out of `recognize_unified` so the run-classifier's feature extractor
    (`src/run_features.py`) sees byte-identical inputs to the ones the live
    router sees. A trainer that prepared its runs even slightly differently
    would learn a distribution the product never presents to it.
    """
    lines = segment_geometric(strokes, params, page_breaks)

    vision_ok = False
    vlines: list = []
    wordrefs: dict[int, _WordRef] = {}
    if vision and lines:
        # The except tuple is built whether or not `analyze` was injected: a
        # test double that raises VisionUnavailable has to degrade like the
        # real thing, not escape.
        errors: tuple[type[BaseException], ...] = (ImportError,)
        try:
            from .text_ocr import VisionUnavailable

            errors = (VisionUnavailable, ImportError)
        except ImportError:  # no PIL/pyobjc on this box at all
            pass
        fn = analyze
        if fn is None:
            try:
                from . import vision_layout

                # Late-bound on purpose: `serve.py`'s no-Vision test patches
                # src.vision_layout.analyze, and a from-import would have
                # captured the original function.
                fn = lambda ss, xh: vision_layout.analyze(ss, xh)  # noqa: E731
            except ImportError:
                fn = None
        if fn is not None:
            try:
                vlines, wordrefs = _vision_pass(strokes, lines, params, fn)
                vision_ok = True
            except errors:
                vision_ok = False

    return lines, vlines, wordrefs, vision_ok


# --------------------------------------------------------------------------
# self-test  (repo convention: gated __main__, cases list, exit code)
# --------------------------------------------------------------------------

if __name__ == "__main__":
    P = LayoutParams()
    XH = 100.0

    def bar(x: float, y: float = 0.0, h: float = XH) -> dict:
        """A vertical stroke — the generic glyph of these fixtures. Zero width,
        like a real `I`/`l`/stem, which keeps the zero-area-bbox case live."""
        return {"x": [float(x), float(x)], "y": [float(y), float(y + h)], "t": [0, 80]}

    def mkline(specs, index: int = 0, page: int = 0, x0: float = 0.0, xh: float = XH):
        """specs: (gap, width, vision_word, spanning, pad) per run, laid out
        left to right with the given ink gap before each. Returns (strokes, Line).

        `pad` inflates the Run BOX only — the strokes stay where they are. That
        is how a Vision word box behaves (uniformly padded, so its gaps are a
        constant ~0.163 xh whatever the ink does), and it is what lets U3 tell
        a stroke-extent gap from a box gap.

        `xh` scales the whole fixture, which is what makes a threshold stated
        in raw coordinates distinguishable from one stated in x-heights.
        """
        strokes: list[dict] = []
        runs: list[Run] = []
        x = x0
        for gap, width, word, spanning, pad in specs:
            x += gap
            ids = []
            n = max(2, int(width // (0.4 * xh)) + 1)
            for k in range(n):
                ids.append(len(strokes))
                strokes.append(bar(x + width * k / (n - 1), h=xh))
            runs.append(
                Run(
                    strokes=ids,
                    box=(x - pad, 0.0, x + width + pad, xh),
                    line=index,
                    vision_word=word,
                    spanning=spanning,
                )
            )
            x += width
        box = (runs[0].box[0], 0.0, runs[-1].box[2], xh)
        return strokes, Line(index=index, box=box, xh=xh, runs=runs, page=page)

    def kinds(strokes, line, decode=None):
        classify_runs(line, P)
        smooth_line(line, strokes, P, decode=decode)
        return tuple(r.kind for r in line.runs)

    def routed(line):
        classify_runs(line, P)
        return tuple(r.kind for r in line.runs)

    def fake_decode(pairs):
        """A decoder stand-in: consumes stroke-index groups in order and
        returns the caller's canned (latex, confidence) list."""
        canned = list(pairs)

        def decode(groups):
            return [canned[k % len(canned)] for k in range(len(groups))]

        return decode

    W = 120.0  # a run's ink width; every gap below is stated in xh

    # ---------------- cases ----------------

    def U1():
        """The cascade, first match wins. The `spanning` run carries a clean
        alphabetic word, so ONLY C1 can make it math — a router that tested
        `isalpha` first would call it text."""
        specs = [
            (0.0, W, "Let", False, 0.0),
            (1.5 * XH, W, "x^2", False, 0.0),
            (1.5 * XH, W, None, False, 0.0),
            (1.5 * XH, W, "15", False, 0.0),
            (1.5 * XH, W, "(I×I", False, 0.0),
            (1.5 * XH, W, "BE", True, 0.0),
        ]
        strokes, line = mkline(specs)
        return routed(line)

    def U2():
        """S1 rescues a lone `A` beside prose; alone it stays a variable. With
        a decoder, S3 arbitrates the residue on the decode confidence."""
        a, la = mkline([(0.0, W, "the", False, 0.0), (1.5 * XH, W, "A", False, 0.0),
                        (1.5 * XH, W, "answer", False, 0.0)])
        b, lb = mkline([(0.0, W, "x^2", False, 0.0), (1.5 * XH, W, "A", False, 0.0)])
        c, lc = mkline([(0.0, W, "x^2", False, 0.0), (1.5 * XH, W, "A", False, 0.0)])
        d, ld = mkline([(0.0, W, "x^2", False, 0.0), (1.5 * XH, W, "A", False, 0.0)])
        return (
            kinds(a, la),
            kinds(b, lb),
            kinds(c, lc, decode=fake_decode([("A", 0.99)])),
            kinds(d, ld, decode=fake_decode([("A", 0.50)])),
        )

    def U3():
        """RULING #2, both halves.

        (a) `VI` — Vision's read of the leading `\\nabla I` — sits at stroke
            gap 0.0 from the formula and must become math.
        (b) `BE` is a real word at stroke gap 0.70 xh and must stay text, even
            though its Vision box is 0.163 xh from the formula's box.

        The boxes here are padded exactly as Vision pads: for (b) the box gap
        is 0.163 xh while the ink gap is 0.70 xh, so a version of S2 that
        measures `Run.box` instead of `layout.extent_gap` flips `BE` to math
        and this case fails.

        (b) is then re-run at x0.005 and x7.3. `layout.extent_gap`'s 4th
        argument is the x-height and defaults to 1.0, so the plan-signature
        3-arg call returns RAW coordinates: it compares a device-dependent
        distance to 0.55 and, on ink with a 0.5-unit x-height, converts every
        word beside a formula. The scale sweep is what notices.
        """
        # (a) VI overlaps the formula's x-range: gap 0.0 on extents.
        sa, la = mkline([(0.0, 500.0, "(I×I", False, 0.0)])
        vi = [len(sa), len(sa) + 1]
        sa = sa + [bar(20.0), bar(70.0)]
        la.runs.append(Run(strokes=vi, box=(20.0, 0.0, 70.0, XH), line=0, vision_word="VI"))
        la.runs.sort(key=lambda r: (r.box[0], r.strokes[0]))

        # (b) BE starts 0.70 xh after the formula's last stroke, but the two
        # BOXES are only 0.163 xh apart.
        def be_case(k: float):
            pad = (0.70 - 0.163) * XH * k / 2.0
            return mkline(
                [(0.0, 500.0 * k, "(I×I", False, pad), (0.70 * XH * k, W * k, "BE", False, pad)],
                xh=XH * k,
            )

        sb, lb = be_case(1.0)
        box_gap = round((lb.runs[1].box[0] - lb.runs[0].box[2]) / XH, 3)
        ink_gap = round(extent_gap(lb.runs[0], lb.runs[1], sb, XH), 3)
        swept = tuple(kinds(*be_case(k)) for k in (0.005, 0.37, 7.3))
        return (kinds(sa, la), kinds(sb, lb), box_gap, ink_gap, swept)

    def U4():
        """S0 stoplist: an operator name next to math is part of the formula,
        between two words it is prose. `dx` is caught by S2 instead (it is two
        characters and sits tight against its integrand) — `latex_normalize.
        OPERATORS` has no differential entry, which is what `_is_differential`
        covers."""
        a, la = mkline([(0.0, W, "x^2", False, 0.0), (1.5 * XH, W, "sin", False, 0.0)])
        b, lb = mkline([(0.0, W, "the", False, 0.0), (1.5 * XH, W, "sin", False, 0.0),
                        (1.5 * XH, W, "wave", False, 0.0)])
        c, lc = mkline([(0.0, W, "x^2", False, 0.0), (0.2 * XH, W, "dx", False, 0.0)])
        d, ld = mkline([(0.0, W, "the", False, 0.0), (1.5 * XH, W, "dx", False, 0.0),
                        (1.5 * XH, W, "wave", False, 0.0)])
        return (kinds(a, la), kinds(b, lb), kinds(c, lc), kinds(d, ld))

    def U5():
        """[text,text,math,math,text] merges to 3 segments — and the merge is
        what makes layout.py's deliberate over-splitting free."""
        specs = [
            (0.0, W, "Let", False, 0.0),
            (1.5 * XH, W, "the", False, 0.0),
            (1.5 * XH, W, "x^2", False, 0.0),
            (1.5 * XH, W, "+1", False, 0.0),
            (1.5 * XH, W, "answer", False, 0.0),
        ]
        strokes, line = mkline(specs)
        classify_runs(line, P)
        smooth_line(line, strokes, P)
        groups = merge_runs(line)
        return (tuple(g[0].kind for g in groups), tuple(len(g) for g in groups))

    def U6():
        """Assembly into the app's paragraph grammar, and the spans that index
        it. The spans are what the UI splices a re-labelled segment into."""
        segs = [
            _seg(0, 0, TEXT, text="let"),
            _seg(0, 1, MATH, latex="x^{2}"),
            _seg(0, 2, TEXT, text="be"),
        ]
        source, spans = assemble_source(segs)
        sliced = tuple(source[a:b] for a, b in spans)
        return (source, tuple(spans), sliced)

    def U7():
        """normalize_operators is applied to MATH ONLY. Over prose it turns
        "the sine of" into "the \\sin e of" — its own docstring states it
        assumes English words cannot occur."""
        strokes, line = mkline(
            [(0.0, W, "the", False, 0.0), (1.5 * XH, W, "sine", False, 0.0),
             (1.5 * XH, W, "of", False, 0.0), (1.5 * XH, W, "x^2", False, 0.0)]
        )
        classify_runs(line, P)
        smooth_line(line, strokes, P)
        segs = build_segments(
            [line],
            strokes,
            decode=fake_decode([("sinx", 0.9)]),
            text_for=lambda g: ("the sine of", 1.0),
        )
        return tuple((s.kind, s.text, s.latex) for s in segs)

    def U8():
        """Runs never merge across lines, and the source separates them with a
        newline. Joint two-line decoding measured similarity .413 against .903
        per line, and invented \\begin{matrix} out of the vertical offset."""
        s0, l0 = mkline([(0.0, W, "x^2", False, 0.0), (0.3 * XH, W, "+1", False, 0.0)], index=0)
        s1, l1 = mkline([(0.0, W, "y^2", False, 0.0), (0.3 * XH, W, "+2", False, 0.0)], index=1)
        strokes = s0 + [dict(s, x=[v for v in s["x"]], y=[v + 400 for v in s["y"]]) for s in s1]
        for r in l1.runs:
            r.strokes = [i + len(s0) for i in r.strokes]
        for line in (l0, l1):
            classify_runs(line, P)
            smooth_line(line, strokes, P)
        segs = build_segments(
            [l0, l1], strokes, decode=fake_decode([("x^{2}+1", 0.9), ("y^{2}+2", 0.8)]),
            text_for=lambda g: ("", 0.0),
        )
        source, _spans = assemble_source(segs)
        return (len(segs), tuple(s.line for s in segs), source)

    def U9():
        """chem=True reinterprets MATH segments and leaves text alone; ink that
        is not chemistry-expressible falls back to the raw LaTeX and stays
        kind `math`."""
        strokes, line = mkline(
            [(0.0, W, "Reaction", False, 0.0), (1.5 * XH, W, "2H_2", False, 0.0)]
        )
        classify_runs(line, P)
        smooth_line(line, strokes, P)
        good = build_segments(
            [line], strokes,
            decode=fake_decode([(r"2H_{2}+O_{2}\rightarrow 2H_{2}O", 0.9)]),
            text_for=lambda g: ("Reaction", 1.0), chem=True,
        )
        bad = build_segments(
            [line], strokes, decode=fake_decode([(r"\sqrt{x}", 0.9)]),
            text_for=lambda g: ("Reaction", 1.0), chem=True,
        )
        return (
            tuple((s.kind, s.text, s.latex) for s in good),
            tuple((s.kind, s.latex) for s in bad),
        )

    def U10():
        """A math segment may never carry `\\(` or `\\)` — it would terminate
        its own formula and turn the rest of the expression into prose. The
        231-token vocabulary makes it impossible; assemble_source checks anyway."""
        out = []
        for latex in (r"a\(b", r"a\)b", r"a(b)"):
            try:
                assemble_source([_seg(0, 0, MATH, latex=latex)])
                out.append("ok")
            except AssertionError:
                out.append("raised")
        return tuple(out)

    def U11():
        """Bucketing (ruling #3). Seven short groups and one 9x longer one make
        TWO buckets: naive batch-8 puts them together and pays the straggler's
        length on all eight (measured 958 ms vs 508 ms bucketed). Nine short
        ones also make two, on the batch-size limit."""
        seven_plus_long = bucket_batches([100.0] * 7 + [900.0])
        nine_short = bucket_batches([100.0] * 9)
        eight_short = bucket_batches([100.0] * 8)
        return (
            tuple(len(b) for b in seven_plus_long),
            tuple(len(b) for b in nine_short),
            tuple(len(b) for b in eight_short),
            (max_len_for(0), max_len_for(4), max_len_for(20), max_len_for(100)),
        )

    def U12():
        """No Vision: `recognize_unified` degrades to per-line math and NEVER
        raises. Also pins the index space — stroke 2 has no points, keeps its
        slot, and appears in no segment, so every index the caller gets back
        indexes the array the caller passed in."""
        strokes = [bar(0.0), bar(40.0), {"x": [], "y": [], "t": []}, bar(80.0)]
        strokes += [bar(0.0, 400.0), bar(40.0, 400.0)]
        segs, source, conf, engine = recognize_unified(
            strokes, vision=False, decoder=fake_decode([("a+b", 0.8), ("c", 0.4)])
        )
        return (
            tuple((s.kind, s.strokes, s.line, s.degraded) for s in segs),
            source,
            conf,
            engine["layout"],
            engine["text"],
        )

    def U13():
        """Top-level confidence is the MIN over segments (ruling #10). The
        Insert button is gated on it; a mean lets one garbage segment hide
        behind three good ones — here mean .7 vs min .3."""
        strokes = [bar(0.0), bar(40.0), bar(0.0, 400.0), bar(40.0, 400.0)]
        segs, _source, conf, _engine = recognize_unified(
            strokes, vision=False, decoder=fake_decode([("a", 0.9), ("b", 0.3)])
        )
        return (tuple(round(s.confidence, 3) for s in segs), round(conf, 3))

    def U14():
        """A user override forces a run's kind before routing and survives
        smoothing — a correction the router can overturn is not a correction.
        Here `x^2` would route to math by C4 and is forced to text."""
        specs = [(0.0, W, "x^2", False, 0.0), (1.5 * XH, W, "answer", False, 0.0)]
        strokes, line = mkline(specs)
        _apply_overrides([line], [{"strokes": line.runs[0].strokes, "kind": TEXT}])
        classify_runs(line, P)
        smooth_line(line, strokes, P)
        return (tuple(r.kind for r in line.runs), tuple(len(g) for g in merge_runs(line)))

    def _seg(line: int, order: int, kind: str, *, text=None, latex=None) -> Segment:
        return Segment(
            id=f"s{order}", line=line, page=0, order=order, kind=kind,  # type: ignore[arg-type]
            text=text, latex=latex, vision_text=None, confidence=1.0,
            box=(0.0, 0.0, 1.0, 1.0), strokes=(), source_start=-1, source_end=-1,
            degraded=False,
        )

    cases = [
        ("U1", U1, "cascade C1-C7, structure above lexis",
         (TEXT, MATH, MATH, MATH, MATH, MATH)),
        ("U2", U2, "S1 lone letter; S3 arbitrates the residue",
         ((TEXT, TEXT, TEXT), (MATH, MATH), (MATH, MATH), (MATH, TEXT))),
        ("U3", U3, "ruling #2: VI(gap 0.00)->math, BE(gap 0.70 xh)->text",
         ((MATH, MATH), (MATH, TEXT), 0.163, 0.7,
          ((MATH, TEXT), (MATH, TEXT), (MATH, TEXT)))),
        ("U4", U4, "operator stoplist / differential beside math",
         ((MATH, MATH), (TEXT, TEXT, TEXT), (MATH, MATH), (TEXT, TEXT, TEXT))),
        ("U5", U5, "[t,t,m,m,t] -> 3 segments",
         ((TEXT, MATH, TEXT), (2, 2, 1))),
        ("U6", U6, "assemble_source + spans",
         ("let \\(x^{2}\\) be", ((0, 3), (4, 13), (14, 16)), ("let", "\\(x^{2}\\)", "be"))),
        ("U7", U7, "normalize_operators on math only",
         ((TEXT, "the sine of", None), (MATH, None, "\\sin x"))),
        ("U8", U8, "no merge across lines; source has \\n",
         (2, (0, 1), "\\(x^{2}+1\\)\n\\(y^{2}+2\\)")),
        ("U9", U9, "chem=True: math -> \\ce{}, text untouched",
         ((("text", "Reaction", None), ("chem", None, "\\ce{2H2 + O2 -> 2H2O}")),
          (("text", None), ("math", "\\sqrt{x}")))),
        ("U10", U10, "assemble_source rejects \\( or \\) in math",
         ("raised", "raised", "ok")),
        ("U11", U11, "bucketed batching: 7 short + 1 long -> 2 buckets",
         ((7, 1), (8, 1), (8,), (32, 48, 144, 160))),
        ("U12", U12, "no Vision -> degraded math, caller stroke indices",
         ((("math", (0, 1, 3), 0, True), ("math", (4, 5), 1, True)),
          "\\(a+b\\)\n\\(c\\)", 0.4, "geometry", None)),
        ("U13", U13, "top-level confidence is min, not mean", ((0.9, 0.3), 0.3)),
        ("U14", U14, "a user override outranks the router", ((TEXT, TEXT), (2,))),
    ]

    ok = True
    for cid, fn, desc, want in cases:
        try:
            got = fn()
        except Exception as exc:  # a case that explodes is a failure, not a crash
            got = f"EXCEPTION {exc!r}"
        good = got == want
        ok = ok and good
        print(f"{'✓' if good else '✗'} {cid:4s} {desc}")
        if not good:
            print(f"        got  {got!r}\n        want {want!r}")

    raise SystemExit(0 if ok else 1)
