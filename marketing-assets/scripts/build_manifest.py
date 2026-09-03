from __future__ import annotations

import csv
import hashlib
import mimetypes
import os
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "marketing-assets"


ALT_TEXT = {
    "photos/01-kakheti-vineyard-operations-hero.png": "Vineyard manager reviewing a tablet among Kakheti vineyard rows at sunrise.",
    "photos/02-qvevri-cellar-operations-hero.png": "Winemaker using a tablet while inspecting an open qvevri in a Georgian cellar.",
    "photos/03-modern-cellar-lab-operations-hero.png": "Winemaker taking a laboratory sample beside stainless-steel fermentation tanks.",
    "photos/contact-sheet.png": "Three VinOS campaign photographs showing vineyard, qvevri cellar, and laboratory work.",
    "images/contact-sheet-en.png": "Six English VinOS product screens covering dashboard, vineyard, weather, cellar, fermentation, and AI.",
    "images/contact-sheet-ka.png": "VinOS-ის ექვსი პროდუქტის ეკრანი ქართულ ინტერფეისში: დაფა, ვენახი, ამინდი, მარანი, დუღილი და AI.",
    "posters/vinos-product-tour-en-cover.png": "English VinOS product-tour cover with vineyard-to-bottle campaign headline.",
    "posters/vinos-product-tour-ka-cover.png": "VinOS-ის ქართული პროდუქტის ვიდეოს ყდა კამპანიის სათაურით — ვენახიდან ბოთლამდე.",
    "videos/vinos-product-tour-en.mp4": "Silent English VinOS product tour showing vineyard and cellar workflows.",
    "videos/vinos-product-tour-ka.mp4": "VinOS-ის უხმო ქართული პროდუქტის ვიდეო, რომელიც ვენახისა და მარნის სამუშაო პროცესებს აჩვენებს.",
}


SCREEN_ALT_EN = {
    "01-dashboard-overview": "VinOS attention dashboard with fictional demo alerts and operational priorities.",
    "02-vineyard-operations": "VinOS vineyard management screen with recorded block status and field tools.",
    "03-vineyard-intelligence": "VinOS agro-weather screen with forecast data and rule-based risk indicators.",
    "04-cellar-command-center": "VinOS cellar overview with recorded lot, vessel, fermentation, and chemistry status.",
    "05-fermentation-tracking": "VinOS fermentation screen with recorded curves and daily readings.",
    "06-ai-winemaker": "VinOS AI assistant panel with review-only draft actions beside the cellar workspace.",
}


