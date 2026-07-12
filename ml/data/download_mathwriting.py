#!/usr/bin/env python3
"""Download and extract the Google MathWriting 2024 dataset.

By default downloads the small EXCERPT archive (~1.6 MB), which is enough
to prove the training pipeline end to end.

Usage:
    python ml/data/download_mathwriting.py            # excerpt (default)
    python ml/data/download_mathwriting.py --full     # full dataset (~3 GB!)

The archives extract to:
    ml/data/mathwriting-2024-excerpt/   (excerpt)
    ml/data/mathwriting-2024/           (full)

Layout inside each: train/ valid/ test/ symbols/ directories of *.inkml
files (the excerpt has a flat subset of the same splits), plus a README.

Source: https://github.com/google-research/mathwriting
"""

from __future__ import annotations

import argparse
import sys
import tarfile
from pathlib import Path

import requests
from tqdm import tqdm

EXCERPT_URL = "https://storage.googleapis.com/mathwriting_data/mathwriting-2024-excerpt.tgz"
FULL_URL = "https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz"

DATA_DIR = Path(__file__).resolve().parent


def download(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"already downloaded: {dest}")
        return
    print(f"downloading {url}")
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))
    tmp = dest.with_suffix(dest.suffix + ".part")
    with open(tmp, "wb") as f, tqdm(
        total=total, unit="B", unit_scale=True, desc=dest.name
    ) as bar:
        for chunk in resp.iter_content(chunk_size=1 << 20):
            f.write(chunk)
            bar.update(len(chunk))
    tmp.rename(dest)
    print(f"saved {dest} ({dest.stat().st_size} bytes)")


def extract(archive: Path, out_dir: Path) -> None:
    print(f"extracting {archive} -> {out_dir}")
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(out_dir)
    print("done")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--full",
        action="store_true",
        help="download the FULL mathwriting-2024 dataset (~3 GB) instead of the excerpt",
    )
    args = parser.parse_args()

    url = FULL_URL if args.full else EXCERPT_URL
    archive = DATA_DIR / url.rsplit("/", 1)[-1]
    marker = DATA_DIR / archive.name.removesuffix(".tgz")
    # written only after a COMPLETE extractall — a dir that merely exists may
    # be a partial extraction from an interrupted earlier run
    complete = marker / ".extract-complete"

    if complete.exists():
        print(f"already extracted: {marker}")
        return 0
    if marker.is_dir():
        print(f"found INCOMPLETE extraction at {marker} — re-extracting")

    download(url, archive)
    extract(archive, DATA_DIR)

    if marker.is_dir():
        n = sum(1 for _ in marker.rglob("*.inkml"))
        complete.touch()
        print(f"extracted {n} .inkml files under {marker}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
