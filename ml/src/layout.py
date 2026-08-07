r"""Pure-geometry ink layout: strokes -> pages -> lines -> runs.

This is the deterministic half of Ancha's segmenter. It owns EVERY threshold in
the recognition pipeline and states all of them in x-height units, so one set
of numbers covers a 132-dpi iPad, a trackpad and an InkML file whose device
range is 0..20000 (src/inkml.py:9-10 already warns that device ranges vary
wildly). It is the whole answer on a server without Apple Vision, and the
structural override everywhere else: vision_layout.py may propose word
boundaries, but a fraction bar or a big operator found HERE outranks them,
because Vision reads structured math confidently and wrongly (measured: the
MathWriting ink `\nabla I=(I_{x},I_{y})` came back as `'VI (I×I'` at line
confidence 1.000).

Purity is load-bearing:

  * no torch, no Vision, no I/O — numpy is the only import, so this module runs
    and self-tests on any box and `python -m src.layout` needs no checkpoint;

  * the `t` channel is NEVER read. Intra-symbol pen-lift gaps on real ink run to
    p95 877 ms and max 16.8 s: a user really does cross a `t` seventeen seconds
    and four words later. Grouping purely on geometry rejoins that cross with
    its stem for free, while any temporal tie-break would inject order
    dependence into an otherwise pure function for no measured gain.

Two measurements shape the geometry and are easy to undo by accident:

  * **stroke bboxes are routinely zero-area.** 28 of the 51 strokes in the
    mixed reference fixture (block letters + real MathWriting ink) have zero
    width or zero height — `E`/`T` bars, `=`, `-`, i-dots, fraction rules. Area
    overlap therefore claims 23/51 strokes where point containment claims 51/51,
    so stroke->box assignment goes through `frac_points_in` and never through
    an IoU; and the x-height estimator has to drop the flat strokes before
    taking its percentile or it measures noise (`xheight`, the 0.20*hmax filter,
    without which one probe produced a 60104x6480 render and 0 observations).

  * **gaps are measured on stroke extents, never on Vision word boxes.** Vision
    pads its boxes: on that same fixture the inter-box gaps were 0.164 / 0.163 /
    0.164 xh while the true ink gaps were 0.85 and 0.70 xh. Box gaps carry no
    distance information at all, so `extent_gap` recomputes from the raw points
    and is the only gap a caller should compare against a threshold.

Pipeline (`segment_geometric`):

    page bands  strokes are partitioned by `page_breaks` FIRST, so no line can
                ever span a page break;
    clusters    union-find on (xgap <= 0.15 xh AND ygap <= 0.80 xh) -> glyph
                blobs. Calibrated on MathWriting's 3115 multi-stroke symbols:
                90.9% of same-symbol pairs merged, 7.3% cross-symbol. The ygap
                term costs 3 points of recall and is mandatory — without it a
                fraction bar merges with whatever it x-overlaps on the line
                ABOVE. i-dots, t-crosses, `=`, `j` and `!` need no special case;
    lines       single-linkage union-find on vertical overlap between core-height
                clusters (transitive, so two words at opposite ends of a line
                link through the words between them), then fraction bars and
                tall spanners union the lines they straddle so a stacked
                fraction or a Sigma-with-bounds stays ONE decode unit;
    runs        a left-to-right sweep cutting at gaps > 1.00 xh, then orphan
                attachment, structural merges and an over-wide resplit.

The run-split threshold is deliberately loose. Adjacent-cluster gaps INSIDE
real math measure p50 0.386 / p90 0.820 / p95 0.998 xh — the same range as
prose word gaps — so no threshold separates the two classes. tau = 1.00 xh
splits ~5% of intra-math gaps spuriously and unified.py repairs every one of
them by merging adjacent same-kind runs; the opposite error, gluing a word onto
a formula, is not repairable. Over-split, then merge.

Known trade-off worth stating: a wide flat stroke inside a run (>= 1.50 xh wide,
<= 0.25 xh tall) is read as a vinculum and marks the run `spanning`, which the
router treats as structural math. An UNDERLINED word trips that. Structure
outranking lexical evidence is the deliberate ruling; the per-segment kind
toggle in the UI is the escape hatch.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 ; y grows DOWN

# Above this many strokes `cluster_strokes` stops testing all pairs and sweeps a
# forward window instead. The two paths are provably equivalent (see the proof
# at the break statement), so the threshold only decides where the cost changes
# from O(n^2) to O(n log n) — a full A4 ink page carries 400-800 strokes.
SWEEP_MIN_N = 400

# Where a rule picks the BEST of several candidates, an exact tie is not exotic:
# a tall bracket written between two lines overlaps both bands by precisely the
# same amount. Comparing the raw floats then lets the last bit decide, and the
# last bit is not scale-invariant — the same ink at a different zoom picks the
# other line. Reproduced at the L15 sweep on wholly ordinary geometry (a 100.3
# unit band at 307 unit pitch flips between x0.37 and x7.3), so every tie-break
# below compares an x-height-relative LENGTH rounded to 1e-9: eight orders finer
# than the finest threshold here (0.15 xh), and several orders coarser than the
# last-bit noise it is there to absorb. Nothing else changes — only that the
# documented fallback (nearest baseline, then lowest index) is what settles a tie
# rather than whichever candidate happened to round down.
#
# Only differences may be quantized this way. An absolute coordinate carries the
# page offset (a stroke at x = 1e5 has no significant digits left at 1e-9 xh), so
# orderings keyed on raw positions get an integer final key instead.
_TIE_DIGITS = 9


def _rel(length: float, unit: float) -> float:
    """A length in `unit`s, quantized so a tie stays a tie after rescaling."""
    return round(length / max(unit, 1e-12), _TIE_DIGITS)


@dataclass(frozen=True)
class LayoutParams:
    """Every geometric threshold, in x-height units (except the two fractions).

    Nothing downstream may hard-code a distance: an absolute pixel anywhere in
    the pipeline is a device-dependence bug.
    """

    cluster_xgap: float = 0.15  # xh — union-find merge (90.9% same-symbol / 7.3% cross)
    cluster_ygap: float = 0.80  # xh — mandatory; without it a bar merges with the line above
    line_overlap: float = 0.35  # fraction of the SMALLER core height
    core_lo: float = 0.50  # xh — core-glyph height band; only these seed lines
    core_hi: float = 2.50  # xh — (excludes scripts, bars, \int, tall delimiters)
    span_tall: float = 2.00  # xh — \sum, \int, \sqrt, big delimiters
    span_reach: float = 1.50  # xh — how far a spanner may reach out of its own band
    bar_wide: float = 1.50  # xh — fraction-bar min width
    bar_flat: float = 0.25  # xh — fraction-bar max height
    run_tau: float = 1.00  # xh — geometric run split (NO-VISION path only)
    claim_frac: float = 0.60  # fraction of a stroke's POINTS inside a word box
    claim_pad: float = 0.15  # xh — containment pad
    orphan_pad: float = 0.25  # xh — R1: how far outside a run an orphan may sit
    orphan_dy: float = 1.60  # xh — R1: max y-centre distance (scripts sit at 0.35-0.45 H)
    resplit_tau: float = 1.20  # xh — R4: internal gap that re-splits an assigned run


@dataclass(frozen=True)
class Cluster:
    """A glyph-ish blob: strokes that are almost certainly one written symbol."""

    box: Box
    strokes: tuple[int, ...]


@dataclass
class Run:
    """A decode unit candidate: one horizontal group of strokes within a line.

    Mutable on purpose — unified.py's router writes `kind` in place, and the
    smoothing pass rewrites it again.
    """

    strokes: list[int]
    box: Box
    line: int
    vision_word: str | None = None
    vision_range: tuple[int, int] | None = None
    spanning: bool = False  # a vinculum or big operator lives here -> structural math
    kind: str | None = None  # "text" | "math" | "chem", filled in by unified.py
    forced: bool = False  # the user overrode this run's kind; smoothing must not touch it


@dataclass
class Line:
    """One text line. `xh` is measured over THIS line's strokes, so a small
    annotation line is thresholded in its own units rather than the page's."""

    index: int
    box: Box
    xh: float
    runs: list[Run]
    vision_conf: float | None = None
    vision_text: str | None = None
    page: int = 0


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------


def _interval_gap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Signed gap between two closed intervals; NEGATIVE when they overlap
    (and then its magnitude is the overlap length)."""
    return max(a0, b0) - min(a1, b1)


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Overlap length, clamped at 0."""
    return max(0.0, -_interval_gap(a0, a1, b0, b1))


