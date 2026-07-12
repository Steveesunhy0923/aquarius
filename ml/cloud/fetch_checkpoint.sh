#!/usr/bin/env bash
# Pull S2-XL training results off the cloud box into the local ml/checkpoints/.
#
# Usage:
#     ml/cloud/fetch_checkpoint.sh user@host [remote_ml_dir] [ssh_port]
#
#     user@host       e.g. root@203.0.113.7 (RunPod shows this on the Connect tab)
#     remote_ml_dir   default: mathwriting-run/ml   (relative to the remote $HOME)
#     ssh_port        default: 22 (RunPod pods often expose a custom port)
#
# Fetches (skipping any that don't exist yet — safe to run mid-training):
#     checkpoints/xl_best.pt    best-validation weights  <- serve with this one
#     checkpoints/xl.pt         latest periodic checkpoint
#     checkpoints/xl_loss.txt   step/loss/lr log
#     checkpoints/xl_valid.txt  validation curve
#     train.log                 full console output
#
# serve.py auto-prefers checkpoints/xl.pt over full.pt once it lands; to serve
# the best-validation weights instead:  INK_CHECKPOINT=checkpoints/xl_best.pt
set -euo pipefail

HOST="${1:?usage: fetch_checkpoint.sh user@host [remote_ml_dir] [ssh_port]}"
REMOTE_ML="${2:-mathwriting-run/ml}"
PORT="${3:-22}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CKPT="$(dirname "$SCRIPT_DIR")/checkpoints"
mkdir -p "$LOCAL_CKPT"

echo "fetching from $HOST:$REMOTE_ML (port $PORT) -> $LOCAL_CKPT"
for f in checkpoints/xl_best.pt checkpoints/xl.pt checkpoints/xl_loss.txt checkpoints/xl_valid.txt train.log; do
  if scp -P "$PORT" "$HOST:$REMOTE_ML/$f" "$LOCAL_CKPT/"; then
    echo "  ok:   $f"
  else
    echo "  skip: $f (not found on remote yet)"
  fi
done

echo
echo "done. local files:"
ls -lh "$LOCAL_CKPT"/xl* "$LOCAL_CKPT"/train.log 2>/dev/null || true
echo
echo "restart the recognition server to pick up xl.pt (it is auto-preferred),"
echo "or pin the best weights:  INK_CHECKPOINT=checkpoints/xl_best.pt"
echo "REMEMBER: stop the cloud instance once you've fetched — billing runs until you do."
