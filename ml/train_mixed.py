r"""Train the MIXED-AWARE decoder (phase 2): a page of ink -> prose with inline math.

Phases 0 and 1 improve the CLASSIFIER. This removes the classifier from the
critical path entirely.

Today the boundary between prose and formula is decided up front, by geometry
and a router, and only then is each side recognized. That decision is
irreversible — a run assigned to math never reaches the text engine — and it is
made with the least information available, before anything has been read. The
measurement that settles it: of the short words swallowed into an adjacent
formula, **11 of 12 were already inside the formula's run before the router ran
at all**. No classifier, trained or hand-written, can fix a boundary that has
already been drawn wrongly.

So: let the decoder draw it. The target is the assembled reading itself —

    let \(x^{2}\) be the root

— and the model emits the `\(`/`\)` boundaries as part of its output, jointly
with the content, having seen the whole line. A word next to a formula is then
just a place where the model emits `\)` before it emits the word, which it can
condition on everything to the left and right.

Two departures from `train.py`, both forced by the target:

  - **the canvas is 96x1536, not 96x768.** `render` fits ink to height 96 and
    caps width at 768, so anything wider than aspect 8 gets shrunk and loses
    vertical resolution. Mixed lines are wide: median aspect 9.2, p90 13.9. At
    768 the model would read 65% of its training data squashed. `InkToLatex`
    already takes height/width and registers `pos2d` from them, so this is a
    config change, not a surgery — but it means the checkpoint is NOT
    interchangeable with the 768-wide math checkpoints.
  - **whitespace is a token** (`src/mixed_tokens.py`). MathWriting labels have
    no meaningful spaces so `latex_tokenizer` discards them; a sentence needs
    them back or `be the root` decodes as `betheroot`.

Data is generated ON THE FLY, not from a file: a mixed line costs about a
millisecond to stitch and the corpus would otherwise be tens of GB of
duplicated stroke coordinates. Each index maps to a fixed seed, so an epoch is
reproducible and two workers never draw the same sample.

Usage (local proof run, MPS):
    ml/.venv/bin/python train_mixed.py --steps 4000 --batch-size 12 --num-workers 4

Full run: see ml/cloud/README.md — same shape as the S2-XL run, one GPU-day.
"""

from __future__ import annotations

import argparse
import functools
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.dataset import collate  # noqa: E402
from src.latex_tokenizer import SPECIALS, Tokenizer  # noqa: E402
from src.mixed_synth import (  # noqa: E402
    MW_DIR,
    ExpressionBank,
    SymbolBank,
    split_bank,
    split_vocab,
    synth_mixed,
)
from src.mixed_tokens import decode as detokenize, encode as tokenize_mixed  # noqa: E402
from src.model import InkToLatex  # noqa: E402
from src.render import strokes_to_array  # noqa: E402

ML_DIR = Path(__file__).resolve().parent

HEIGHT = 96
WIDTH = 1536  # aspect 16; see the module docstring
MODEL_SIZES = {
    "base": {"d_model": 256, "nhead": 8, "num_layers": 4, "dim_feedforward": 1024},
    "xl": {"d_model": 384, "nhead": 8, "num_layers": 6, "dim_feedforward": 1536},
}


def pick_device(arg: str) -> torch.device:
    if arg != "auto":
        return torch.device(arg)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


class MixedStream(Dataset):
    """Mixed lines synthesized on demand; index -> sample is a pure function of
    (base seed, index), so the epoch is reproducible and worker-safe."""

    def __init__(self, n: int, seed: int, split: str, *, half: int, vocab_half: int | None,
                 tokenizer: Tokenizer, max_len: int, letters_only_every: int = 4):
        self.n = n
        self.seed = seed
        self.split = split
        self.half = half
        self.vocab = split_vocab(vocab_half)
        self.tokenizer = tokenizer
        self.max_len = max_len
        # Letters-only formulas are 0.26% of MathWriting and routine in real
        # notes; without a deliberate dose the model would almost never see one.
        self.letters_only_every = letters_only_every
        self._banks: dict[str, object] = {}

    def __len__(self) -> int:
        return self.n

    def _bank(self, letters_only: bool):
        """Per-WORKER, built lazily: a DataLoader worker is a forked process and
        the parsed-ink caches inside these must not be shared or pickled."""
        key = f"expr{int(letters_only)}"
        if key not in self._banks:
            self._banks[key] = ExpressionBank(self.split, letters_only=letters_only)
        if "sym" not in self._banks:
            self._banks["sym"] = split_bank(SymbolBank(MW_DIR / "symbols"), self.half)
        return self._banks["sym"], self._banks[key]

    def __getitem__(self, idx: int):
        rng = random.Random((self.seed * 1_000_003) ^ idx)
        letters_only = self.letters_only_every > 0 and idx % self.letters_only_every == 0
        for attempt in range(6):
            try:
                bank, exprs = self._bank(letters_only)
                rec = synth_mixed(bank, exprs, rng, f"t{idx}", vocab=self.vocab)
                break
            except (KeyError, ValueError):
                rng = random.Random((self.seed * 1_000_003) ^ idx ^ (attempt + 1) * 7919)
        else:  # pragma: no cover - a bank that cannot draw anything at all
            raise RuntimeError("could not synthesize a sample")

        img = torch.from_numpy(strokes_to_array(rec["strokes"], height=HEIGHT, max_width=WIDTH))
        return img, torch.tensor(encode_ids(self.tokenizer, rec["source"], self.max_len),
                                 dtype=torch.long)


