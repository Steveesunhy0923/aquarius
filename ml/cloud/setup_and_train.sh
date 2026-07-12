#!/usr/bin/env bash
# S2-XL cloud training bootstrap — fresh Ubuntu + CUDA box (RunPod 4090 /
# Lambda A100). Idempotent: safe to re-run; completed stages are skipped and
# an existing checkpoints/xl.pt is resumed, not clobbered.
#
# Usage (after scp/rsync-ing the repo's ml/ dir to the box — see ../cloud/README.md):
#     bash ml/cloud/setup_and_train.sh
#
# Optional: scp your user corrections next to train.py first —
#     ml/corrections/collected.jsonl
# and the run will mix them in (oversampled x32).
#
# Env overrides: RUN_DIR (default ~/mathwriting-run)
set -euo pipefail

banner() {
  printf '\n============================================================\n'
  printf '== %s\n' "$*"
  printf '============================================================\n'
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ML_SRC="$(dirname "$SCRIPT_DIR")"          # the ml/ dir this script sits in
RUN_DIR="${RUN_DIR:-$HOME/mathwriting-run}"
ML_RUN="$RUN_DIR/ml"
VENV="$RUN_DIR/venv"
PY="$VENV/bin/python"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

banner "1/6 system packages (python3-venv, rsync, tmux)"
if ! python3 -m venv --help >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y python3 python3-venv python3-pip
fi
if command -v apt-get >/dev/null 2>&1; then
  command -v rsync >/dev/null 2>&1 || $SUDO apt-get install -y rsync || true
  command -v tmux >/dev/null 2>&1 || $SUDO apt-get install -y tmux || true
fi
echo "python3: $(python3 --version)"

banner "2/6 venv + python deps -> $VENV"
mkdir -p "$RUN_DIR"
[ -x "$PY" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip -q
# default PyPI torch wheels bundle CUDA on linux x86_64
"$VENV/bin/pip" install torch numpy pillow tqdm requests
"$PY" - <<'PYEOF'
import torch
print(f"torch {torch.__version__}, cuda available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"gpu: {torch.cuda.get_device_name(0)}, bf16: {torch.cuda.is_bf16_supported()}")
else:
    print("WARNING: no CUDA device visible — training would run on CPU!")
PYEOF

banner "3/6 copy ml/ source -> $ML_RUN"
if [ "$ML_SRC" = "$ML_RUN" ]; then
  echo "already running from $ML_RUN — skipping copy"
else
  mkdir -p "$ML_RUN"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.venv' --exclude '__pycache__' --exclude '*.mlpackage' \
      --exclude 'data/mathwriting-2024*' --exclude 'checkpoints/*.pt' \
      "$ML_SRC/" "$ML_RUN/"
  else
    cp -R "$ML_SRC/." "$ML_RUN/"
  fi
  echo "copied $ML_SRC -> $ML_RUN"
fi
cd "$ML_RUN"

banner "4/6 dataset (full MathWriting, ~2.9 GB download)"
"$PY" data/download_mathwriting.py --full
DATA_ROOT="data/mathwriting-2024"

banner "5/6 vocab"
VOCAB="checkpoints/vocab_full.json"
if [ -f "$VOCAB" ]; then
  echo "vocab already built: $VOCAB"
else
  "$PY" - <<'PYEOF'
import sys
sys.path.insert(0, ".")
from src.latex_tokenizer import build_vocab_from_split
tok = build_vocab_from_split("data/mathwriting-2024/train")
tok.save("checkpoints/vocab_full.json")
print(f"vocab: {len(tok)} tokens -> checkpoints/vocab_full.json")
PYEOF
fi

banner "6/6 launch S2-XL training"
CMD=("$PY" train.py
  --steps 150000 --batch-size 128 --model-size xl
  --synthetic --augment
  --num-workers 12
  --save-every 2000 --valid-every 2000 --valid-batches 40
  --warmup-steps 3000 --lr 5e-4
  --data "$DATA_ROOT" --vocab "$VOCAB"
  --out checkpoints/xl.pt)
if [ -f corrections/collected.jsonl ]; then
  echo "found user corrections: corrections/collected.jsonl (mixing in, x32)"
  CMD+=(--corrections corrections/collected.jsonl --corrections-repeat 32)
elif [ -f data/corrections/collected.jsonl ]; then
  echo "found user corrections: data/corrections/collected.jsonl (mixing in, x32)"
  CMD+=(--corrections data/corrections/collected.jsonl --corrections-repeat 32)
else
  echo "no corrections file found (optional) — training on MathWriting only"
fi
if [ -f checkpoints/xl.pt ]; then
  echo "checkpoints/xl.pt exists — resuming from it"
  CMD+=(--resume checkpoints/xl.pt)
fi

CMD_STR="$(printf '%q ' "${CMD[@]}")"
echo "command: $CMD_STR"

if command -v tmux >/dev/null 2>&1; then
  if tmux has-session -t train 2>/dev/null; then
    echo "tmux session 'train' already running — attach with: tmux attach -t train"
    exit 0
  fi
  tmux new-session -d -s train "cd $(printf '%q' "$ML_RUN") && $CMD_STR 2>&1 | tee -a train.log"
  banner "training launched in tmux session 'train'"
  echo "  monitor:  tmux attach -t train      (detach: Ctrl-b d)"
else
  if pgrep -f "train.py .*--out checkpoints/xl.pt" >/dev/null 2>&1; then
    echo "training already running (pgrep) — tail -f $ML_RUN/train.log"
    exit 0
  fi
  nohup "${CMD[@]}" >> train.log 2>&1 &
  banner "training launched via nohup (pid $!)"
fi
echo "  logs:     tail -f $ML_RUN/train.log"
echo "  curves:   tail -f $ML_RUN/checkpoints/xl_loss.txt $ML_RUN/checkpoints/xl_valid.txt"
echo "  results:  checkpoints/xl.pt (periodic) + checkpoints/xl_best.pt (best valid)"
echo "  REMEMBER: stop the cloud instance when done — billing runs until you do."
