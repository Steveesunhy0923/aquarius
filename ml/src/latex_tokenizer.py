r"""LaTeX tokenizer + vocabulary for MathWriting labels.

Token rules (in order):
  - \command        (backslash + letters, e.g. \frac \alpha)
  - \<single char>  (backslash + non-letter, e.g. \{ \% \\)
  - { } ^ _ &       (structure characters, one token each)
  - any other single non-whitespace character (digits, letters, = + - ...)
Whitespace separates tokens and is otherwise discarded.

Special ids: <pad>=0, <sos>=1, <eos>=2, <unk>=3.

Build the vocab from the excerpt train split:
    ml/.venv/bin/python -m src.latex_tokenizer   # writes checkpoints/vocab.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

PAD, SOS, EOS, UNK = "<pad>", "<sos>", "<eos>", "<unk>"
SPECIALS = [PAD, SOS, EOS, UNK]

_TOKEN_RE = re.compile(r"\\[a-zA-Z]+|\\.|[{}^_&]|\S")


def tokenize(latex: str) -> list[str]:
    return _TOKEN_RE.findall(latex)


class Tokenizer:
    def __init__(self, vocab: list[str]):
        self.vocab = list(vocab)
        self.tok2id = {tok: i for i, tok in enumerate(self.vocab)}
        self.pad_id = self.tok2id[PAD]
        self.sos_id = self.tok2id[SOS]
        self.eos_id = self.tok2id[EOS]
        self.unk_id = self.tok2id[UNK]

    def __len__(self) -> int:
        return len(self.vocab)

    def encode(self, latex: str, add_special: bool = True) -> list[int]:
        ids = [self.tok2id.get(tok, self.unk_id) for tok in tokenize(latex)]
        if add_special:
            ids = [self.sos_id] + ids + [self.eos_id]
        return ids

    def decode(self, ids: list[int]) -> str:
        toks = []
        for i in ids:
            if i in (self.pad_id, self.sos_id):
                continue
            if i == self.eos_id:
                break
            toks.append(self.vocab[i] if 0 <= i < len(self.vocab) else UNK)
        out = []
        for i, tok in enumerate(toks):
            # keep a space after \commands so decoded LaTeX stays parseable
            if tok.startswith("\\") and tok[1:].isalpha():
                out.append(tok + " ")
            else:
                out.append(tok)
        return "".join(out).strip()

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(self.vocab, indent=1))

    @classmethod
    def load(cls, path: str | Path) -> "Tokenizer":
        return cls(json.loads(Path(path).read_text()))


def build_vocab(labels: list[str]) -> Tokenizer:
    seen: set[str] = set()
    for label in labels:
        seen.update(tokenize(label))
    return Tokenizer(SPECIALS + sorted(seen))


def build_vocab_from_split(split_dir: str | Path) -> Tokenizer:
    from .inkml import parse_inkml

    labels = []
    for f in sorted(Path(split_dir).glob("*.inkml")):
        label = parse_inkml(f).label
        if label:
            labels.append(label)
    return build_vocab(labels)


if __name__ == "__main__":
    ml_dir = Path(__file__).resolve().parents[1]
    train_dir = ml_dir / "data" / "mathwriting-2024-excerpt" / "train"
    out = ml_dir / "checkpoints" / "vocab.json"
    tok = build_vocab_from_split(train_dir)
    tok.save(out)
    print(f"vocab size: {len(tok)} (incl. {len(SPECIALS)} specials) -> {out}")
    demo = r"\frac{a^{2}+b_{1}}{\sqrt{x}}"
    print(f"demo: {demo}")
    print(f"tokens: {tokenize(demo)}")
    print(f"ids:    {tok.encode(demo)}")
    print(f"round-trip: {tok.decode(tok.encode(demo))}")
