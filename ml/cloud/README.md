# S2-XL cloud training runbook

Train the bigger "xl" handwriting→LaTeX model (384 d_model / 8 heads /
6 layers / 1536 FF, ~15M params) on the full MathWriting dataset
(230k human + 396k synthetic samples) with stroke augmentation, on a rented
CUDA GPU. The local MPS workflow is untouched — this is purely additive.

**TL;DR**: rent a GPU box → rsync `ml/` up → `bash ml/cloud/setup_and_train.sh`
→ wait ~4–7 h → `ml/cloud/fetch_checkpoint.sh user@host` → restart the local
server → **STOP THE INSTANCE**.

## 1. Rent an instance

Either provider works; you need Ubuntu 22.04+, CUDA drivers preinstalled
(both providers' default images have them), ~60 GB disk, SSH access.

**RunPod (RTX 4090, ~$0.40–0.70/h)**
1. runpod.io → Deploy → GPU Pod → RTX 4090 (secure or community cloud).
2. Template: "RunPod PyTorch" or any Ubuntu CUDA image (the script installs
   its own venv + torch anyway).
3. Disk: set the volume to ≥ 60 GB (dataset is ~3 GB archive + ~14 GB extracted).
4. Deploy, then grab SSH command from Connect → "SSH over exposed TCP"
   (note the custom port, e.g. `ssh root@203.0.113.7 -p 12345`).

**Lambda (A100 40GB, ~$1.10–1.30/h)**
1. cloud.lambda.ai → Launch instance → 1x A100.
2. Add your SSH key; launch. Connect: `ssh ubuntu@<ip>` (port 22).

## 2. Upload the ml/ source (no git needed)

From the repo root on your Mac — excludes the venv, datasets, and local
checkpoints (the box downloads its own data):

```bash
rsync -av -e "ssh -p <PORT>" \
  --exclude '.venv' --exclude '__pycache__' --exclude 'data/mathwriting-2024*' \
  --exclude 'checkpoints' --exclude 'export/*.mlpackage' \
  ml/ <USER>@<HOST>:~/mathwriting-run/ml/
```

**Optional — include your collected corrections** (oversampled x32 during
training):

```bash
ssh -p <PORT> <USER>@<HOST> 'mkdir -p ~/mathwriting-run/ml/corrections'
scp -P <PORT> ml/data/corrections/collected.jsonl \
  <USER>@<HOST>:~/mathwriting-run/ml/corrections/
```

## 3. Launch

```bash
ssh -p <PORT> <USER>@<HOST>
bash ~/mathwriting-run/ml/cloud/setup_and_train.sh
```

The script is idempotent (re-run it after any hiccup; it skips finished
stages and auto-resumes from an existing `checkpoints/xl.pt`). Stages:
system packages → venv + CUDA torch → copy source → download/extract full
MathWriting → build vocab → launch training in tmux session `train`:

```
python train.py --steps 150000 --batch-size 128 --model-size xl \
  --synthetic --augment --num-workers 12 --save-every 2000 \
  --valid-every 2000 --valid-batches 40 --warmup-steps 3000 --lr 5e-4 \
  --data data/mathwriting-2024 --vocab checkpoints/vocab_full.json \
  --out checkpoints/xl.pt
  [--corrections corrections/collected.jsonl --corrections-repeat 32]
```

## 4. Monitor

```bash
tmux attach -t train          # live console (detach: Ctrl-b d)
tail -f ~/mathwriting-run/ml/train.log
tail -f ~/mathwriting-run/ml/checkpoints/xl_valid.txt   # step <TAB> valid loss
nvidia-smi                    # GPU should sit near 100% util
```

Expect the first ~10 minutes to be dataset download/extraction, then a
one-time vocab scan (~1–2 min). `xl_loss.txt` is `step\tloss\tlr`;
`xl_best.pt` appears whenever validation improves.

## 5. Cost & time expectations

| GPU | s/step (batch 128, AMP) | 150k steps | approx cost |
| --- | --- | --- | --- |
| RTX 4090 | ~0.10–0.16 | ~4–7 h | ~$3–6 |
| A100 40GB | similar or faster | ~4–6 h | ~$5–8 |

If data loading (not the GPU) is the bottleneck, `nvidia-smi` shows low
utilization — bump `--num-workers` (the script default is 12).

## 6. Fetch the results (from your Mac)

```bash
ml/cloud/fetch_checkpoint.sh <USER>@<HOST>                      # port 22
ml/cloud/fetch_checkpoint.sh <USER>@<HOST> mathwriting-run/ml 12345  # custom port
```

Pulls `xl_best.pt`, `xl.pt`, both logs, and `train.log` into `ml/checkpoints/`.
Safe to run mid-training for a progress snapshot.

## 7. Swap in locally

`serve.py` auto-prefers `checkpoints/xl.pt` over `full.pt` — just restart the
recognition server:

```bash
cd ml && .venv/bin/uvicorn serve:app --host 127.0.0.1 --port 8787
curl http://127.0.0.1:8787/health     # -> {"model":"xl.pt", ...}
```

To serve the best-validation weights instead (usually the better pick):

```bash
INK_CHECKPOINT=checkpoints/xl_best.pt .venv/bin/uvicorn serve:app --port 8787
```

## 8. STOP THE INSTANCE

Billing runs until the pod/instance is stopped or terminated, not when
training finishes. After fetching:

- **RunPod**: My Pods → Stop (still bills disk) or **Terminate** (bills nothing).
- **Lambda**: Instances → **Terminate** (Lambda has no stopped-but-kept state).

Double-check the dashboard shows nothing running before you close the tab.
