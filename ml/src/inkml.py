"""Namespaced InkML parser for the MathWriting 2024 dataset.

Each .inkml file contains:
  - <annotation type="label"> and usually <annotation type="normalizedLabel">
    (the training label is normalizedLabel, falling back to label)
  - <trace> elements: comma-separated points, each point "x y t"
    (X/Y decimal, T in ms). There is NO pressure channel.

Coordinate ranges and sampling rates vary wildly by device; downstream code
(render.py) is responsible for normalization.

Sanity check:
    ml/.venv/bin/python -m src.inkml data/mathwriting-2024-excerpt/train/<f>.inkml
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

INKML_NS = "http://www.w3.org/2003/InkML"


@dataclass
class Ink:
    """One handwriting sample: strokes + LaTeX label."""

    strokes: list[dict] = field(default_factory=list)  # {"x":[..],"y":[..],"t":[..]}
    label: str = ""
    sample_id: str = ""


def _local(tag: str) -> str:
    """Strip an XML namespace from a tag name."""
    return tag.rsplit("}", 1)[-1]


def _parse_trace(text: str) -> dict | None:
    xs: list[float] = []
    ys: list[float] = []
    ts: list[float] = []
    for i, point in enumerate(text.split(",")):
        parts = point.split()
        if len(parts) < 2:
            continue
        xs.append(float(parts[0]))
        ys.append(float(parts[1]))
        # T channel is normally present; synthesize an index if missing.
        ts.append(float(parts[2]) if len(parts) >= 3 else float(i))
    if not xs:
        return None
    return {"x": xs, "y": ys, "t": ts}


def parse_inkml(path: str | Path) -> Ink:
    """Parse a (namespaced or plain) InkML file into strokes + label."""
    root = ET.parse(str(path)).getroot()

    annotations: dict[str, str] = {}
    strokes: list[dict] = []
    for el in root.iter():
        tag = _local(el.tag)
        if tag == "annotation":
            annotations[el.get("type", "")] = (el.text or "").strip()
        elif tag == "trace" and el.text:
            stroke = _parse_trace(el.text)
            if stroke is not None:
                strokes.append(stroke)

    label = annotations.get("normalizedLabel") or annotations.get("label") or ""
    sample_id = annotations.get("sampleId", Path(path).stem)
    return Ink(strokes=strokes, label=label, sample_id=sample_id)


if __name__ == "__main__":
    import sys

    ink = parse_inkml(sys.argv[1])
    n_pts = sum(len(s["x"]) for s in ink.strokes)
    print(f"sample_id: {ink.sample_id}")
    print(f"label:     {ink.label}")
    print(f"strokes:   {len(ink.strokes)} ({n_pts} points)")
    s0 = ink.strokes[0]
    print(f"stroke[0]: x[:5]={s0['x'][:5]} y[:5]={s0['y'][:5]} t[:5]={s0['t'][:5]}")
