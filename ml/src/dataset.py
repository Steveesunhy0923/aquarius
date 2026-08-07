"""torch Dataset over the extracted MathWriting splits.

Yields (image tensor [1, 96, 768], token id LongTensor) per sample.
Images come from render.strokes_to_array — the exact code path serve.py uses.

Optional extensions (all default OFF, so the original constructor is intact):
  - extra_dirs: additional split directories concatenated in (e.g. synthetic/)
  - corrections_jsonl: user-collected samples from serve.py's /collect
    ({"label": .., "strokes": [{x,y,t}, ..]} per line), oversampled by
    corrections_repeat so a handful of corrections is actually seen — and
    gated by record `mode` (load_corrections), because that oversampling
    means one non-LaTeX record does thirty-two records' worth of damage
  - augment: stroke-level augmentation (src/augment.py) before rasterization,
    with a per-sample RNG derived from (base_seed, index, nonce) so DataLoader
    workers never repeat each other
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset, get_worker_info

from .augment import augment_strokes
from .inkml import parse_inkml
from .latex_tokenizer import Tokenizer
from .render import strokes_to_array


def load_corrections(
    jsonl_path: str | Path,
    modes: tuple[str, ...] = ("math", "chem"),
) -> list[tuple[list[dict], str]]:
    """Parse serve.py's collected.jsonl into (strokes, label) pairs.

    `modes` is a corpus-safety gate, not a convenience filter. This function
    feeds the MATH decoder, and corrections are oversampled x32 (see the
    --corrections-repeat wiring in cloud/setup_and_train.sh), so one record of
    the wrong kind is trained on thirty-two times over. /collect already stores
    `mode:"text"` — English prose from the Vision OCR path, not LaTeX — and
    unified recognition adds `mode:"mixed"` layout parents whose label is a
    whole page of source. Either would be learned as if it were an expression.

    Default keeps math+chem: both are stroke->LaTeX for this same decoder.
    Records with no `mode` at all fall back to math, which is the collector's
    own default for the field and the conservative reading of a hand-written or
    externally generated line.
    """
    samples: list[tuple[list[dict], str]] = []
    with Path(jsonl_path).open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                # a crash mid-append can truncate the final line — skip, don't
                # kill a training launch over one bad correction
                print(f"WARNING: skipping malformed corrections line {lineno} in {jsonl_path}")
                continue
            if rec.get("mode", "math") not in modes:
                continue
            label = (rec.get("label") or "").strip()
            strokes = [s for s in rec.get("strokes", []) if s.get("x")]
            if label and strokes:
                samples.append((strokes, label))
    return samples


class MathWritingDataset(Dataset):
    def __init__(
        self,
        root: str | Path,
        split: str,
        tokenizer: Tokenizer,
        max_len: int = 160,
        line_width: float = 2.0,
        augment: bool = False,
        extra_dirs: list[str | Path] | None = None,
        corrections_jsonl: str | Path | None = None,
        corrections_repeat: int = 32,
        base_seed: int = 0,
    ):
        self.split_dir = Path(root) / split
        self.files = sorted(self.split_dir.glob("*.inkml"))
        if not self.files:
            raise FileNotFoundError(f"no .inkml files in {self.split_dir}")
        self.tokenizer = tokenizer
        self.max_len = max_len
        self.line_width = line_width
        self.augment = augment
        self.base_seed = base_seed

        # entries: Path (.inkml file) or (strokes, label) tuple (correction)
        self.entries: list[Path | tuple[list[dict], str]] = list(self.files)
        for d in extra_dirs or []:
            extra = sorted(Path(d).glob("*.inkml"))
            if not extra:
                raise FileNotFoundError(f"no .inkml files in extra dir {d}")
            self.entries.extend(extra)
        self.n_corrections = 0
        if corrections_jsonl is not None:
            corrections = load_corrections(corrections_jsonl)
            self.n_corrections = len(corrections)
            self.entries.extend(corrections * max(1, int(corrections_repeat)))

        # per-instance augmentation state (each DataLoader worker holds its
        # own copy after fork/spawn)
        self._serve_counts: dict[int, int] = {}
        self._worker_nonce: int | None = None

    def __len__(self) -> int:
        return len(self.entries)

    def _sample_rng(self, idx: int) -> np.random.Generator:
        """Fresh Generator per (base_seed, index, epoch_nonce).

        The nonce combines the torch DataLoader worker seed (unique per
        worker) with a per-index serve counter (ticks up each epoch), so
        workers never mirror each other and revisiting a sample in a later
        epoch draws a new transform.
        """
        if self._worker_nonce is None:
            info = get_worker_info()
            self._worker_nonce = (info.seed % (2**31)) if info is not None else 0
        count = self._serve_counts.get(idx, 0)
        self._serve_counts[idx] = count + 1
        return np.random.default_rng((self.base_seed, idx, self._worker_nonce, count))

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        entry = self.entries[idx]
        if isinstance(entry, Path):
            ink = parse_inkml(entry)
            strokes, label = ink.strokes, ink.label
        else:
            strokes, label = entry

        line_width = self.line_width
        if self.augment:
            strokes, line_width = augment_strokes(strokes, self._sample_rng(idx))

        image = torch.from_numpy(strokes_to_array(strokes, line_width=line_width))
        ids = self.tokenizer.encode(label)[: self.max_len]
        return image, torch.tensor(ids, dtype=torch.long)


def collate(batch, pad_id: int):
    """Stack images; right-pad token sequences with pad_id."""
    images = torch.stack([b[0] for b in batch])
    max_len = max(len(b[1]) for b in batch)
    tokens = torch.full((len(batch), max_len), pad_id, dtype=torch.long)
    for i, (_, ids) in enumerate(batch):
        tokens[i, : len(ids)] = ids
    return images, tokens


if __name__ == "__main__":
    from .latex_tokenizer import build_vocab_from_split

    ml_dir = Path(__file__).resolve().parents[1]
    root = ml_dir / "data" / "mathwriting-2024-excerpt"
    tok = build_vocab_from_split(root / "train")
    ds = MathWritingDataset(root, "train", tok)
    img, ids = ds[0]
    print(f"samples: {len(ds)}, image: {tuple(img.shape)}, ids: {ids[:12].tolist()}...")
    print(f"decoded: {tok.decode(ids.tolist())}")

    # extended path: synthetic concat + augmentation (+ corrections if present)
    corrections = ml_dir / "data" / "corrections" / "collected.jsonl"
    ds2 = MathWritingDataset(
        root, "train", tok,
        augment=True,
        extra_dirs=[root / "synthetic"],
        corrections_jsonl=corrections if corrections.exists() else None,
    )
    img2, _ = ds2[0]
    img2b, _ = ds2[0]
    print(f"extended: {len(ds2)} samples ({ds2.n_corrections} corrections), "
          f"augment differs across epochs: {not torch.equal(img2, img2b)}")