def _cx(b: Box) -> float:
    return 0.5 * (b[0] + b[2])


def _cy(b: Box) -> float:
    return 0.5 * (b[1] + b[3])


def _union_box(boxes: Iterable[Box]) -> Box:
    bs = list(boxes)
    return (
        min(b[0] for b in bs),
        min(b[1] for b in bs),
        max(b[2] for b in bs),
        max(b[3] for b in bs),
    )


class _DSU:
    """Union-find. Every grouping in this module is single-linkage, which is
    what makes the output order-independent: no matter which pair is tested
    first, the transitive closure is the same."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]  # path halving
            i = self.parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self.parent[max(ri, rj)] = min(ri, rj)  # smallest index wins -> deterministic roots

    def groups(self, members: Sequence[int] | None = None) -> list[list[int]]:
        """Members grouped by root, each group ascending, groups ordered by
        their smallest member."""
        out: dict[int, list[int]] = {}
        for i in range(len(self.parent)) if members is None else members:
            out.setdefault(self.find(i), []).append(i)
        return [sorted(g) for _, g in sorted(out.items())]


def stroke_boxes(strokes: Sequence[dict]) -> list[Box]:
    """One axis-aligned box per stroke, INDEX-ALIGNED with `strokes`.

    Index alignment is a contract, not a convenience: a segment reports
    `strokes: [int]` back to the client and those integers must index the
    request array. A point-less stroke keeps its slot with a degenerate box at
    the origin; `segment_geometric` skips it rather than letting a phantom
    point at (0,0) drag a cluster across the page.
    """
    out: list[Box] = []
    for s in strokes:
        xs, ys = s["x"], s["y"]
        if not xs:
            out.append((0.0, 0.0, 0.0, 0.0))
            continue
        out.append((float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))))
    return out


def xheight(boxes: Sequence[Box]) -> float:
    """Estimated x-height: the 60th percentile of stroke heights, AFTER dropping
    everything shorter than 0.20 of the tallest stroke.

    The filter is not optional. Handwritten ink is full of zero-height strokes
    (the bars of `E`, `T`, `=`, `-`, i-dots, fraction rules: 28 of 51 strokes in
    the reference fixture), and an unfiltered percentile reads those as the
    typical glyph size — on that fixture the naive estimator returns 38 where
    the truth is 100. Every threshold in this module is a multiple of this
    number, so a 2.6x error is a different algorithm.

    Scale-equivariant by construction (a percentile of scaled heights is the
    scaled percentile), which is what makes the thresholds device-independent.
    The 1e-6 floor only fires on ink with no vertical extent at all — a row of
    dashes — where there is no x-height to estimate and the caller gets
    per-stroke runs instead of a crash.
    """
    if not boxes:
        return 1e-6
    hs = np.array([b[3] - b[1] for b in boxes], dtype=float)
    keep = hs[hs > 0.20 * float(hs.max())]
    if keep.size == 0:  # perfectly flat ink: nothing to filter, use it all
        keep = hs
    return max(float(np.percentile(keep, 60)), 1e-6)


def frac_points_in(s: dict, b: Box, pad: float) -> float:
    """Fraction of a stroke's sampled POINTS inside box `b` (padded by `pad`).

    This is the stroke->word-box assignment, and it is points rather than box
    overlap because more than half of all strokes have a zero-area bounding box:
    any area-based measure scores them 0 and silently drops i-dots, minus signs
    and fraction rules. Measured on the mixed fixture: containment claims 51/51
    strokes, area overlap 23/51.
    """
    xs, ys = s["x"], s["y"]
    if not xs:
        return 0.0
    x0, y0, x1, y1 = b
    n = 0
    for x, y in zip(xs, ys):
        if x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad:
            n += 1
    return n / len(xs)


def extent_gap(a: Run, b: Run, strokes: Sequence[dict], xh: float) -> float:
    """Horizontal gap between two runs measured on their STROKE EXTENTS, in
    units of `xh`; 0.0 when they touch, overlap or interleave.

    Recomputed from the raw points rather than read off `Run.box`, because a run
    that came from a Vision word box may be carrying Vision's padded geometry —
    and Vision pads uniformly, so its box gaps are a constant (~0.164 xh on the
    reference fixture) regardless of the true gap (0.85 xh and 0.70 xh there).
    Comparing box gaps to a threshold converts the genuine word `BE` into math;
    this function is what keeps that from happening.

    `xh` is REQUIRED and has no default. Every threshold in this module is in
    x-height units, and a default of 1.0 would have handed a caller who forgot
    the argument raw device coordinates that silently never cross a 0.55
    threshold — the same class of device-dependence bug the units exist to
    prevent. Pass 1.0 explicitly to ask for raw units.
    """
    ax0, ax1 = _run_x_extent(a, strokes)
    bx0, bx1 = _run_x_extent(b, strokes)
    return max(0.0, _interval_gap(ax0, ax1, bx0, bx1)) / max(xh, 1e-12)


def _run_x_extent(r: Run, strokes: Sequence[dict]) -> tuple[float, float]:
    xs = [v for i in r.strokes for v in strokes[i]["x"]]
    if not xs:
        return (r.box[0], r.box[2])
    return (float(min(xs)), float(max(xs)))


# --------------------------------------------------------------------------
# clusters -> lines -> runs
# --------------------------------------------------------------------------


def cluster_strokes(
    boxes: Sequence[Box], xh: float, p: LayoutParams = LayoutParams()
) -> list[Cluster]:
    """Group strokes into glyph-ish blobs: merge i,j when the x-gap is
    <= 0.15 xh AND the y-gap is <= 0.80 xh (negative gap = overlapping).

    Both terms are required. x alone merges 93.9% of same-symbol pairs but also
    11.1% of cross-symbol pairs; adding y costs 3 points of recall (90.9%) and
    cuts the false merges to 7.3% — and, decisively, it is what stops a long `=`
    or a fraction rule from merging with whatever sits directly above it on the
    previous line. The residual over-merges are almost all script-to-base and
    numerator-to-denominator, which belong to the same run anyway.

    Cluster indices returned here index `boxes`, and clusters are ordered
    left-to-right (then top-to-bottom) so downstream output is stable.
    """
    n = len(boxes)
    if n == 0:
        return []
    xtol, ytol = p.cluster_xgap * xh, p.cluster_ygap * xh
    order = sorted(range(n), key=lambda i: (boxes[i][0], boxes[i][1], i))
    sweep = n > SWEEP_MIN_N
    dsu = _DSU(n)
    for a in range(n):
        i = order[a]
        for b in range(a + 1, n):
            j = order[b]
            # Sweep-line cutoff. `order` is ascending in x0, so boxes[j][0] only
            # grows with b; and the true x-gap is always >= boxes[j][0] - boxes[i][2].
            # Once that lower bound exceeds the tolerance, no later j can merge
            # with THIS i either — the break is exact, not an approximation.
            if sweep and boxes[j][0] - boxes[i][2] > xtol:
                break
            if (
                _interval_gap(boxes[i][0], boxes[i][2], boxes[j][0], boxes[j][2]) <= xtol
                and _interval_gap(boxes[i][1], boxes[i][3], boxes[j][1], boxes[j][3]) <= ytol
            ):
                dsu.union(i, j)
    clusters = [
        Cluster(_union_box([boxes[i] for i in g]), tuple(g)) for g in dsu.groups()
    ]
    clusters.sort(key=lambda c: (c.box[0], c.box[1], c.strokes[0]))
    return clusters


def _core_indices(clusters: Sequence[Cluster], xh: float, p: LayoutParams) -> list[int]:
    """Clusters whose height is in the core band — the ones allowed to seed a
    line. Scripts, bars, integrals and tall delimiters are excluded because they
    bridge lines by construction.

    Fallback: ink made ENTIRELY of out-of-band clusters (a row of rules, a lone
    dot, a page of nothing but integrals) still has to land somewhere, so with
    no cores at all every cluster seeds.
    """
    core = [
        i
        for i, c in enumerate(clusters)
        if p.core_lo * xh <= (c.box[3] - c.box[1]) <= p.core_hi * xh
    ]
    return core or list(range(len(clusters)))


def group_lines_geometric(
    clusters: Sequence[Cluster], xh: float, p: LayoutParams = LayoutParams()
) -> list[list[int]]:
    """Partition clusters into lines. Returns lists of CLUSTER indices, ordered
    top-to-bottom, each list ordered left-to-right.

    Core clusters seed lines by single-linkage union-find on vertical-interval
    overlap >= 0.35 * min(height). Single linkage rather than a sort-and-walk
    over y is the whole point: it is transitive along a line (two words at
    opposite ends link through the words between them) and order-independent,
    where a walk depends on the order it visits clusters and cannot bridge.

    Non-core clusters then attach to the line whose y-band they overlap most;
    ties (including the all-zero tie, which is where a superscript floating
    clear of every band lands) break on nearest baseline, then lowest line
    index, and the comparison is quantized (`_rel`) so that a bracket splitting
    two bands evenly resolves the same way at every zoom. The bands and
    baselines are frozen before any attachment so the result cannot depend on
    the order the orphans are processed either.
    """
    n = len(clusters)
    if n == 0:
        return []
    core = _core_indices(clusters, xh, p)
    core_set = set(core)

    dsu = _DSU(n)
    # O(core^2); core clusters are roughly a third of the strokes, and the test
    # is three float comparisons, so a full A4 page costs single-digit ms.
    for a in range(len(core)):
        i = core[a]
        hi = clusters[i].box[3] - clusters[i].box[1]
        for b in range(a + 1, len(core)):
            j = core[b]
            hj = clusters[j].box[3] - clusters[j].box[1]
            ov = _overlap(
                clusters[i].box[1], clusters[i].box[3], clusters[j].box[1], clusters[j].box[3]
            )
            if ov >= p.line_overlap * min(hi, hj):
                dsu.union(i, j)

    lines = [g for g in dsu.groups(core)]
    bands = [_union_box([clusters[i].box for i in g]) for g in lines]
    baselines = [float(np.median([clusters[i].box[3] for i in g])) for g in lines]

    for i in range(n):
        if i in core_set:
            continue
        box = clusters[i].box
        best = min(
            range(len(lines)),
            key=lambda li: (
                -_rel(_overlap(box[1], box[3], bands[li][1], bands[li][3]), xh),
                _rel(abs(_cy(box) - baselines[li]), xh),
                li,
            ),
        )
        lines[best].append(i)

    order = sorted(range(len(lines)), key=lambda li: (_cy(bands[li]), bands[li][0], li))
    return [sorted(lines[li], key=lambda i: (clusters[i].box[0], clusters[i].box[1], i)) for li in order]


def merge_spanning_lines(
    lines: Sequence[Sequence[int]],
    clusters: Sequence[Cluster],
    xh: float,
    p: LayoutParams = LayoutParams(),
) -> list[list[int]]:
    """Union the lines that a fraction bar or a tall spanner straddles.

    Two predicates, both structural:

      * a bar (w >= 1.50 xh, h <= 0.25 xh) with core clusters BOTH above and
        below inside its x-range — a stacked fraction;
      * a tall cluster (h >= 2.00 xh) reaching cores on >= 2 distinct lines
        — \\sum with bounds, \\int, \\sqrt, big delimiters.

    Without this a stacked fraction is three lines and decodes as three
    unrelated expressions; the joint-vs-per-line measurement that motivates
    per-line decoding cuts the other way here, because these strokes are ONE
    expression that merely occupies three bands.

    Both rules are capped at `span_reach` VERTICALLY, which is not cosmetic: a
    column test alone unions any two lines that happen to share an x-range, and
    on real stacked MathWriting pages that collapsed 8 of 10 four-line pages
    into one line (one 2.2 xh cluster on line 2 reaching lines 0 and 3 purely
    because they overlap in x). A spanner must physically get there. 1.50 xh
    covers every real bar->numerator/denominator distance measured on 400
    `\\frac` inks (p50 1.17, max 1.43) — and 398 of those 400 never reach this
    rule at all, because the cluster pass at 0.80 xh already joined them.
    """
    if not lines:
        return []
    line_of = {ci: li for li, g in enumerate(lines) for ci in g}
    core = set(_core_indices(clusters, xh, p))
    dsu = _DSU(len(lines))

    for ci, c in enumerate(clusters):
        x0, y0, x1, y1 = c.box
        w, h = x1 - x0, y1 - y0
        # "in its x-range" is a gap test, not an area test: a numerator written
        # as a bare `1` or `l` has a ZERO-WIDTH box, and any positive-overlap
        # formulation silently refuses to see it (that is the same pathology
        # that makes area-IoU claim 23/51 strokes).
        def _column(k: int) -> bool:
            return k != ci and _interval_gap(x0, x1, clusters[k].box[0], clusters[k].box[2]) <= 0.0

        def _ygap(k: int) -> float:
            return _interval_gap(y0, y1, clusters[k].box[1], clusters[k].box[3])

        if w >= p.bar_wide * xh and h <= p.bar_flat * xh:
            yc = _cy(c.box)
            above, below = set(), set()
            for k in core:
                # Strictly clear of the bar (a core straddling it is BESIDE the
                # fraction, not part of it) and close enough to be its own.
                if not _column(k) or not (0.0 < _ygap(k) <= p.span_reach * xh):
                    continue
                (above if _cy(clusters[k].box) < yc else below).add(line_of[k])
            if above and below:
                for li in above | below:
                    dsu.union(line_of[ci], li)
        if h >= p.span_tall * xh:
            # The spanner's OWN line counts, so `>= 2` reads as "it reaches a
            # band that is not its own" — a \sum whose upper bound became a
            # separate line has exactly one other line to pull in, not two.
            hit = {line_of[ci]} | {
                line_of[k] for k in core if _column(k) and _ygap(k) <= p.span_reach * xh
            }
            if len(hit) >= 2:
                for li in hit:
                    dsu.union(line_of[ci], li)

    merged = [sorted(ci for li in g for ci in lines[li]) for g in dsu.groups()]
    merged.sort(key=lambda g: (_cy(_union_box([clusters[ci].box for ci in g])), g[0]))
    return [
        sorted(g, key=lambda ci: (clusters[ci].box[0], clusters[ci].box[1], ci)) for g in merged
    ]


def _sweep_split(strokes: Sequence[dict], idx: Sequence[int], tau: float) -> list[list[int]]:
    """Left-to-right sweep over stroke x-extents, cutting where the gap to the
    running right edge exceeds `tau`. Shared by the run split and R4."""
    live = [i for i in idx if strokes[i]["x"]]
    if not live:
        return []
    ext = {i: (float(min(strokes[i]["x"])), float(max(strokes[i]["x"]))) for i in live}
    order = sorted(live, key=lambda i: (ext[i][0], i))
    out: list[list[int]] = [[order[0]]]
    reach = ext[order[0]][1]
    for i in order[1:]:
        if ext[i][0] - reach > tau:
            out.append([])
            reach = ext[i][1]
        out[-1].append(i)
        reach = max(reach, ext[i][1])
    return [sorted(g) for g in out]


def split_runs_geometric(
    strokes: Sequence[dict], idx: Sequence[int], xh: float, p: LayoutParams = LayoutParams()
) -> list[list[int]]:
    """Cut a line's strokes into runs at horizontal gaps > 1.00 xh.

    tau is the no-Vision boundary rule and it is deliberately conservative: real
    intra-math gaps reach p95 0.998 xh, so anything tighter shreds formulas that
    the fallback path has no lexical evidence to reassemble. Word gaps below
    1.00 xh are simply missed here — the reference fixture's genuine word gaps
    were 0.85 and 0.70 xh — which is exactly why Vision word boxes own the
    boundaries whenever Vision is available.

    A cut can never fall inside a cluster: every merge edge has x-gap <= 0.15 xh,
    so by connectivity each cluster member sits within 0.15 xh of the running
    right edge of the members before it, and 0.15 < tau.
    """
    return _sweep_split(strokes, idx, p.run_tau * xh)


def _clone(r: Run) -> Run:
    return Run(
        list(r.strokes), r.box, r.line, r.vision_word, r.vision_range, r.spanning, r.kind, r.forced
    )


def _rebox(r: Run, boxes: Sequence[Box]) -> Run:
    r.box = _union_box([boxes[i] for i in r.strokes])
    return r


def attach_orphans(
    strokes: Sequence[dict],
    runs: Sequence[Run],
    xh: float,
    p: LayoutParams = LayoutParams(),
    orphans: Sequence[int] = (),
) -> list[Run]:
    """R1-R4: fold loose strokes in, apply the structural merges, resplit.

    R1 containment — an unclaimed stroke whose x-range sits inside
       [run.x0 - 0.25 xh, run.x1 + 0.25 xh] with its y-centre within 1.60 xh of
       the run's attaches there (i-dots, t-crosses, umlauts, sub/superscripts,
       which ride at 0.35-0.45 H). Ties go to the run covering more of the
       stroke's width, then the nearer y-centre, then the lower index. A stroke
       that qualifies nowhere still has to land somewhere, so it joins the
       nearest run by centre distance — a stroke may never be dropped.
       `orphans` is empty on the geometric path, where the run split already
       accounts for every stroke; it carries the leftovers from `claim_by_boxes`.
    R2 bars — a vinculum inside a run marks it `spanning`; if it also covers
       more than half the width of other runs, those runs merge into it.
    R3 spanners — a stroke >= 2.00 xh tall defines an x-span; every run it
       intersects merges, which is what keeps `\\sum` with its bounds and
       `\\sqrt` with everything under the rule in one decode unit.
    R4 over-wide — an internal gap > 1.20 xh re-splits an assigned run, the
       guard against one Vision word box straddling a text/math boundary.
       Runs flagged `spanning` are exempt: R2/R3 merged them ON PURPOSE and a
       fraction's numerator legitimately sits 2 xh from its denominator's start.

    Never mutates the caller's runs.
    """
    boxes = stroke_boxes(strokes)
    out = [_clone(r) for r in runs]
    line = runs[0].line if runs else 0

    # ---- R1 containment
    for i in orphans:
        if not strokes[i]["x"]:
            continue
        b = boxes[i]
        w = max(b[2] - b[0], 1e-9)
        inside = [
            k
            for k, r in enumerate(out)
            if r.box[0] - p.orphan_pad * xh <= b[0]
            and b[2] <= r.box[2] + p.orphan_pad * xh
            and abs(_cy(b) - _cy(r.box)) <= p.orphan_dy * xh
        ]
        if inside:
            k = min(
                inside,
                key=lambda k: (
                    -_rel(_overlap(b[0], b[2], out[k].box[0], out[k].box[2]), w),
                    _rel(abs(_cy(b) - _cy(out[k].box)), xh),
                    k,
                ),
            )
        elif out:
            k = min(
                range(len(out)),
                key=lambda k: (
                    _rel(abs(_cx(b) - _cx(out[k].box)) + abs(_cy(b) - _cy(out[k].box)), xh),
                    k,
                ),
            )
        else:
            out.append(Run([i], b, line))
            continue
        out[k].strokes.append(i)
        _rebox(out[k], boxes)

    # ---- R2 bars / R3 spanners
    dsu = _DSU(len(out))
    spanning: set[int] = set()
    for k, r in enumerate(out):
        for i in r.strokes:
            x0, y0, x1, y1 = boxes[i]
            w, h = x1 - x0, y1 - y0
            is_bar = w >= p.bar_wide * xh and h <= p.bar_flat * xh
            is_tall = h >= p.span_tall * xh
            if not (is_bar or is_tall):
                continue
            spanning.add(k)
            hit = {k}
            for k2, r2 in enumerate(out):
                if k2 == k:
                    continue
                # Reaching a run is a gap test (a run can be one zero-width
                # stroke); a bar additionally has to DOMINATE its neighbour,
                # covering at least half that run's width, before it swallows it.
                if _interval_gap(x0, x1, r2.box[0], r2.box[2]) > 0.0:
                    continue
                ov = _overlap(x0, x1, r2.box[0], r2.box[2])
                if is_tall or ov >= 0.5 * (r2.box[2] - r2.box[0]):
                    hit.add(k2)
            if len(hit) >= 2:
                spanning |= hit
                for k2 in hit:
                    dsu.union(k, k2)

    merged: list[Run] = []
    for g in dsu.groups():
        # The widest member keeps the Vision word: after a structural merge the
        # run is math by rule C1 anyway, but the string stays available for the
        # client-side math->text flip.
        lead = max(g, key=lambda k: (_rel(out[k].box[2] - out[k].box[0], xh), -k))
        r = _clone(out[lead])
        r.strokes = sorted(i for k in g for i in out[k].strokes)
        r.spanning = any(k in spanning for k in g)
        merged.append(_rebox(r, boxes))

    # ---- R4 over-wide resplit
    final: list[Run] = []
    for r in merged:
        pieces = [] if r.spanning else _sweep_split(strokes, r.strokes, p.resplit_tau * xh)
        if len(pieces) <= 1:
            final.append(r)
            continue
        lead = max(range(len(pieces)), key=lambda k: (len(pieces[k]), -k))
        for k, piece in enumerate(pieces):
            q = _clone(r)
            q.strokes = piece
            if k != lead:  # the word Vision read spans the cut; only one side may claim it
                q.vision_word, q.vision_range = None, None
            final.append(_rebox(q, boxes))

    final.sort(key=lambda r: (r.box[0], r.box[1], r.strokes[0]))
    return final


def claim_by_boxes(
    strokes: Sequence[dict],
    idx: Sequence[int],
    boxes: Sequence[Box],
    xh: float,
    p: LayoutParams = LayoutParams(),
) -> tuple[dict[int, int], list[int]]:
    """Assign strokes to externally supplied boxes (Vision word boxes, mapped
    into stroke space) by point containment.

    Returns `({stroke index: box index}, [unclaimed stroke indices])`. A stroke
    goes to the box holding the largest fraction of its points, provided that
    fraction reaches `claim_frac`; ties keep the earlier box. Measured on the
    mixed fixture: 51/51 strokes claimed and every box 100% pure against ground
    truth, where an area test claims 23/51 — see `frac_points_in`.
    """
    pad = p.claim_pad * xh
    assign: dict[int, int] = {}
    unclaimed: list[int] = []
    for i in idx:
        best_b, best_f = -1, 0.0
        for bi, b in enumerate(boxes):
            f = frac_points_in(strokes[i], b, pad)
            if f >= p.claim_frac and f > best_f:
                best_b, best_f = bi, f
        if best_b >= 0:
            assign[i] = best_b
        else:
            unclaimed.append(i)
    return assign, unclaimed


def _page_bands(
    boxes: Sequence[Box], live: Sequence[int], page_breaks: Sequence[float]
) -> list[list[int]]:
    """Partition strokes into page bands by their y-centre.

    Done BEFORE any grouping, which is the only way to guarantee that no line
    ever spans a page break: filtering lines afterwards would have to cut a
    line that the geometry already declared whole. A stroke drawn across the
    seam belongs to the page holding its centre — it stays intact, and a centre
    lying exactly ON a break goes to the page BELOW it: `bisect_right` sends
    `cy == break` to the higher band index. Ties have to fall somewhere and
    either side is defensible; what matters is that the rule is stated, because
    the client renders page boundaries and a stroke that changes page between
    two identical requests reads as data loss.
    """
    breaks = sorted(float(b) for b in page_breaks)
    bands: list[list[int]] = [[] for _ in range(len(breaks) + 1)]
    for i in live:
        bands[bisect.bisect_right(breaks, _cy(boxes[i]))].append(i)
    return bands


def segment_geometric(
    strokes: Sequence[dict],
    p: LayoutParams = LayoutParams(),
    page_breaks: Sequence[float] = (),
) -> list[Line]:
    """Strokes -> lines of runs, using nothing but geometry.

    This is the complete no-Vision path and the skeleton the Vision path
    refines. Every non-empty stroke appears in exactly one run of exactly one
    line, and `Line.page` / `Line.index` are assigned in reading order (pages
    top to bottom, lines top to bottom within a page).
    """
    boxes = stroke_boxes(strokes)
    live = [i for i, s in enumerate(strokes) if s["x"]]
    if not live:
        return []

    out: list[Line] = []
    for page, band in enumerate(_page_bands(boxes, live, page_breaks)):
        if not band:
            continue
        xh_page = xheight([boxes[i] for i in band])
        # cluster_strokes indexes the list it is handed; map back to stroke ids.
        local = cluster_strokes([boxes[i] for i in band], xh_page, p)
        clusters = [Cluster(c.box, tuple(band[j] for j in c.strokes)) for c in local]
        lines = merge_spanning_lines(
            group_lines_geometric(clusters, xh_page, p), clusters, xh_page, p
        )
        for group in lines:
            idx = sorted(i for ci in group for i in clusters[ci].strokes)
            # Per-line x-height: a small annotation under a formula is measured
            # in its own units, not the page's.
            xh_line = xheight([boxes[i] for i in idx])
            runs = [
                Run(g, _union_box([boxes[i] for i in g]), len(out))
                for g in split_runs_geometric(strokes, idx, xh_line, p)
            ]
            runs = attach_orphans(strokes, runs, xh_line, p)
            for r in runs:
                r.line = len(out)
            out.append(
                Line(
                    index=len(out),
                    box=_union_box([boxes[i] for i in idx]),
                    xh=xh_line,
                    runs=runs,
                    page=page,
                )
            )
    return out


# --------------------------------------------------------------------------
# self-test  (repo convention: gated __main__, cases list, exit code)
# --------------------------------------------------------------------------

if __name__ == "__main__":
    P = LayoutParams()

    def seg(x0: float, y0: float, x1: float, y1: float, t0: int = 0) -> dict:
        """Two-point stroke. `t` is filled in but NOTHING reads it — L3 exists
        to keep it that way."""
        return {"x": [float(x0), float(x1)], "y": [float(y0), float(y1)], "t": [t0, t0 + 80]}

    def dot(x: float, y: float) -> dict:
        return {"x": [float(x)], "y": [float(y)], "t": [0]}

    def vbar(x: float, y: float, h: float) -> dict:
        """A vertical stroke of height h at x — the generic 'glyph' of these
        fixtures (zero width, like a real `I`/`l`/stem, which also keeps the
        zero-area-bbox pathology in the picture)."""
        return seg(x, y, x, y + h)

    def gly(x: float, y: float, w: float, h: float) -> dict:
        """A diagonal stroke filling the box (x,y,x+w,y+h): non-zero area."""
        return seg(x, y, x + w, y + h)

    # Block letters, ported from the design-phase probe (verify_vision.py) so the
    # L16/L18 fixture is the same geometry that was measured against Vision.
    _F = {
        "L": [(0, 0, 0, 1), (0, 1, 1, 1)],
        "E": [(0, 0, 0, 1), (0, 0, 1, 0), (0, 0.5, 0.8, 0.5), (0, 1, 1, 1)],
        "T": [(0, 0, 1, 0), (0.5, 0, 0.5, 1)],
        "B": [(0, 0, 0, 1), (0, 0, 0.9, 0.25), (0, 0.5, 0.9, 0.5), (0, 0.5, 0.9, 0.75), (0, 1, 0.9, 1)],
        "R": [(0, 0, 0, 1), (0, 0, 0.9, 0), (0.9, 0, 0.9, 0.5), (0, 0.5, 0.9, 0.5), (0, 0.5, 0.9, 1)],
        "U": [(0, 0, 0, 1), (0, 1, 1, 1), (1, 0, 1, 1)],
    }

    def letters(word: str, x0: float, y0: float, h: float, space: float = 4.0):
        """Block letters at w = 0.55h, gap 0.25h. `space` is the word gap in
        units of that letter gap: the probe used 3 (giving a 1.00 xh gap, exactly
        the run-split threshold), and 4 is used here purely to keep the fixture
        off the knife edge so the scale sweep in L15 cannot flip it."""
        out, x, w, g = [], float(x0), h * 0.55, h * 0.25
        for ch in word:
            if ch == " ":
                x += g * space
                continue
            for (a, b, c, d) in _F[ch]:
                out.append(seg(x + a * w, y0 + b * h, x + c * w, y0 + d * h))
            x += w + g
        return out, x

    def math_blob(x0: float, x1: float, yc: float, hmax: float):
        """20 strokes standing in for the real MathWriting ink `\\nabla
        I=(I_{x},I_{y})` in the reference fixture. Heights are chosen so the
        whole fixture's filtered 60th percentile is exactly the block-letter
        height (the measured xh = 100.0), and every stroke has non-zero area,
        matching the real ink's 0/20 zero-area count."""
        hs = [hmax, hmax * 0.5, hmax * 0.5] + [hmax * 0.31] * 3 + [hmax * 0.15] * 7 + [hmax * 0.08] * 7
        w = (x1 - x0) / len(hs)
        return [gly(x0 + k * w, yc - h / 2, w, h) for k, h in enumerate(hs)]

    def xform(strokes, k: float, dx: float, dy: float):
        return [
            {"x": [v * k + dx for v in s["x"]], "y": [v * k + dy for v in s["y"]], "t": list(s["t"])}
            for s in strokes
        ]

    def retime(strokes, f):
        """The same ink with different pen timings: `t` is rewritten from each
        stroke's INDEX by `f`, and not one coordinate moves. Any answer that
        differs between a fixture and its retimings has read the clock."""
        return [
            {
                "x": list(s["x"]),
                "y": list(s["y"]),
                "t": [f(i) + j for j in range(len(s["x"]))],
            }
            for i, s in enumerate(strokes)
        ]

    # Four timings no hand could have produced: simultaneous, backwards, scrambled,
    # and 100 s between neighbours. Real intra-symbol pen lifts run to p95 877 ms
    # and max 16.8 s, so a temporal rule calibrated on anything plausible returns a
    # different partition on at least one of these — which is what makes
    # "t-invariant" a claim with teeth rather than a fixture that never varies.
    TIMINGS = (
        lambda i: 0,
        lambda i: -5000 * i,
        lambda i: (i * 7919) % 1009,
        lambda i: 100_000 * i,
    )

    def clusters_of(strokes, p=P):
        boxes = stroke_boxes(strokes)
        return tuple(c.strokes for c in cluster_strokes(boxes, xheight(boxes), p))

    def sig(lines):
        """Scale-invariant signature of a segmentation: the page/line/run
        partition plus the spanning flags. This is what L15 compares."""
        return tuple(
            (ln.page, ln.index, tuple((tuple(r.strokes), r.spanning) for r in ln.runs))
            for ln in lines
        )

    # ---------------- cases: each returns a scale-invariant signature -------

    def L1(k, dx, dy):
        """xheight: 4 glyphs of known height + 6 zero-height bars. The filtered
        estimate must be the glyph height; the naive one is 2.6x off."""
        s = [vbar(0, 0, 100), vbar(200, 0, 100), vbar(400, 0, 95), vbar(600, 0, 105)]
        s += [seg(x, 300, x + 80, 300) for x in (0, 150, 300, 450, 600, 750)]
        s = xform(s, k, dx, dy)
        hs = np.array([b[3] - b[1] for b in stroke_boxes(s)], float)
        naive = float(np.percentile(hs, 60))
        got = xheight(stroke_boxes(s))
        return (round(got / k, 6), round(naive / k, 6), abs(got - 100 * k) <= 0.05 * 100 * k)

    def L2(k, dx, dy):
        """`i`: stem + dot 0.3 xh above -> one cluster."""
        return clusters_of(xform([vbar(0, 0, 100), dot(0, -30)], k, dx, dy))

    def L3(k, dx, dy):
        """`t`: the cross is drawn LAST, after three other glyphs, 9999 ms later.
        Purely spatial grouping rejoins it with the stem; reading `t` would not."""
        s = [vbar(0, 0, 100), vbar(200, 0, 100), vbar(400, 0, 100), vbar(600, 0, 100)]
        s.append(seg(-20, 30, 40, 30, t0=9999))
        return clusters_of(xform(s, k, dx, dy))

    def L4(k, dx, dy):
        """`x = y`: the two bars of `=`, 0.2 xh apart, are one cluster (and the
        surrounding glyphs are what give the fixture an x-height at all)."""
        s = [vbar(0, 0, 100), seg(100, 40, 160, 40), seg(100, 60, 160, 60), vbar(220, 0, 100)]
        return clusters_of(xform(s, k, dx, dy))

    def _three_lines(pitch: float):
        """Three lines of six glyphs: four x-height, one descender (0.3 xh below
        the baseline), one ascender (0.6 xh above the x-line) — the collision
        pair that decides where line separation breaks down. Columns are
        staggered between adjacent lines because two glyphs in the SAME column
        at 1.6 xh pitch sit only 0.6 xh apart vertically and would cluster."""
        s = []
        for li in range(3):
            b = li * pitch
            off = 40 if li == 1 else 0
            for c, x in enumerate((0, 80, 160, 240, 320, 400)):
                if c == 1:
                    s.append(vbar(x + off, b - 100, 130))  # descender
                elif c == 4:
                    s.append(vbar(x + off, b - 160, 160))  # ascender
                else:
                    s.append(vbar(x + off, b - 100, 100))
        return s

    def L5(k, dx, dy):
        """Line pitch 2.6 / 2.0 / 1.6 xh -> an exact three-way partition."""
        return tuple(
            sig(segment_geometric(xform(_three_lines(pitch), k, dx, dy), P))
            for pitch in (260, 200, 160)
        )

    def L6(k, dx, dy):
        """Pitch 1.3 xh -> the documented failure: a descender and the ascender
        below it overlap by 0.6 xh, single linkage merges all three lines. Pinned
        so a threshold change cannot alter it silently."""
        return sig(segment_geometric(xform(_three_lines(130), k, dx, dy), P))

    def L7(k, dx, dy):
        """Stacked fraction: numerator, a 3 xh rule, denominator -> ONE line,
        ONE run, spanning. Numerator and denominator sit 1.2 xh clear of the
        rule: past the 0.80 xh cluster threshold, so the cluster pass leaves
        three separate bands and merge_spanning_lines is what has to join them,
        and inside the 1.43 xh worst case measured on real `\\frac` ink.
        The next line down shares the rule's columns and is 5.2 xh below it: a
        bar reaches its own numerator and denominator, never the page."""
        s = [vbar(20, -220, 100), vbar(120, -220, 100), vbar(220, -220, 100)]
        s.append(seg(0, 0, 300, 0))
        s += [vbar(60, 120, 100), vbar(200, 120, 100)]
        s += [vbar(60, 520, 100), vbar(200, 520, 100)]
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    def L8(k, dx, dy):
        """`\\sum` at 3 xh with bounds above and below plus a trailing
        expression -> one line, one run, spanning."""
        s = [gly(0, -150, 120, 300)]  # the big operator
        s += [gly(20, -230, 60, 55), gly(20, 175, 60, 55)]  # bounds
        s += [vbar(x, -50, 100) for x in (170, 260, 350, 440)]  # trailing expression
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    def L9(k, dx, dy):
        """base + subscript (0.55 scale, 0.35 H below the baseline) -> one run."""
        s = [gly(0, -100, 60, 100), gly(65, -20, 33, 55)]
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    def L10(k, dx, dy):
        """base + superscript (0.55 scale, 0.45 H above) -> one run."""
        s = [gly(0, -100, 60, 100), gly(65, -145, 33, 55)]
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    def L11(k, dx, dy):
        """Two glyphs 0.4 xh apart -> one run; 1.6 xh apart -> two."""
        near = [vbar(0, 0, 100), vbar(40, 0, 100)]
        far = [vbar(0, 0, 100), vbar(160, 0, 100)]
        return (
            sig(segment_geometric(xform(near, k, dx, dy), P)),
            sig(segment_geometric(xform(far, k, dx, dy), P)),
        )

    def L12(k, dx, dy):
        """An internal 1.4 xh gap splits a run — through the geometric sweep,
        and through R4 when a single (Vision-shaped) run is handed in whole."""
        s = xform([vbar(0, 0, 100), vbar(60, 0, 100), vbar(260, 0, 100)], k, dx, dy)
        boxes = stroke_boxes(s)
        whole = Run([0, 1, 2], _union_box(boxes), 0, vision_word="ab")
        r4 = attach_orphans(s, [whole], xheight(boxes), P)
        return (
            sig(segment_geometric(s, P)),
            tuple((tuple(r.strokes), r.vision_word) for r in r4),
        )

    def L13(k, dx, dy):
        """Degenerate ink: three dashes with no vertical extent at all, a lone
        dot, and nothing. No crash, no division by zero, xh stays positive.

        The dashes come back flagged `spanning`, which is the honest answer: with
        no x-height in the ink there is no scale against which a rule is 'wide',
        so every rule reads as a vinculum. Documented rather than special-cased —
        the caller sees three separate runs and a positive xh, not an exception."""
        dashes = xform([seg(0, 0, 100, 0), seg(150, 0, 250, 0), seg(300, 0, 400, 0)], k, dx, dy)
        one = xform([dot(0, 0)], k, dx, dy)
        return (
            xheight(stroke_boxes(dashes)) > 0.0,
            sig(segment_geometric(dashes, P)),
            sig(segment_geometric(one, P)),
            segment_geometric([], P),
            cluster_strokes([], 1.0, P),
            xheight([]) > 0.0,
        )

    def L14(k, dx, dy):
        """Two strokes that overlap vertically by 0.5 xh — one line without a
        page break, two lines (pages 0 and 1) with one between them."""
        s = xform([gly(0, 1050, 60, 100), gly(120, 1100, 60, 100)], k, dx, dy)
        brk = 1123 * k + dy
        return (sig(segment_geometric(s, P)), sig(segment_geometric(s, P, page_breaks=(brk,))))

    def _fixture():
        """The mixed reference line: block `LET`, then math ink, then `BE TRUE`
        — the same geometry the Vision probe measured (51 strokes, 28 of them
        zero-area, xh = 100.0, ink gaps 0.85 xh and 0.70 xh)."""
        w1, x = letters("LET", 0, 0, 100)
        mth = math_blob(x + 60, x + 560, 50, 130)
        w2, _ = letters("BE TRUE", x + 560 + 70, 0, 100)
        return w1, mth, w2

    def L16(k, dx, dy):
        """extent_gap on the reference geometry returns the TRUE ink gaps,
        0.85 xh and 0.70 xh, from runs whose BOXES carry Vision's padding.

        The runs here are inflated by 0.40 xh on every side — the 40 units the
        Vision probe measured on exactly this geometry — because that is the
        state a run arrives in on the Vision path, and it is the only state in
        which box-gap math and extent math disagree. They disagree completely:
        the same two boundaries read 0.05 xh and 0.00 xh off the boxes, i.e. the
        padding has eaten the entire signal and the genuine word `BE` would
        convert to math on a 0.55 xh test. Build this fixture with un-padded
        boxes (as an earlier revision did) and reading `Run.box` inside
        `extent_gap` passes the case — the pin is the padding.

        Both TRUE gaps are still below run_tau, so the no-Vision path cannot
        recover these boundaries at all; the last element says so.
        """
        w1, mth, w2 = _fixture()
        s = xform(w1 + mth + w2, k, dx, dy)
        n1, n2 = len(w1), len(w1) + len(mth)
        boxes = stroke_boxes(s)
        xh = xheight(boxes)
        pad = 0.40 * xh  # Vision's uniform word-box inflation, in stroke space

        def mk(ids):
            x0, y0, x1, y1 = _union_box([boxes[i] for i in ids])
            return Run(list(ids), (x0 - pad, y0 - pad, x1 + pad, y1 + pad), 0)

        def box_gap(p, q):  # what a caller reading Run.box would compare
            return round(max(0.0, _interval_gap(p.box[0], p.box[2], q.box[0], q.box[2])) / xh, 6)

        a, b, c = mk(range(n1)), mk(range(n1, n2)), mk(range(n2, len(s)))
        return (
            round(xh / k, 6),
            round(extent_gap(a, b, s, xh), 6),
            round(extent_gap(b, c, s, xh), 6),
            (box_gap(a, b), box_gap(b, c)),
            round(extent_gap(a, b, s, 1.0) / xh, 6),  # xh=1.0 == raw coordinate units
            sig(segment_geometric(s, P)),
        )

    def L21(k, dx, dy):
        """attach_orphans on the Vision path: strokes no word box claimed.

        The i-dot sits at the far END of a wide run and just past its edge, so
        the nearest run by centre distance is the WRONG one — only R1's
        containment window puts it back on the word it belongs to. The stray
        glyph two pages away qualifies nowhere and is still not dropped: it
        joins the nearest run and R4 then separates it again on the 18 xh gap.
        Every stroke ends in exactly one run, which is the invariant serve.py's
        `strokes: [int]` contract rests on."""
        s = xform(
            [gly(0, 0, 400, 100), gly(500, 0, 20, 100), gly(395, -40, 10, 10),
             gly(2000, 500, 60, 100)], k, dx, dy)
        boxes = stroke_boxes(s)
        runs = [Run([0], boxes[0], 0), Run([1], boxes[1], 0)]
        out = attach_orphans(s, runs, xheight(boxes), P, orphans=(2, 3))
        return tuple(tuple(r.strokes) for r in out)

    def L20(k, dx, dy):
        """A 2.2 xh glyph on line 0 sharing a COLUMN with line 1, 2.0 xh below
        it, must not union the two lines.

        Sharing an x-range is not reaching: on real stacked MathWriting pages a
        column-only spanner rule collapsed 8 of 10 four-line pages into one.
        The spanner has to physically get to the other band (`span_reach`)."""
        s = [gly(x, -100, 60, 100) for x in (0, 150, 300)]
        s += [gly(440, -220, 60, 220)]  # tall: same column as line 1 below
        s += [gly(x, 200, 60, 100) for x in (0, 150, 300, 440)]
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    def L19(k, dx, dy):
        """A 0.6 xh annotation off to the side, 0.1 xh lower, is its OWN line —
        and is then measured in its own x-height (60, not the page's 100).

        This is the case that separates a height-relative overlap test from a
        fixed y-centre gap: the two bands do not overlap at all, yet their
        centres are only 0.9 xh apart, so a walk over y-centres swallows the
        annotation into the line above and thresholds it in the wrong units.
        The annotation is displaced horizontally because a cluster-adjacent one
        is decided earlier, by cluster_ygap, not by line grouping at all."""
        s = [gly(x, 0, 60, 100) for x in (0, 90, 180, 270)]
        s += [gly(x, 110, 36, 60) for x in (1000, 1060, 1120)]
        lines = segment_geometric(xform(s, k, dx, dy), P)
        return (sig(lines), tuple(round(ln.xh / k, 6) for ln in lines))

    def L22(k, dx, dy):
        """A tall bracket hanging exactly between two lines: the attachment
        overlap is a BIT-IDENTICAL tie, and only a quantized tie-break resolves
        it the same way at every scale.

        Two bands of equal height 1.003 xh at 3.07 xh pitch, and a bracket whose
        y-range covers both of them completely — so it overlaps each band by
        exactly one band height. Before `_rel` this case answered `(0,1,2,6)` at
        x1 and `(3,4,5,6)` at x0.37, i.e. which line a big delimiter joined
        depended on the canvas zoom. The fixture is deliberately un-round
        (100.3 / 307.0) because exactly representable coordinates scale exactly
        and hide the flip; L15 is what re-runs this at x0.37 and x7.3."""
        H, PITCH = 100.3, 307.0
        s = [gly(x, 0.0, 60.0, H) for x in (0.0, 150.0, 300.0)]
        s += [gly(x, PITCH, 60.0, H) for x in (0.0, 150.0, 300.0)]
        s += [gly(460.0, 0.0, 40.0, PITCH + H)]  # the bracket, clear of both in x
        s = xform(s, k, dx, dy)
        boxes = stroke_boxes(s)
        xh = xheight(boxes)
        cl = cluster_strokes(boxes, xh, P)
        # Bands as the line grouper sees them when it attaches: CORE clusters
        # only, before the bracket itself joins one of them.
        core = set(_core_indices(cl, xh, P))
        bands = [
            _union_box([cl[ci].box for ci in g if ci in core])
            for g in group_lines_geometric(cl, xh, P)
        ]
        br = cl[[i for i, c in enumerate(cl) if c.strokes == (6,)][0]].box
        ov = [_rel(_overlap(br[1], br[3], bd[1], bd[3]), xh) for bd in bands]
        return (len(bands), ov[0] == ov[1], sig(segment_geometric(s, P)))

    def L17(k, dx, dy):
        """The n > 400 sweep-line cutoff must not change a single cluster.
        600 strokes laid out as 60 glyphs of 10 strokes each."""
        s = []
        for g in range(60):
            for j in range(10):
                s.append(vbar(g * 200 + j * 10, 0, 100))
        s = xform(s, k, dx, dy)
        boxes = stroke_boxes(s)
        xh = xheight(boxes)
        swept = cluster_strokes(boxes, xh, P)
        globals()["SWEEP_MIN_N"] = 10**9
        try:
            brute = cluster_strokes(boxes, xh, P)
        finally:
            globals()["SWEEP_MIN_N"] = 400
        return (len(s) > SWEEP_MIN_N, swept == brute, tuple(c.strokes for c in swept))

    def L18(k, dx, dy):
        """Stroke -> word-box assignment on the reference fixture: point
        containment claims all 51 strokes, a box-area test claims 23 because 28
        stroke bboxes have zero area. This is why claim_by_boxes counts points."""
        w1, mth, w2 = _fixture()
        s = xform(w1 + mth + w2, k, dx, dy)
        n1, n2 = len(w1), len(w1) + len(mth)
        boxes = stroke_boxes(s)
        xh = xheight(boxes)
        groups = [range(n1), range(n1, n2), range(n2, len(s))]
        words = [_union_box([boxes[i] for i in g]) for g in groups]
        assign, unclaimed = claim_by_boxes(s, range(len(s)), words, xh, P)

        def area_frac(i, b):  # fraction of the stroke's BOX inside the word box
            sb = boxes[i]
            inter = _overlap(sb[0], sb[2], b[0], b[2]) * _overlap(sb[1], sb[3], b[1], b[3])
            a = (sb[2] - sb[0]) * (sb[3] - sb[1])
            return inter / a if a > 0 else 0.0

        by_area = sum(1 for i in range(len(s)) if any(area_frac(i, b) >= 0.5 for b in words))
        zero = sum(1 for b in boxes if b[2] - b[0] <= 0 or b[3] - b[1] <= 0)
        pure = all(
            all(assign[i] == gi for i in g if i in assign) for gi, g in enumerate(groups)
        )
        # A stroke straddling two word boxes (half its points in each) belongs
        # to neither: claim_frac is what leaves it for attach_orphans instead of
        # letting the first box in the list win it.
        straddle = {"x": [100.0, 150.0, 400.0, 500.0], "y": [50.0] * 4, "t": [0] * 4}
        probe = xform([straddle], k, dx, dy)
        held, loose = claim_by_boxes(probe, [0], words, xh, P)
        return (len(s), len(assign), len(unclaimed), by_area, zero, pure, held, loose)

    def _delayed_ink():
        """Three glyphs, a second line below them, and a `t`-cross drawn 10 s
        after its stem — placed where a temporal rule cannot hide.

        The cross sits 0.78 xh below its stem's box: inside cluster_ygap (0.80),
        so the cluster pass rejoins them. Its y-centre is 0.78 xh from the upper
        line's baseline and 0.72 xh from the LOWER line's, so if a temporal gate
        ever stops that merge the cross emigrates one line down and the LINE
        partition changes, not merely the cluster list L3 inspects. The stem is
        also left of the cross's x-start, so ordering the run sweep by `t`
        instead of by x sweeps a different sequence and cuts elsewhere."""
        s = [vbar(0, 0, 100), vbar(200, 0, 100), vbar(400, 0, 100)]  # upper line
        s += [vbar(300, 150, 100), vbar(500, 150, 100)]  # lower line, clear of the cross in x
        s += [seg(-30, 178, 30, 178, t0=9999)]  # the cross, drawn last
        return s

    def _contested_orphan():
        """An unclaimed dot equidistant from two runs, with the run that must
        NOT win it drawn first.

        Both tie-break keys tie by construction: the dot has zero width so the
        width-overlap term is 0.0 against either run, and its y-centre is 0.70 xh
        from both. Only the documented lowest-index fallback settles it — so any
        `t` key, wherever it is spliced into that comparison, flips the answer."""
        base = [gly(0, 0, 400, 100), gly(350, 140, 350, 100), dot(390, 120)]
        return retime(base, lambda i: (5000, 0, 9000)[i])

    def L23(k, dx, dy):
        """`t` stays unread END TO END, not just where it is structurally absent.

        L3 pins `cluster_strokes`, which takes boxes and so cannot read `t` even
        if someone wanted it to. This routes a delayed stroke through
        `segment_geometric` and through `attach_orphans`' R1 tie-break instead —
        the two places a temporal rule would actually get written — and asserts
        the partition is identical under four impossible timings and under a
        permutation of the stroke array (stroke ids carry no information either).
        Both fixtures are built so a t-keyed rule answers DIFFERENTLY; without
        that, invariance under retiming is vacuous."""
        s = xform(_delayed_ink(), k, dx, dy)
        want = sig(segment_geometric(s, P))
        t_same = all(sig(segment_geometric(retime(s, f), P)) == want for f in TIMINGS)

        perm = (3, 5, 0, 4, 2, 1)  # a bijection of range(6)
        got = tuple(
            (
                ln.page,
                ln.index,
                tuple((tuple(sorted(perm[j] for j in r.strokes)), r.spanning) for r in ln.runs),
            )
            for ln in segment_geometric([s[j] for j in perm], P)
        )

        # R1 lives on the Vision path — segment_geometric hands it no orphans —
        # so the tie-break has to be probed directly or nothing covers it.
        o = xform(_contested_orphan(), k, dx, dy)
        ob = stroke_boxes(o)

        def r1(st):
            runs = [Run([0], ob[0], 0), Run([1], ob[1], 0)]
            out = attach_orphans(st, runs, xheight(ob), P, orphans=(2,))
            return tuple(tuple(r.strokes) for r in out)

        o_want = r1(o)
        return (want, t_same, got == want, o_want, all(r1(retime(o, f)) == o_want for f in TIMINGS))

    def L24(k, dx, dy):
        """run_tau is 1.00 xh, pinned from BOTH sides, through the function that
        owns it.

        L11's two-run answer is delivered by R4 (resplit_tau = 1.20 xh), so it
        keeps passing for any run_tau below that and says nothing about this
        threshold; raising run_tau to 100 xh used to change no case at all. These
        two probes call `split_runs_geometric` itself at 0.98 and 1.02 xh, 2%
        either side, so the case dies whichever way tau moves."""

        def runs_at(gap: float):
            s = xform([vbar(0, 0, 100), vbar(gap, 0, 100)], k, dx, dy)
            b = stroke_boxes(s)
            return tuple(tuple(g) for g in split_runs_geometric(s, range(len(s)), xheight(b), P))

        return (runs_at(98), runs_at(102))

    def L25(k, dx, dy):
        """A 3.0 xh spanner unions the two lines it reaches — and here that
        union can only come from merge_spanning_lines.

        L8 is not this test: its bounds sit 0.25 xh from the Sigma, so
        cluster_strokes merges them into one cluster and the line-union rule
        never fires (disabling the rule left L8 green). Here the cores are 1.00
        xh clear of the spanner — past cluster_ygap (0.80), so three bands are
        still standing when merge_spanning_lines runs, and inside span_reach
        (1.50), so the spanner physically gets to both. The spanner is 60 wide
        against bar_wide's 150 xh-units, so the bar rule cannot cover for it."""
        s = [gly(x, -200, 60, 100) for x in (0, 100, 200)]  # line above
        s += [gly(200, 0, 60, 300)]  # the spanner, sharing a column with both
        s += [gly(x, 400, 60, 100) for x in (0, 100, 200)]  # line below
        return sig(segment_geometric(xform(s, k, dx, dy), P))

    cases = [
        ("L1", L1, "xheight: filtered 100.0 vs naive 38.0", (100.0, 38.0, True)),
        ("L2", L2, "i stem + dot -> 1 cluster", ((0, 1),)),
        ("L3", L3, "t cross drawn last, +9999ms", ((0, 4), (1,), (2,), (3,))),
        ("L4", L4, "= bars 0.2 xh apart -> 1 cluster", ((0,), (1, 2), (3,))),
        (
            "L5",
            L5,
            "3 lines @ 2.6/2.0/1.6 xh -> 3 lines",
            tuple(
                tuple(
                    (0, li, ((tuple(range(li * 6, li * 6 + 6)), False),))
                    for li in range(3)
                )
                for _ in range(3)
            ),
        ),
        ("L6", L6, "3 lines @ 1.3 xh -> merged (documented failure)",
         ((0, 0, ((tuple(range(18)), False),)),)),
        ("L7", L7, "fraction bar unions its 2 bands, not the next line",
         ((0, 0, ((tuple(range(6)), True),)), (0, 1, (((6,), False), ((7,), False))))),
        ("L8", L8, "\\sum + bounds + tail -> 1 run, spanning",
         ((0, 0, ((tuple(range(7)), True),)),)),
        ("L9", L9, "base + subscript -> 1 run", ((0, 0, (((0, 1), False),)),)),
        ("L10", L10, "base + superscript -> 1 run", ((0, 0, (((0, 1), False),)),)),
        (
            "L11",
            L11,
            "gap 0.4 xh -> 1 run; 1.6 xh -> 2 runs",
            (
                ((0, 0, (((0, 1), False),)),),
                ((0, 0, (((0,), False), ((1,), False))),),
            ),
        ),
        (
            "L12",
            L12,
            "internal 1.4 xh gap: sweep + R4 both split",
            (
                ((0, 0, (((0, 1), False), ((2,), False))),),
                (((0, 1), "ab"), ((2,), None)),
            ),
        ),
        (
            "L13",
            L13,
            "dashes / lone dot / empty: no crash",
            (True, ((0, 0, (((0,), True), ((1,), True), ((2,), True))),),
             ((0, 0, (((0,), False),)),), [], [], True),
        ),
        (
            "L14",
            L14,
            "page break splits a line the geometry joined",
            (
                ((0, 0, (((0, 1), False),)),),
                ((0, 0, (((0,), False),)), (1, 1, (((1,), False),))),
            ),
        ),
        (
            "L16",
            L16,
            "extent_gap = 0.85/0.70 xh, padded boxes say 0.05/0.00",
            (
                100.0,
                0.85,
                0.7,
                (0.05, 0.0),
                0.85,
                # LET+math+BE is ONE run and the cut lands inside `BE TRUE`:
                # both real word gaps are under tau, so the fallback path gets
                # this line's boundaries wrong. That is the ruling, not a bug.
                ((0, 0, ((tuple(range(37)), False), (tuple(range(37, 51)), False))),),
            ),
        ),
        ("L21", L21, "R1 attaches orphans, R4 re-splits the fallback",
         (((0, 2), (1,), (3,)))),
        ("L20", L20, "a tall glyph sharing a column does not union lines",
         ((0, 0, (((0, 1, 2, 3), True),)), (0, 1, (((4, 5, 6, 7), False),)))),
        ("L19", L19, "side annotation is its own line, in its own xh",
         ((((0, 0, (((0, 1, 2, 3), False),)), (0, 1, (((4, 5, 6), False),))), (100.0, 60.0)))),
        ("L22", L22, "an exactly-straddling bracket picks the same line at every scale",
         (2, True, ((0, 0, (((0, 1, 2, 6), True),)), (0, 1, (((3, 4, 5), False),))))),
        ("L17", L17, "sweep-line cutoff == brute force",
         (True, True, tuple(tuple(range(g * 10, g * 10 + 10)) for g in range(60)))),
        ("L18", L18, "51/51 by points vs 23/51 by area", (51, 51, 0, 23, 28, True, {}, [0])),
        (
            "L23",
            L23,
            "t is unread end to end (4 timings, 1 permutation)",
            (
                (
                    (0, 0, (((0, 5), False), ((1,), False), ((2,), False))),
                    (0, 1, (((3,), False), ((4,), False))),
                ),
                True,
                True,
                ((0, 2), (1,)),
                True,
            ),
        ),
        ("L24", L24, "run_tau: 0.98 xh joins, 1.02 xh splits", (((0, 1),), ((0,), (1,)))),
        ("L25", L25, "a 1.00 xh-clear spanner unions 2 lines",
         ((0, 0, ((tuple(range(7)), True),)),)),
    ]

    ok = True
    n_pass = n_fail = 0
    base: dict[str, object] = {}
    for cid, fn, desc, want in cases:
        got = fn(1.0, 0.0, 0.0)
        base[cid] = got
        good = got == want
        ok = ok and good
        n_pass, n_fail = n_pass + bool(good), n_fail + (not good)
        print(f"{'✓' if good else '✗'} {cid:4s} {desc}")
        if not good:
            print(f"        got  {got!r}\n        want {want!r}")

    # L15 — the same cases at 0.37x and 7.3x with an offset. Identical partitions
    # is the property the x-height unit exists to provide: it is what says these
    # thresholds survive a different device, DPR or InkML coordinate range.
    bad = []
    for k, dx, dy in ((0.37, 1234.0, -567.0), (7.3, -9876.0, 4321.0)):
        for cid, fn, _desc, _want in cases:
            if fn(k, dx, dy) != base[cid]:
                bad.append(f"{cid}@{k}")
    print(f"{'✓' if not bad else '✗'} L15  scale/offset invariance: "
          f"{len(cases) * 2 - len(bad)}/{len(cases) * 2} identical"
          + (f"  FAILED {bad}" if bad else ""))
    n_pass, n_fail = n_pass + (not bad), n_fail + bool(bad)
    print(f"cases passed: {n_pass} / failed: {n_fail}")
    raise SystemExit(0 if ok and not bad else 1)
