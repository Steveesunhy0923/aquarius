#!/usr/bin/env python3
"""Train the handwriting->LaTeX model on the MathWriting excerpt.

Smoke run (proves the plumbing, not a usable model):
    cd ml && .venv/bin/python train.py --steps 300 --batch-size 16

S2-XL run (cloud GPU, see ml/cloud/README.md):
    python train.py --steps 150000 --batch-size 128 --model-size xl \
        --synthetic --augment --num-workers 12 --save-every 2000 \
        --valid-every 2000 --valid-batches 40 --warmup-steps 3000 --lr 5e-4 \
        --data data/mathwriting-2024 --out checkpoints/xl.pt

Saves:
    checkpoints/smoke.pt         (model weights + vocab + config + optim/sched/step)
    checkpoints/smoke_best.pt    (best-validation weights, when validating)
    checkpoints/smoke_loss.txt   (step<TAB>loss<TAB>lr log)
    checkpoints/vocab.json       (token list)
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import itertools
import math
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

ML_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ML_DIR))

from src.dataset import MathWritingDataset, collate  # noqa: E402
from src.latex_tokenizer import Tokenizer, build_vocab_from_split  # noqa: E402
from src.model import InkToLatex  # noqa: E402

# --model-size presets (architecture only; everything else comes from flags)
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


def make_lr_lambda(total_steps: int, warmup_steps: int, floor: float = 0.05):
    """Linear warmup to peak, then cosine decay to floor*peak at total_steps."""
    warmup = max(1, warmup_steps)

    def lr_lambda(sched_step: int) -> float:  # 0-based; step N uses lambda(N-1)
        s = sched_step + 1
        if s <= warmup:
            return s / warmup
        progress = min(1.0, (s - warmup) / max(1, total_steps - warmup))
        return floor + (1.0 - floor) * 0.5 * (1.0 + math.cos(math.pi * progress))

    return lr_lambda


def save_checkpoint(
    path: Path,
    model: InkToLatex,
    tokenizer: Tokenizer,
    config: dict,
    optimizer: torch.optim.Optimizer | None = None,
    scheduler: torch.optim.lr_scheduler.LRScheduler | None = None,
    step: int | None = None,
    best_valid: float | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"model_state": model.state_dict(), "vocab": tokenizer.vocab, "config": config}
    if optimizer is not None:
        payload["optimizer_state"] = optimizer.state_dict()
    if scheduler is not None:
        payload["scheduler_state"] = scheduler.state_dict()
    if step is not None:
        payload["step"] = step
    if best_valid is not None and math.isfinite(best_valid):
        payload["best_valid"] = best_valid
    tmp = path.with_suffix(path.suffix + ".tmp")  # atomic: a crash mid-write never corrupts the live file
    torch.save(payload, tmp)
    tmp.replace(path)


@torch.no_grad()
def validate(model, loader, pad_id, device, max_batches: int) -> float:
    """Mean teacher-forced CE over up to max_batches of the valid split."""
    model.eval()
    total, n = 0.0, 0
    for images, tokens in itertools.islice(loader, max_batches):
        images, tokens = images.to(device), tokens.to(device)
        logits = model(images, tokens[:, :-1])
        loss = F.cross_entropy(
            logits.reshape(-1, logits.shape[-1]), tokens[:, 1:].reshape(-1), ignore_index=pad_id
        )
        total += loss.item()
        n += 1
    model.train()
    return total / max(1, n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=300)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--device", default="auto", help="auto (cuda > mps > cpu) | cuda | mps | cpu")
    ap.add_argument("--data", default=str(ML_DIR / "data" / "mathwriting-2024-excerpt"))
    ap.add_argument("--out", default=str(ML_DIR / "checkpoints" / "smoke.pt"))
    ap.add_argument("--max-len", type=int, default=160)
    ap.add_argument("--num-workers", type=int, default=0, help=">0 parallelizes InkML parse/render (needed for MPS)")
    ap.add_argument("--save-every", type=int, default=0, help="checkpoint every N steps (0 = only at the end)")
    ap.add_argument("--valid-every", type=int, default=0, help="validate every N steps (0 = never)")
    ap.add_argument("--valid-batches", type=int, default=20, help="how many valid batches per validation")
    ap.add_argument("--vocab", default="", help="path to an existing vocab.json (skip the full-split scan)")
    ap.add_argument("--model-size", default="base", choices=sorted(MODEL_SIZES),
                    help="architecture preset: base (256/8/4/1024) | xl (384/8/6/1536)")
    ap.add_argument("--synthetic", action="store_true",
                    help="also train on <data>/synthetic (concatenated with train/)")
    ap.add_argument("--augment", action="store_true",
                    help="stroke-level augmentation (rotate/shear/scale/jitter + random line width)")
    ap.add_argument("--corrections", default="",
                    help="path to a collected.jsonl of user corrections to mix into training")
    ap.add_argument("--corrections-repeat", type=int, default=32,
                    help="oversampling factor for --corrections samples")
    ap.add_argument("--warmup-steps", type=int, default=2000,
                    help="linear LR warmup steps (clamped to steps/10 for short runs), then cosine decay to 5%% of peak")
    ap.add_argument("--resume", default="",
                    help="checkpoint to resume from (model+optimizer+scheduler+step; old weight-only checkpoints load with a warning)")
    ap.add_argument("--accum", type=int, default=1,
                    help="gradient accumulation micro-batches per step (effective batch = batch-size * accum)")
    args = ap.parse_args()

    device = pick_device(args.device)
    print(f"device: {device}", flush=True)

    # CUDA gets AMP autocast (bf16 when the GPU supports it, else fp16+GradScaler)
    # and cudnn autotuning. MPS/CPU keep the exact original fp32 path.
    use_cuda = device.type == "cuda"
    scaler = None
    autocast_ctx = contextlib.nullcontext
    if use_cuda:
        torch.backends.cudnn.benchmark = True
        amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        autocast_ctx = functools.partial(torch.autocast, "cuda", dtype=amp_dtype)
        if amp_dtype is torch.float16:  # bf16 needs no loss scaling
            scaler = torch.amp.GradScaler("cuda")
        print(f"amp: autocast {str(amp_dtype).removeprefix('torch.')}"
              f"{' + GradScaler' if scaler else ''}, cudnn.benchmark on", flush=True)

    resume_ckpt = None
    if args.resume:
        resume_ckpt = torch.load(args.resume, map_location="cpu", weights_only=True)
        print(f"resuming from {args.resume}", flush=True)

    data_root = Path(args.data)
    vocab_out = Path(args.out).with_name("vocab.json")
    if resume_ckpt is not None:
        # vocab (and config, below) must match the resumed weights exactly
        tokenizer = Tokenizer(resume_ckpt["vocab"])
        print(f"vocab from checkpoint: {len(tokenizer)} tokens", flush=True)
    elif args.vocab:
        tokenizer = Tokenizer.load(args.vocab)
        print(f"loaded vocab: {len(tokenizer)} tokens from {args.vocab}", flush=True)
    else:
        print("building vocab from train split (one-time scan)…", flush=True)
        tokenizer = build_vocab_from_split(data_root / "train")
        print(f"vocab size: {len(tokenizer)}", flush=True)
    tokenizer.save(vocab_out)

    collate_fn = functools.partial(collate, pad_id=tokenizer.pad_id)  # picklable (workers use spawn on macOS)

    extra_dirs = [data_root / "synthetic"] if args.synthetic else None
    dataset = MathWritingDataset(
        data_root, "train", tokenizer, max_len=args.max_len,
        augment=args.augment,
        extra_dirs=extra_dirs,
        corrections_jsonl=args.corrections or None,
        corrections_repeat=args.corrections_repeat,
    )
    parts = [f"train samples: {len(dataset)}"]
    if args.synthetic:
        parts.append("(+synthetic)")
    if dataset.n_corrections:
        parts.append(f"(incl. {dataset.n_corrections} corrections x{args.corrections_repeat})")
    if args.augment:
        parts.append("[augmented]")
    print(" ".join(parts), flush=True)
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        persistent_workers=args.num_workers > 0,
        pin_memory=use_cuda,
        collate_fn=collate_fn,
        drop_last=True,
    )

    valid_loader = None
    if args.valid_every > 0:
        try:
            valid_ds = MathWritingDataset(data_root, "valid", tokenizer, max_len=args.max_len)
            valid_loader = DataLoader(
                valid_ds, batch_size=args.batch_size, shuffle=True,
                num_workers=args.num_workers, collate_fn=collate_fn, drop_last=True,
            )
            print(f"valid samples: {len(valid_ds)}", flush=True)
        except FileNotFoundError:
            print("no valid split found — skipping validation", flush=True)

    if resume_ckpt is not None:
        config = dict(resume_ckpt["config"])  # architecture is fixed by the weights
    else:
        config = {
            "vocab_size": len(tokenizer),
            **MODEL_SIZES[args.model_size],
            "max_len": args.max_len,
            "height": 96,
            "width": 768,
            "pad_id": tokenizer.pad_id,
            "sos_id": tokenizer.sos_id,
            "eos_id": tokenizer.eos_id,
        }
    model = InkToLatex(**config).to(device)
    print(f"parameters: {model.param_count():,} ({args.model_size})")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    # warmup is clamped for short runs so the documented smoke run still learns
    warmup = min(args.warmup_steps, max(1, args.steps // 10))
    if warmup != args.warmup_steps:
        print(f"warmup clamped: {args.warmup_steps} -> {warmup} (steps/10)", flush=True)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, make_lr_lambda(args.steps, warmup))

    start_step = 0
    best_valid = float("inf")
    if resume_ckpt is not None:
        model.load_state_dict(resume_ckpt["model_state"])
        if "optimizer_state" in resume_ckpt and "step" in resume_ckpt:
            opt.load_state_dict(resume_ckpt["optimizer_state"])
            if "scheduler_state" in resume_ckpt:
                sched.load_state_dict(resume_ckpt["scheduler_state"])
            start_step = int(resume_ckpt["step"])
            best_valid = float(resume_ckpt.get("best_valid", float("inf")))
            print(f"restored optimizer/scheduler, continuing at step {start_step + 1}", flush=True)
        else:
            print("WARNING: old checkpoint without optimizer/scheduler/step — "
                  "weights-only resume, starting at step 1 with a fresh optimizer", flush=True)
        if start_step >= args.steps:
            print(f"nothing to do: checkpoint step {start_step} >= --steps {args.steps}", flush=True)

    if args.accum > 1:
        print(f"grad accumulation: {args.accum} (effective batch {args.batch_size * args.accum})", flush=True)

    # loop the dataset for as many distinct batches as the step budget needs
    batches = itertools.chain.from_iterable(itertools.repeat(loader))
    valid_batches = itertools.chain.from_iterable(itertools.repeat(valid_loader)) if valid_loader else None

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    best_out = out.with_name(out.stem + "_best.pt")
    # Incremental loss log so progress is watchable during a long run (not just at the end).
    # Columns: step \t loss \t lr  (first two unchanged for existing parsers).
    log_mode = "a" if start_step > 0 else "w"
    loss_file = out.with_name(out.stem + "_loss.txt")
    loss_fp = loss_file.open(log_mode)
    valid_file = out.with_name(out.stem + "_valid.txt")
    valid_fp = valid_file.open(log_mode)

    first_loss = None
    last_loss = float("nan")
    model.train()
    t0 = time.time()
    steps_this_run = 0
    for step in range(start_step + 1, args.steps + 1):
        opt.zero_grad(set_to_none=True)
        micro_losses = 0.0
        for _ in range(args.accum):
            images, tokens = next(batches)
            images = images.to(device, non_blocking=use_cuda)
            tokens = tokens.to(device, non_blocking=use_cuda)
            with autocast_ctx():
                # teacher forcing: predict tokens[1:] from tokens[:-1]
                logits = model(images, tokens[:, :-1])
                loss = F.cross_entropy(
                    logits.reshape(-1, logits.shape[-1]),
                    tokens[:, 1:].reshape(-1),
                    ignore_index=tokenizer.pad_id,
                )
            micro_losses += loss.item()
            if args.accum > 1:
                loss = loss / args.accum
            if scaler is not None:
                scaler.scale(loss).backward()
            else:
                loss.backward()
        if scaler is not None:
            scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        cur_lr = opt.param_groups[0]["lr"]
        if scaler is not None:
            scaler.step(opt)
            scaler.update()
        else:
            opt.step()
        sched.step()

        steps_this_run += 1
        last_loss = micro_losses / args.accum
        if first_loss is None:
            first_loss = last_loss
        loss_fp.write(f"{step}\t{last_loss:.6f}\t{cur_lr:.6e}\n")
        if step % 10 == 0 or steps_this_run == 1:
            loss_fp.flush()
            rate = (time.time() - t0) / steps_this_run
            eta = rate * (args.steps - step)
            print(f"step {step:5d}/{args.steps}  loss {last_loss:.4f}  lr {cur_lr:.2e}  "
                  f"({rate:.2f}s/step, eta {eta/60:.0f}m)", flush=True)

        if valid_batches and args.valid_every and step % args.valid_every == 0:
            vloss = validate(model, valid_batches, tokenizer.pad_id, device, args.valid_batches)
            valid_fp.write(f"{step}\t{vloss:.6f}\n")
            valid_fp.flush()
            print(f"  ↳ valid loss {vloss:.4f}  (step {step})", flush=True)
            if vloss < best_valid:
                best_valid = vloss
                save_checkpoint(best_out, model, tokenizer, config,
                                optimizer=opt, scheduler=sched, step=step, best_valid=best_valid)
                print(f"  ↳ new best — saved: {best_out}", flush=True)

        if args.save_every and step % args.save_every == 0:
            save_checkpoint(out, model, tokenizer, config,
                            optimizer=opt, scheduler=sched, step=step, best_valid=best_valid)
            print(f"  ↳ checkpoint saved: {out} (step {step})", flush=True)

    wall = time.time() - t0
    if steps_this_run:
        print(f"done: {steps_this_run} steps in {wall/60:.1f}m "
              f"({wall / steps_this_run:.2f}s/step), loss {first_loss:.4f} -> {last_loss:.4f}", flush=True)

    save_checkpoint(out, model, tokenizer, config,
                    optimizer=opt, scheduler=sched, step=max(start_step, args.steps),
                    best_valid=best_valid)
    loss_fp.close()
    valid_fp.close()
    print(f"saved loss log: {loss_file}", flush=True)
    best_note = f"{best_out} (valid {best_valid:.4f})" if best_out.exists() else "(none — no validation ran)"
    print(f"saved checkpoint: {out}  |  best: {best_note}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
