"""Handwritten words -> plain text via Apple Vision (macOS dev path).

This is the TEXT counterpart of the math recognizer: strokes are rasterized
(same renderer the math model uses, at OCR-friendly resolution) and handed to
`VNRecognizeTextRequest` — the same recognition engine family that iPadOS
ships, so dev-session behavior is representative of the eventual on-device
iPad build (see docs/MODULES.md "Handwritten words → text" decision record).

macOS-only by nature: pyobjc + Vision.framework. Callers must treat
`VisionUnavailable` as "fall back to 501" so the server still runs on Linux
(e.g. the cloud training pod imports serve.py's modules without Vision).

    recognize_text(strokes) -> (text, confidence)
"""

from __future__ import annotations

import io

from .render import render_strokes

# OCR wants more pixels than the 96px math model input, and a pen weight
# around ~9% of the letter height — Vision ignores hairline strokes entirely
# (verified empirically: width 10-14px on 256px letters → nothing; 24px →
# perfect recognition at 1.0 confidence).
OCR_HEIGHT = 256
OCR_MAX_WIDTH = 2048
OCR_LINE_WIDTH = 22.0


class VisionUnavailable(RuntimeError):
    """Apple Vision is not importable/usable on this platform."""


def _load_vision():
    try:
        import Quartz  # noqa: F401
        import Vision  # noqa: F401
        from Foundation import NSData  # noqa: F401
    except Exception as e:  # pragma: no cover - platform dependent
        raise VisionUnavailable(f"Apple Vision not available: {e}") from e
    return Vision, Quartz


def recognize_text(strokes: list[dict]) -> tuple[str, float]:
    """OCR handwritten strokes into plain text.

    Returns (text, mean confidence 0..1). Raises VisionUnavailable off-macOS.
    """
    Vision, Quartz = _load_vision()
    from Foundation import NSData

    img = render_strokes(
        strokes, height=OCR_HEIGHT, max_width=OCR_MAX_WIDTH, line_width=OCR_LINE_WIDTH
    )
    # The renderer left-aligns and pads to max_width with white; a page-wide
    # empty margin hurts OCR, so crop to the ink plus a comfortable border.
    bbox = img.point(lambda p: 0 if p > 245 else 255).getbbox()
    if bbox is not None:
        pad = 24
        img = img.crop((
            max(0, bbox[0] - pad), max(0, bbox[1] - pad),
            min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad),
        ))
    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    data = NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))

    src = Quartz.CGImageSourceCreateWithData(data, None)
    if src is None:
        return "", 0.0
    cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if cg is None:
        return "", 0.0

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(True)

    ok, err = handler.performRequests_error_([request], None)
    if not ok:
        raise VisionUnavailable(f"Vision request failed: {err}")

    lines: list[str] = []
    confidences: list[float] = []
    for obs in request.results() or []:
        top = obs.topCandidates_(1)
        if not top or top.count() == 0:
            continue
        cand = top.objectAtIndex_(0)
        text = str(cand.string()).strip()
        if text:
            lines.append(text)
            confidences.append(float(cand.confidence()))

    text = "\n".join(lines)
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return text, max(0.0, min(1.0, confidence))


if __name__ == "__main__":
    # Self-test with synthetic block letters "HELLO" from line segments/polylines.
    def seg(x0, y0, x1, y1, t0):
        return {"x": [x0, x1], "y": [y0, y1], "t": [t0, t0 + 80]}

    import math

    def circle(cx, cy, r, t0, n=24):
        xs = [cx + r * math.cos(2 * math.pi * i / n) for i in range(n + 1)]
        ys = [cy + r * math.sin(2 * math.pi * i / n) for i in range(n + 1)]
        return {"x": xs, "y": ys, "t": [t0 + 10 * i for i in range(n + 1)]}

    hello = [
        seg(0, 0, 0, 100, 0), seg(45, 0, 45, 100, 100), seg(0, 50, 45, 50, 200),          # H
        seg(75, 0, 75, 100, 300), seg(75, 0, 120, 0, 400), seg(75, 50, 110, 50, 500), seg(75, 100, 120, 100, 600),  # E
        seg(150, 0, 150, 100, 700), seg(150, 100, 190, 100, 800),                          # L
        seg(220, 0, 220, 100, 900), seg(220, 100, 260, 100, 1000),                         # L
        circle(315, 50, 48, 1100),                                                          # O
    ]
    text, conf = recognize_text(hello)
    print(f"recognized: {text!r}  (confidence {conf:.2f})")
