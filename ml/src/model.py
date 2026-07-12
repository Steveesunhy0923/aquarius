"""CNN encoder + Transformer decoder for handwriting -> LaTeX.

Encoder: 4 stride-2 conv blocks (1->32->64->128->d_model) reduce the
[1, 96, 768] image to a [d_model, 6, 48] feature map, which gets fixed 2D
sinusoidal positional encodings and is flattened to a 288-step sequence.

Decoder: nn.TransformerDecoder (4 layers, d_model 256, 8 heads) with learned
token embeddings + 1D sinusoidal positions, causal mask, tied to vocab logits.

greedy_decode(max_len=160) returns token ids and mean token log-prob
(exp of which serves as the confidence score).
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


def sinusoid_1d(length: int, dim: int) -> torch.Tensor:
    """[length, dim] fixed sinusoidal encoding."""
    pos = torch.arange(length, dtype=torch.float32).unsqueeze(1)
    div = torch.exp(torch.arange(0, dim, 2, dtype=torch.float32) * (-math.log(10000.0) / dim))
    pe = torch.zeros(length, dim)
    pe[:, 0::2] = torch.sin(pos * div)
    pe[:, 1::2] = torch.cos(pos * div)
    return pe


def sinusoid_2d(h: int, w: int, dim: int) -> torch.Tensor:
    """[h*w, dim]: first half encodes y, second half encodes x."""
    assert dim % 2 == 0
    pe_y = sinusoid_1d(h, dim // 2).unsqueeze(1).expand(h, w, dim // 2)
    pe_x = sinusoid_1d(w, dim // 2).unsqueeze(0).expand(h, w, dim // 2)
    return torch.cat([pe_y, pe_x], dim=-1).reshape(h * w, dim)


def conv_block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(cin, cout, kernel_size=3, stride=2, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, kernel_size=3, stride=1, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
    )


class Encoder(nn.Module):
    def __init__(self, d_model: int = 256, height: int = 96, width: int = 768):
        super().__init__()
        self.blocks = nn.Sequential(
            conv_block(1, 32),
            conv_block(32, 64),
            conv_block(64, 128),
            conv_block(128, d_model),
        )
        fh, fw = height // 16, width // 16
        self.register_buffer("pos2d", sinusoid_2d(fh, fw, d_model), persistent=False)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        """[B,1,H,W] -> [B, (H/16)*(W/16), d_model]"""
        f = self.blocks(images)                      # [B, D, h, w]
        b, d, h, w = f.shape
        seq = f.flatten(2).transpose(1, 2)           # [B, h*w, D]
        return seq + self.pos2d[: h * w].to(seq.dtype)


class InkToLatex(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        d_model: int = 256,
        nhead: int = 8,
        num_layers: int = 4,
        dim_feedforward: int = 1024,
        dropout: float = 0.1,
        max_len: int = 160,
        height: int = 96,
        width: int = 768,
        pad_id: int = 0,
        sos_id: int = 1,
        eos_id: int = 2,
    ):
        super().__init__()
        self.vocab_size = vocab_size
        self.max_len = max_len
        self.pad_id, self.sos_id, self.eos_id = pad_id, sos_id, eos_id

        self.encoder = Encoder(d_model, height, width)
        self.embed = nn.Embedding(vocab_size, d_model, padding_idx=pad_id)
        self.register_buffer("pos1d", sinusoid_1d(max_len + 1, d_model), persistent=False)
        layer = nn.TransformerDecoderLayer(
            d_model, nhead, dim_feedforward, dropout, batch_first=True, norm_first=True
        )
        self.decoder = nn.TransformerDecoder(layer, num_layers)
        self.out = nn.Linear(d_model, vocab_size)

    def decode_step(self, memory: torch.Tensor, tokens: torch.Tensor) -> torch.Tensor:
        """memory [B,S,D], tokens [B,T] -> logits [B,T,V]"""
        t = tokens.shape[1]
        x = self.embed(tokens) + self.pos1d[:t].to(memory.dtype)
        # bool mask matches the bool key_padding_mask (avoids dtype-mismatch warning)
        mask = torch.triu(
            torch.ones(t, t, dtype=torch.bool, device=tokens.device), diagonal=1
        )
        h = self.decoder(
            x,
            memory,
            tgt_mask=mask,
            tgt_key_padding_mask=(tokens == self.pad_id),
        )
        return self.out(h)

    def forward(self, images: torch.Tensor, tokens: torch.Tensor) -> torch.Tensor:
        """Teacher-forced logits for training: [B,1,H,W], [B,T] -> [B,T,V]."""
        return self.decode_step(self.encoder(images), tokens)

    @torch.no_grad()
    def greedy_decode(self, images: torch.Tensor, max_len: int = 160):
        """-> (list of id-lists without sos/eos, mean token log-prob per sample)"""
        self.eval()
        memory = self.encoder(images)
        b = images.shape[0]
        device = images.device
        tokens = torch.full((b, 1), self.sos_id, dtype=torch.long, device=device)
        done = torch.zeros(b, dtype=torch.bool, device=device)
        logp_sum = torch.zeros(b, device=device)
        logp_cnt = torch.zeros(b, device=device)

        for _ in range(max_len):
            logits = self.decode_step(memory, tokens)[:, -1]      # [B, V]
            logprobs = F.log_softmax(logits, dim=-1)
            next_tok = logprobs.argmax(dim=-1)                     # [B]
            step_logp = logprobs.gather(1, next_tok.unsqueeze(1)).squeeze(1)
            logp_sum += torch.where(done, torch.zeros_like(step_logp), step_logp)
            logp_cnt += (~done).float()
            next_tok = torch.where(done, torch.full_like(next_tok, self.pad_id), next_tok)
            tokens = torch.cat([tokens, next_tok.unsqueeze(1)], dim=1)
            done |= next_tok == self.eos_id
            if bool(done.all()):
                break

        seqs = []
        for row in tokens[:, 1:].tolist():
            out = []
            for tok in row:
                if tok in (self.eos_id, self.pad_id):
                    break
                out.append(tok)
            seqs.append(out)
        mean_logp = logp_sum / logp_cnt.clamp(min=1)
        return seqs, mean_logp

    def param_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


if __name__ == "__main__":
    model = InkToLatex(vocab_size=200)
    print(f"parameters: {model.param_count():,}")
    imgs = torch.rand(2, 1, 96, 768)
    toks = torch.randint(0, 200, (2, 12))
    print(f"train logits: {tuple(model(imgs, toks).shape)}")
    seqs, logp = model.greedy_decode(imgs, max_len=8)
    print(f"greedy: lens={[len(s) for s in seqs]}, mean logp={logp.tolist()}")
