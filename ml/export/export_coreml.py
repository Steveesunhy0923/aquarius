#!/usr/bin/env python3
"""Best-effort CoreML export of the ink->LaTeX model (coremltools 9.0).

    cd ml && .venv/bin/python export/export_coreml.py [--checkpoint checkpoints/smoke.pt]

Exports two ML Programs (.mlpackage):
  1. ink_encoder:      image [1,1,96,768] float -> memory [1,288,256]
  2. ink_decoder_step: (memory [1,288,256], tokens [1,160] int32)
                       -> logits [1,160,vocab] for ALL positions.
     The on-device greedy loop pads `tokens` with pad_id to length 160 and
     reads logits at index (n_real_tokens - 1) each step.

Export-friendliness notes (learned the hard way; see comments inline):
  - coremltools 9.0 officially supports torch <= 2.7; this venv has torch
    2.12.1. The conversion DOES work for this model, but only after:
    a) avoiding dynamic-shape ints in traced code: Encoder.forward slices
       pos2d[:h*w] from traced tensor shapes, which becomes an aten::Int op
       that coremltools 9.0 crashes on ("only 0-dimensional arrays can be
       converted to Python scalars"). The EncoderExport wrapper adds the
       full pos2d buffer instead (shapes are fixed at export time).
    b) torch.jit.trace(check_trace=False): nn.MultiheadAttention's traced
       graph fails torch's own trace sanity check under torch 2.12
       (constant-folding differences across invocations), but the traced
       graph itself is fine for fixed shapes.
    c) replacing nn.MultiheadAttention with ManualAttention (same weights,
       plain matmul/softmax): even a traced MHA emits the same aten::Int
       shape ops as (a) inside F.multi_head_attention_forward. The manual
       version matches nn.TransformerDecoder output to ~4e-6.
    d) dropping tgt_key_padding_mask in the decoder wrapper: greedy decode
       only reads the logits at the last REAL token position, and the causal
       mask already prevents earlier positions from seeing padding, so the
       padding mask is unnecessary — and bool key-padding masks are a
       frequent CoreML conversion failure.
  - A flexible token length (ct.RangeDim) was attempted first and abandoned:
    the dynamic-int slicing it requires reintroduces failure (a) above.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

import torch
import torch.nn as nn

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from src.model import InkToLatex  # noqa: E402


class EncoderExport(nn.Module):
    """Encoder without dynamic-shape slicing (fixed input size)."""

    def __init__(self, model: InkToLatex):
        super().__init__()
        self.blocks = model.encoder.blocks
        self.register_buffer("pos2d", model.encoder.pos2d.clone())

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        f = self.blocks(image)               # [1, D, h, w]
        seq = f.flatten(2).transpose(1, 2)   # [1, h*w, D]
        return seq + self.pos2d


class ManualAttention(nn.Module):
    """nn.MultiheadAttention re-expressed as plain matmuls with fixed shapes.

    torch's F.multi_head_attention_forward emits aten::Int shape ops that
    coremltools 9.0 cannot convert under torch 2.12 tracing; this manual
    version (same weights, same math, eval-mode dropout=identity) avoids them.
    """

    def __init__(self, mha: nn.MultiheadAttention, nhead: int):
        super().__init__()
        d = mha.embed_dim
        self.nhead, self.dh, self.d = nhead, d // nhead, d
        self.register_buffer("w_q", mha.in_proj_weight[:d].clone())
        self.register_buffer("w_k", mha.in_proj_weight[d : 2 * d].clone())
        self.register_buffer("w_v", mha.in_proj_weight[2 * d :].clone())
        self.register_buffer("b_q", mha.in_proj_bias[:d].clone())
        self.register_buffer("b_k", mha.in_proj_bias[d : 2 * d].clone())
        self.register_buffer("b_v", mha.in_proj_bias[2 * d :].clone())
        self.out_proj = mha.out_proj
        self.scale = self.dh ** -0.5

    def forward(self, q, k, v, mask=None):
        tq, tk = q.shape[1], k.shape[1]  # python ints under fixed-shape trace
        q = (q @ self.w_q.T + self.b_q).view(1, tq, self.nhead, self.dh).transpose(1, 2)
        k = (k @ self.w_k.T + self.b_k).view(1, tk, self.nhead, self.dh).transpose(1, 2)
        v = (v @ self.w_v.T + self.b_v).view(1, tk, self.nhead, self.dh).transpose(1, 2)
        scores = (q @ k.transpose(-2, -1)) * self.scale
        if mask is not None:
            scores = scores + mask  # additive float mask (0 / -1e4)
        attn = torch.softmax(scores, dim=-1) @ v  # [1, H, Tq, dh]
        attn = attn.transpose(1, 2).reshape(1, tq, self.d)
        return self.out_proj(attn)


class ManualDecoderLayer(nn.Module):
    """norm_first nn.TransformerDecoderLayer with ManualAttention, eval mode."""

    def __init__(self, layer: nn.TransformerDecoderLayer, nhead: int):
        super().__init__()
        self.self_attn = ManualAttention(layer.self_attn, nhead)
        self.cross_attn = ManualAttention(layer.multihead_attn, nhead)
        self.norm1, self.norm2, self.norm3 = layer.norm1, layer.norm2, layer.norm3
        self.linear1, self.linear2 = layer.linear1, layer.linear2

    def forward(self, x, memory, mask):
        y = self.norm1(x)
        x = x + self.self_attn(y, y, y, mask)
        y = self.norm2(x)
        x = x + self.cross_attn(y, memory, memory)
        y = self.norm3(x)
        return x + self.linear2(torch.relu(self.linear1(y)))


class DecoderStepExport(nn.Module):
    """Fixed-length decoder pass: (memory, tokens[1,T]) -> logits [1,T,V].

    No tgt_key_padding_mask: greedy decode only reads logits at the last
    real-token position, and the causal mask keeps earlier positions from
    attending to padding, so it is mathematically unnecessary there.
    """

    def __init__(self, model: InkToLatex, t: int, nhead: int):
        super().__init__()
        self.embed = model.embed
        self.layers = nn.ModuleList(
            ManualDecoderLayer(l, nhead) for l in model.decoder.layers
        )
        self.out = model.out
        self.register_buffer("pos1d", model.pos1d[:t].clone())
        causal = torch.triu(torch.full((t, t), -1e4), diagonal=1)
        self.register_buffer("mask", causal)  # additive float causal mask

    def forward(self, memory: torch.Tensor, tokens: torch.Tensor) -> torch.Tensor:
        x = self.embed(tokens.to(torch.long)) + self.pos1d
        for layer in self.layers:
            x = layer(x, memory, self.mask)
        return self.out(x)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", default=str(ML_DIR / "checkpoints" / "smoke.pt"))
    ap.add_argument("--out-dir", default=str(ML_DIR / "export"))
    args = ap.parse_args()

    import coremltools as ct  # deferred: heavy import

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    cfg = ckpt["config"]
    model = InkToLatex(**cfg)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    h, w, d = cfg["height"], cfg["width"], cfg["d_model"]
    seq = (h // 16) * (w // 16)
    max_len = cfg["max_len"]
    ok = True

    # ---- 1. encoder ------------------------------------------------------
    try:
        enc = EncoderExport(model).eval()
        image = torch.rand(1, 1, h, w)
        traced = torch.jit.trace(enc, image, check_trace=False)
        mlmodel = ct.convert(
            traced,
            convert_to="mlprogram",
            inputs=[ct.TensorType(name="image", shape=(1, 1, h, w))],
            outputs=[ct.TensorType(name="memory")],
            minimum_deployment_target=ct.target.iOS16,
        )
        # parity check against the pytorch encoder
        with torch.no_grad():
            ref = model.encoder(image).numpy()
        got = mlmodel.predict({"image": image.numpy()})["memory"]
        err = float(abs(ref - got).max())
        enc_path = out_dir / "ink_encoder.mlpackage"
        mlmodel.save(str(enc_path))
        print(f"encoder exported -> {enc_path} (max abs err vs torch: {err:.5f})")
    except Exception:
        ok = False
        print("ENCODER EXPORT FAILED:")
        traceback.print_exc()

    # ---- 2. single decoder step (fixed length) ----------------------------
    try:
        step = DecoderStepExport(model, max_len, cfg["nhead"]).eval()
        memory = torch.rand(1, seq, d)
        # non-pad tokens: parity check vs decode_step (which masks pad keys)
        tokens = torch.randint(4, cfg["vocab_size"], (1, max_len), dtype=torch.int32)
        with torch.no_grad():  # manual attention must match torch's decoder
            ref_torch = model.decode_step(memory, tokens.to(torch.long)).numpy()
            ref_manual = step(memory, tokens).numpy()
        manual_err = float(abs(ref_torch - ref_manual).max())
        print(f"manual decoder vs nn.TransformerDecoder max abs err: {manual_err:.6f}")
        traced = torch.jit.trace(step, (memory, tokens), check_trace=False)
        mlmodel = ct.convert(
            traced,
            convert_to="mlprogram",
            inputs=[
                ct.TensorType(name="memory", shape=(1, seq, d)),
                ct.TensorType(name="tokens", shape=(1, max_len), dtype=int),
            ],
            outputs=[ct.TensorType(name="logits")],
            minimum_deployment_target=ct.target.iOS16,
        )
        with torch.no_grad():
            ref = step(memory, tokens).numpy()
        got = mlmodel.predict(
            {"memory": memory.numpy(), "tokens": tokens.numpy().astype("int32")}
        )["logits"]
        err = float(abs(ref - got).max())
        dec_path = out_dir / "ink_decoder_step.mlpackage"
        mlmodel.save(str(dec_path))
        print(f"decoder step exported -> {dec_path} (max abs err vs torch: {err:.5f})")
    except Exception:
        ok = False
        print("DECODER STEP EXPORT FAILED:")
        traceback.print_exc()

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