def encode_ids(tokenizer: Tokenizer, source: str, max_len: int) -> list[int]:
    """Mixed source -> ids, WITHOUT a round trip through a joined string.

    `Tokenizer.encode` re-lexes whatever it is handed, and `Tokenizer.decode`
    only puts a space back after `\command` tokens — so joining tokens and
    re-splitting them does not round-trip (`\(x^{2}\)` comes back as one
    blob). Map the token list straight onto ids instead.
    """
    ids = [tokenizer.tok2id.get(t, tokenizer.unk_id) for t in tokenize_mixed(source)]
    return [tokenizer.sos_id] + ids[: max(max_len - 2, 0)] + [tokenizer.eos_id]


def ids_to_tokens(tokenizer: Tokenizer, ids) -> list[str]:
    """Ids -> the token list, stopping at <eos>. The inverse of `encode_ids`
    up to truncation, and what `mixed_tokens.decode` expects."""
    out: list[str] = []
    for i in ids:
        i = int(i)
        if i in (tokenizer.pad_id, tokenizer.sos_id):
            continue
        if i == tokenizer.eos_id:
            break
        out.append(tokenizer.vocab[i] if 0 <= i < len(tokenizer.vocab) else "<unk>")
    return out


def build_vocab(n: int, seed: int) -> Tokenizer:
    """Vocabulary over a sample of the corpus the model will actually see.

    Built from generated sources rather than from MathWriting labels: the target
    language is a superset (every LaTeX token, plus the alphabet, plus the word
    separator) and a vocab missing the separator would silently map it to <unk>.
    """
    bank = split_bank(SymbolBank(MW_DIR / "symbols"), 1)
    vocab_words = split_vocab(0)
    toks: dict[str, None] = {}
    for letters_only in (False, True):
        exprs = ExpressionBank("train", letters_only=letters_only)
        rng = random.Random(seed)
        for i in range(n if not letters_only else max(n // 3, 1)):
            try:
                rec = synth_mixed(bank, exprs, rng, f"v{i}", vocab=vocab_words)
            except (KeyError, ValueError):
                continue
            for t in tokenize_mixed(rec["source"]):
                toks.setdefault(t, None)
    return Tokenizer(SPECIALS + sorted(toks))


@torch.no_grad()
def validate(model, loader, tokenizer, device, batches: int) -> tuple[float, float]:
    """(cross-entropy, mean source similarity) on held-out lines."""
    from difflib import SequenceMatcher

    model.eval()
    losses, sims = [], []
    crit = torch.nn.CrossEntropyLoss(ignore_index=tokenizer.pad_id)
    for i, (images, tokens) in enumerate(loader):
        if i >= batches:
            break
        images, tokens = images.to(device), tokens.to(device)
        logits = model(images, tokens[:, :-1])
        losses.append(float(crit(logits.reshape(-1, logits.size(-1)), tokens[:, 1:].reshape(-1))))
        # Cap the decode length. Greedy decoding is sequential, so validation
        # cost is (batches x batch_size x max_len) decoder forwards — at the
        # padded batch width on MPS that ran to minutes per validation and
        # dominated the run.
        ids, _ = model.greedy_decode(images, max_len=min(int(tokens.shape[1]) + 8, 64))
        for pred, gold in zip(ids, tokens):
            got = detokenize(ids_to_tokens(tokenizer, pred))
            want = detokenize(ids_to_tokens(tokenizer, gold))
            sims.append(SequenceMatcher(None, want, got).ratio())
    model.train()
    return (float(np.mean(losses)) if losses else float("nan"),
            float(np.mean(sims)) if sims else 0.0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--batch-size", type=int, default=12)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--model-size", default="base", choices=sorted(MODEL_SIZES))
    ap.add_argument("--max-len", type=int, default=160)
    ap.add_argument("--num-workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--warmup-steps", type=int, default=300)
    ap.add_argument("--valid-every", type=int, default=500)
    ap.add_argument("--valid-batches", type=int, default=8)
    ap.add_argument("--save-every", type=int, default=1000)
    ap.add_argument("--vocab", default=str(ML_DIR / "checkpoints" / "vocab_mixed.json"))
    ap.add_argument("--out", default=str(ML_DIR / "checkpoints" / "mixed.pt"))
    ap.add_argument("--resume", default="")
    args = ap.parse_args()

    device = pick_device(args.device)
    out = Path(args.out)
    vocab_path = Path(args.vocab)

    if vocab_path.exists():
        tokenizer = Tokenizer.load(vocab_path)
        print(f"vocab: {len(tokenizer.vocab)} tokens (loaded)")
    else:
        print("building vocabulary from generated sources…")
        tokenizer = build_vocab(3000, args.seed)
        tokenizer.save(vocab_path)
        print(f"vocab: {len(tokenizer.vocab)} tokens -> {vocab_path}")

    train_ds = MixedStream(args.steps * args.batch_size, args.seed, "train",
                           half=1, vocab_half=0, tokenizer=tokenizer, max_len=args.max_len)
    valid_ds = MixedStream(args.valid_batches * args.batch_size * 4, args.seed + 999, "valid",
                           half=0, vocab_half=1, tokenizer=tokenizer, max_len=args.max_len)
    # partial, not a lambda: macOS DataLoader workers are SPAWNED, and a spawned
    # worker pickles collate_fn — a local lambda dies with "Can't pickle local
    # object".
    kw = dict(batch_size=args.batch_size, num_workers=args.num_workers,
              collate_fn=functools.partial(collate, pad_id=tokenizer.pad_id))
    if args.num_workers:
        kw["persistent_workers"] = True
    train_dl = DataLoader(train_ds, shuffle=False, **kw)
    valid_dl = DataLoader(valid_ds, shuffle=False, **kw)

    cfg = dict(MODEL_SIZES[args.model_size], vocab_size=len(tokenizer.vocab),
               height=HEIGHT, width=WIDTH)
    model = InkToLatex(**cfg).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"model: {args.model_size} {n_params / 1e6:.1f}M params, canvas {HEIGHT}x{WIDTH}, {device}")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    crit = torch.nn.CrossEntropyLoss(ignore_index=tokenizer.pad_id)
    start = 0
    if args.resume and Path(args.resume).exists():
        ck = torch.load(args.resume, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model_state"])
        opt.load_state_dict(ck["optimizer_state"])
        start = int(ck.get("step", 0))
        print(f"resumed from {args.resume} at step {start}")

    def lr_at(step: int) -> float:
        if step < args.warmup_steps:
            return args.lr * (step + 1) / args.warmup_steps
        p = (step - args.warmup_steps) / max(args.steps - args.warmup_steps, 1)
        return args.lr * 0.5 * (1.0 + math.cos(math.pi * min(p, 1.0)))

    log = out.with_name(out.stem + "_loss.txt")
    vlog = out.with_name(out.stem + "_valid.txt")
    out.parent.mkdir(parents=True, exist_ok=True)
    # Truncate unless resuming. Appending across independent runs interleaves
    # two step-0..N series in one file, which makes the curve unreadable and
    # silently misattributes an abandoned run's numbers to the current one.
    if not args.resume:
        for f in (log, vlog):
            f.write_text("")

    def save(step: int, path: Path) -> None:
        torch.save({"model_state": model.state_dict(), "optimizer_state": opt.state_dict(),
                    "vocab": tokenizer.vocab, "config": cfg, "step": step,
                    "height": HEIGHT, "width": WIDTH}, path)

    model.train()
    t0 = time.time()
    step = start
    running: list[float] = []
    with log.open("a") as lf:  # opened once, flushed per write
        for images, tokens in train_dl:
            if step >= args.steps:
                break
            for g in opt.param_groups:
                g["lr"] = lr_at(step)
            images, tokens = images.to(device), tokens.to(device)
            logits = model(images, tokens[:, :-1])
            loss = crit(logits.reshape(-1, logits.size(-1)), tokens[:, 1:].reshape(-1))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            running.append(float(loss.detach()))
            step += 1

            if step % 50 == 0:
                avg = float(np.mean(running[-50:]))
                el = time.time() - t0
                print(f"  step {step}/{args.steps}  loss {avg:.4f}  lr {lr_at(step):.2e}  "
                      f"{el:.0f}s  ({step - start} steps, {(step - start) / max(el, 1e-9):.2f}/s)")
                lf.write(f"{step}\t{avg:.5f}\t{lr_at(step):.3e}\n")
                lf.flush()
            if args.valid_every and step % args.valid_every == 0:
                vl, sim = validate(model, valid_dl, tokenizer, device, args.valid_batches)
                print(f"    valid loss {vl:.4f}  source similarity {sim:.3f}")
                with vlog.open("a") as vf:
                    vf.write(f"{step}\t{vl:.5f}\t{sim:.4f}\n")
            if args.save_every and step % args.save_every == 0:
                save(step, out)

    save(step, out)
    vl, sim = validate(model, valid_dl, tokenizer, device, args.valid_batches)
    print(f"\ndone: {step} steps in {(time.time() - t0) / 60:.1f} min")
    print(f"final valid loss {vl:.4f}  source similarity {sim:.3f}")
    print(f"saved -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
