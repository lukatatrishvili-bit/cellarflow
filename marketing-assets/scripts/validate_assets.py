from __future__ import annotations

import csv
import hashlib
import os
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "marketing-assets"
MANIFEST = ASSETS / "manifest.csv"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def load_video_reader():
    try:
        import imageio_ffmpeg  # type: ignore
    except ImportError:
        runtime = Path(os.environ.get("CODEX_MEDIA_RUNTIME", Path.home() / ".cache" / "codex-media-runtime"))
        sys.path.insert(0, str(runtime))
        import imageio_ffmpeg  # type: ignore
    return imageio_ffmpeg


def validate() -> None:
    failures: list[str] = []
    with MANIFEST.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    manifest_paths = {row["path"] for row in rows}
    actual_paths = {
        path.relative_to(ASSETS).as_posix()
        for path in ASSETS.rglob("*")
        if path.is_file() and path != MANIFEST and "__pycache__" not in path.parts
    }
    if manifest_paths != actual_paths:
        missing = sorted(actual_paths - manifest_paths)
        stale = sorted(manifest_paths - actual_paths)
        if missing:
            failures.append(f"manifest missing: {missing}")
        if stale:
            failures.append(f"manifest stale: {stale}")

    imageio_ffmpeg = load_video_reader()
    for row in rows:
        relative = row["path"]
        path = ASSETS / relative
        if not path.exists():
            failures.append(f"missing file: {relative}")
            continue
        if digest(path) != row["sha256"]:
            failures.append(f"checksum mismatch: {relative}")
        suffix = path.suffix.lower()
        if suffix == ".png":
            if path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                failures.append(f"not a real PNG: {relative}")
            try:
                with Image.open(path) as image:
                    image.verify()
                with Image.open(path) as image:
                    if row["width"] and int(row["width"]) != image.width:
                        failures.append(f"width mismatch: {relative}")
                    if row["height"] and int(row["height"]) != image.height:
                        failures.append(f"height mismatch: {relative}")
            except Exception as exc:
                failures.append(f"image decode failed: {relative}: {exc}")
        elif suffix == ".mp4":
            try:
                reader = imageio_ffmpeg.read_frames(str(path), pix_fmt="rgb24")
                metadata = next(reader)
                frame_count = 0
                for _ in reader:
                    frame_count += 1
                reader.close()
                if metadata.get("codec") != "h264":
                    failures.append(f"unexpected video codec: {relative}: {metadata.get('codec')}")
                if metadata.get("pix_fmt") != "yuv420p(progressive)":
                    failures.append(f"unexpected pixel format: {relative}: {metadata.get('pix_fmt')}")
                if frame_count < 400:
                    failures.append(f"too few decoded frames: {relative}: {frame_count}")
            except Exception as exc:
                failures.append(f"video decode failed: {relative}: {exc}")

    if failures:
        raise SystemExit("FAIL\n- " + "\n- ".join(failures))
    print(f"PASS: {len(rows)} manifested assets validated; all images and videos decode cleanly.")


if __name__ == "__main__":
    validate()