SCREEN_ALT_KA = {
    "01-dashboard-overview": "VinOS-ის ყურადღების დაფა გამოგონილი დემო გაფრთხილებებითა და საოპერაციო პრიორიტეტებით.",
    "02-vineyard-operations": "VinOS-ის ვენახის მართვის ეკრანი აღრიცხული ნაკვეთების სტატუსითა და საველე ხელსაწყოებით.",
    "03-vineyard-intelligence": "VinOS-ის აგროამინდის ეკრანი პროგნოზის მონაცემებითა და წესებზე დაფუძნებული რისკის ინდიკატორებით.",
    "04-cellar-command-center": "VinOS-ის მარნის მიმოხილვა პარტიების, ჭურჭლის, დუღილისა და ქიმიის აღრიცხული სტატუსით.",
    "05-fermentation-tracking": "VinOS-ის დუღილის ეკრანი აღრიცხული მრუდებითა და დღიური ჩანაწერებით.",
    "06-ai-winemaker": "VinOS-ის AI ასისტენტის პანელი ადამიანის მიერ გადასამოწმებელი სამუშაო ვერსიებით მარნის სივრცის გვერდით.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def locale_for(relative: str) -> str:
    if "/en/" in f"/{relative}" or relative.endswith("-en.md") or relative.endswith("-en.txt") or "-en." in relative or "-en-" in relative:
        return "en"
    if "/ka/" in f"/{relative}" or relative.endswith("-ka.md") or relative.endswith("-ka.txt") or "-ka." in relative or "-ka-" in relative:
        return "ka-GE"
    if relative.startswith("photos/") or relative.startswith("brand/"):
        return "language-neutral"
    return "n/a"


def classify(relative: str) -> tuple[str, str, str]:
    if relative.startswith("photos/") and relative != "photos/contact-sheet.png":
        return "campaign_photo", "openai_builtin_imagegen", "review_required"
    if relative == "photos/contact-sheet.png":
        return "campaign_photo_contact_sheet", "derived_from_imagegen", "review_required"
    if relative.startswith("images/en/") or relative.startswith("images/ka/"):
        return "product_screenshot", "authenticated_local_app_testuser1", "review_required"
    if relative.startswith("images/contact-sheet"):
        return "product_contact_sheet", "derived_from_product_screens", "review_required"
    if relative.startswith("posters/"):
        return "video_poster", "derived_from_product_screens", "review_required"
    if relative.startswith("videos/"):
        return "product_video", "derived_from_product_screens", "review_required"
    if relative.startswith("copy/") and relative.endswith(".txt"):
        return "voiceover_script", "repository_evidence_authored", "native_language_review_required"
    if relative.startswith("copy/"):
        return "marketing_copy", "repository_evidence_authored", "native_language_review_required"
    if relative.startswith("scripts/"):
        return "build_tool", "local_tooling", "internal"
    if relative.startswith("licenses/"):
        return "provenance_document", "authored", "review_required"
    if relative.startswith("brand/"):
        return "brand_reference", "authored", "review_required"
    if relative == "marketing-facts.md":
        return "marketing_fact_sheet", "repository_evidence_authored", "review_required"
    return "documentation", "authored", "review_required"


def mime_for(path: Path) -> str:
    explicit = {
        ".md": "text/markdown",
        ".py": "text/x-python",
        ".csv": "text/csv",
    }
    return explicit.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def alt_for(relative: str) -> str:
    if relative in ALT_TEXT:
        return ALT_TEXT[relative]
    if relative.startswith("images/en/") or relative.startswith("images/ka/"):
        stem = Path(relative).stem
        screen_alt = SCREEN_ALT_KA if relative.startswith("images/ka/") else SCREEN_ALT_EN
        for key, text in screen_alt.items():
            if stem.startswith(key):
                return text
    return ""


def video_meta(path: Path) -> tuple[int | str, int | str, float | str]:
    try:
        import imageio_ffmpeg  # type: ignore
    except ImportError:
        media_runtime = Path(os.environ.get("CODEX_MEDIA_RUNTIME", Path.home() / ".cache" / "codex-media-runtime"))
        sys.path.insert(0, str(media_runtime))
        import imageio_ffmpeg  # type: ignore
    reader = imageio_ffmpeg.read_frames(str(path), pix_fmt="rgb24")
    metadata = next(reader)
    reader.close()
    width, height = metadata["size"]
    return width, height, round(float(metadata["duration"]), 2)


def build() -> Path:
    rows: list[dict[str, object]] = []
    for path in sorted(ASSETS.rglob("*")):
        if not path.is_file() or path.name == "manifest.csv" or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(ASSETS).as_posix()
        asset_type, source, status = classify(relative)
        width: int | str = ""
        height: int | str = ""
        duration: float | str = ""
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            with Image.open(path) as image:
                width, height = image.size
        elif path.suffix.lower() == ".mp4":
            width, height, duration = video_meta(path)
        rows.append(
            {
                "path": relative,
                "asset_type": asset_type,
                "locale": locale_for(relative),
                "mime_type": mime_for(path),
                "width": width,
                "height": height,
                "duration_seconds": duration,
                "size_bytes": path.stat().st_size,
                "sha256": sha256(path),
                "source": source,
                "approval_status": status,
                "alt_text": alt_for(relative),
            }
        )

    output = ASSETS / "manifest.csv"
    fields = [
        "path",
        "asset_type",
        "locale",
        "mime_type",
        "width",
        "height",
        "duration_seconds",
        "size_bytes",
        "sha256",
        "source",
        "approval_status",
        "alt_text",
    ]
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return output


if __name__ == "__main__":
    print(build())
