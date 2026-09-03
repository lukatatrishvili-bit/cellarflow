from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "marketing-assets"
WIDTH, HEIGHT = 1280, 720
FPS = 24
BURGUNDY = "#65101a"
BURGUNDY_DARK = "#17070b"
GOLD = "#d5ad5b"
CREAM = "#fbf8f2"

ARIAL = Path(r"C:\Windows\Fonts\arial.ttf")
ARIAL_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
SEGOE_UI = Path(r"C:\Windows\Fonts\segoeui.ttf")
SEGOE_UI_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")


LANGUAGES = {
    "en": {
        "font": ARIAL,
        "font_bold": ARIAL_BOLD,
        "headline": "Vineyard to bottle.\nOne operational system.",
        "subhead": "Connected vineyard, cellar, lab and review-only AI workflows",
        "cta": "See recorded decisions.\nTrace every recorded lot.",
        "taxonomy": "VINEYARD  •  CELLAR  •  TRACEABILITY  •  AI",
        "demo_label": "DEMO WORKSPACE  •  SAMPLE RECORDS",
        "slides": [
            ("01-dashboard-overview-en.png", "Review operational priorities"),
            ("02-vineyard-operations-en.png", "Coordinate work across vineyard blocks"),
            ("03-vineyard-intelligence-en.png", "Use weather data to support field decisions"),
            ("04-cellar-command-center-en.png", "Coordinate cellar work from one operating view"),
            ("05-fermentation-tracking-en.png", "Review recorded fermentation curves and daily readings"),
            ("06-ai-winemaker-en.png", "Review AI guidance in the workflow"),
        ],
    },
    "ka": {
        "font": SEGOE_UI,
        "font_bold": SEGOE_UI_BOLD,
        "headline": "ვენახიდან ბოთლამდე.\nერთიანი საოპერაციო სისტემა.",
        "subhead": "ვენახის, მარნისა და ლაბორატორიის პროცესები\nადამიანის მიერ გადასამოწმებელი AI სამუშაო ვერსიებით",
        "cta": "დაინახეთ აღრიცხული გადაწყვეტილებები.\nმიაკვლიეთ თითოეულ აღრიცხულ პარტიას.",
        "taxonomy": "ვენახი  •  მარანი  •  მიკვლევადობა  •  AI",
        "demo_label": "დემო სივრცე  •  საცდელი ჩანაწერები",
        "slides": [
            ("01-dashboard-overview-ka.png", "გადაამოწმეთ საოპერაციო პრიორიტეტები"),
            ("02-vineyard-operations-ka.png", "კოორდინაცია გაუწიეთ აღრიცხულ ნაკვეთებს"),
            ("03-vineyard-intelligence-ka.png", "გამოიყენეთ ამინდის მონაცემები საველე გადაწყვეტილებების მხარდასაჭერად"),
            ("04-cellar-command-center-ka.png", "კოორდინაცია გაუწიეთ მარნის სამუშაოებს ერთ ხედში"),
            ("05-fermentation-tracking-ka.png", "გადაამოწმეთ დუღილის მრუდები და დღიური ჩანაწერები"),
            ("06-ai-winemaker-ka.png", "გადაამოწმეთ AI რეკომენდაციები სამუშაო პროცესში"),
        ],
    },
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def fit_contain(image: Image.Image, width: int, height: int, background: str = BURGUNDY_DARK) -> Image.Image:
    ratio = min(width / image.width, height / image.height)
    resized = image.resize(
        (round(image.width * ratio), round(image.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", (width, height), background)
    left = (width - resized.width) // 2
    top = (height - resized.height) // 2
    canvas.paste(resized, (left, top))
    return canvas


def centered_multiline(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: str,
    spacing: int = 10,
) -> None:
    box = draw.multiline_textbbox((0, 0), text, font=text_font, spacing=spacing, align="center")
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.multiline_text(
        (xy[0] - width / 2, xy[1] - height / 2),
        text,
        font=text_font,
        fill=fill,
        spacing=spacing,
        align="center",
    )


def wrap_for_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    max_width: int,
) -> str:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = word if not current else f"{current} {word}"
        if current and draw.textbbox((0, 0), candidate, font=text_font)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return "\n".join(lines)


def title_card(lang: str, outro: bool = False) -> Image.Image:
    spec = LANGUAGES[lang]
    image = Image.new("RGB", (WIDTH, HEIGHT), BURGUNDY_DARK)
    draw = ImageDraw.Draw(image)

    draw.ellipse((-220, -250, 580, 550), fill="#340b12")
    draw.ellipse((930, 430, 1450, 950), fill="#2a1010")
    draw.rectangle((0, 0, WIDTH, 12), fill=GOLD)

    brand_font = font(spec["font_bold"], 66)
    headline_font = font(spec["font_bold"], 54 if lang == "en" else 47)
    subhead_font = font(spec["font"], 25 if lang == "en" else 27)
    cta_font = font(spec["font_bold"], 40 if lang == "en" else 35)

    centered_multiline(draw, (WIDTH // 2, 142), "VinOS", brand_font, CREAM)
    draw.rounded_rectangle((545, 192, 735, 201), radius=5, fill=GOLD)

    if outro:
        centered_multiline(draw, (WIDTH // 2, 340), spec["cta"], cta_font, CREAM, spacing=12)
        centered_multiline(draw, (WIDTH // 2, 520), spec["taxonomy"], font(spec["font_bold"], 22), GOLD)
    else:
        centered_multiline(draw, (WIDTH // 2, 340), spec["headline"], headline_font, CREAM, spacing=13)
        centered_multiline(draw, (WIDTH // 2, 535), spec["subhead"], subhead_font, "#e9dcd4")
    return image


def add_slide_label(image: Image.Image, lang: str, label: str) -> Image.Image:
    spec = LANGUAGES[lang]
    canvas = image.convert("RGBA")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for index in range(145):
        alpha = round(230 * (index / 144) ** 0.9)
        y = HEIGHT - 145 + index
        draw.line((0, y, WIDTH, y), fill=(19, 6, 9, alpha))
    draw.rectangle((0, HEIGHT - 8, WIDTH, HEIGHT), fill=(213, 173, 91, 255))
    demo_font = font(spec["font_bold"], 18)
    demo_box = draw.textbbox((0, 0), spec["demo_label"], font=demo_font)
    demo_width = demo_box[2] - demo_box[0]
    draw.rounded_rectangle((38, 8, 66 + demo_width, 40), radius=9, fill=(101, 16, 26, 235))
    draw.text((52, 13), spec["demo_label"], font=demo_font, fill=CREAM)
    draw.text((WIDTH - 120, 11), "VinOS", font=font(ARIAL_BOLD, 20), fill=GOLD)
    label_font = font(spec["font_bold"], 32 if lang == "en" else 31)
    wrapped_label = wrap_for_width(draw, label, label_font, WIDTH - 48 - 270)
    label_box = draw.multiline_textbbox((0, 0), wrapped_label, font=label_font, spacing=1)
    label_height = label_box[3] - label_box[1]
    label_y = 662 - label_height / 2 - label_box[1]
    draw.multiline_text((48, label_y), wrapped_label, font=label_font, fill=CREAM, spacing=1)
    return Image.alpha_composite(canvas, overlay).convert("RGB")


def prepare_slide(path: Path, lang: str, label: str) -> Image.Image:
    source = Image.open(path).convert("RGB")
    source = source.crop((0, 82, source.width, source.height))
    return add_slide_label(fit_contain(source, WIDTH, HEIGHT), lang, label)


def pan_frame(image: Image.Image, progress: float, direction: int) -> Image.Image:
    # Keep the whole product UI and caption inside a marketing-safe frame.
    # Crossfades provide motion without cropping critical controls or copy.
    return image


def crossfade(previous: Image.Image, current: Image.Image, amount: float) -> Image.Image:
    return Image.blend(previous, current, max(0.0, min(1.0, amount)))


def iter_video_frames(lang: str) -> Iterable[bytes]:
    spec = LANGUAGES[lang]
    intro = title_card(lang)
    outro = title_card(lang, outro=True)
    slides = [
        prepare_slide(ASSETS / "images" / lang / filename, lang, label)
        for filename, label in spec["slides"]
    ]

    intro_frames = round(1.9 * FPS)
    slide_frames = round(2.6 * FPS)
    outro_frames = round(2.0 * FPS)
    fade_frames = round(0.38 * FPS)

    for index in range(intro_frames):
        frame = intro
        if index >= intro_frames - fade_frames:
            amount = (index - (intro_frames - fade_frames) + 1) / fade_frames
            frame = crossfade(intro, pan_frame(slides[0], 0.0, 1), amount)
        yield np.asarray(frame, dtype=np.uint8).tobytes()

    previous_end = pan_frame(slides[0], 1.0, 1)
    for slide_index, slide in enumerate(slides):
        direction = 1 if slide_index % 2 == 0 else -1
        for index in range(slide_frames):
            progress = index / max(1, slide_frames - 1)
            current = pan_frame(slide, progress, direction)
            if slide_index > 0 and index < fade_frames:
                current = crossfade(previous_end, current, (index + 1) / fade_frames)
            yield np.asarray(current, dtype=np.uint8).tobytes()
        previous_end = pan_frame(slide, 1.0, direction)

    for index in range(outro_frames):
        frame = outro
        if index < fade_frames:
            frame = crossfade(previous_end, outro, (index + 1) / fade_frames)
        yield np.asarray(frame, dtype=np.uint8).tobytes()


def write_video(lang: str) -> Path:
    try:
        import imageio_ffmpeg  # type: ignore
    except ImportError:
        media_runtime = Path(os.environ.get("CODEX_MEDIA_RUNTIME", Path.home() / ".cache" / "codex-media-runtime"))
        sys.path.insert(0, str(media_runtime))
        import imageio_ffmpeg  # type: ignore

    output_dir = ASSETS / "videos"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"vinos-product-tour-{lang}.mp4"
    writer = imageio_ffmpeg.write_frames(
        str(output),
        (WIDTH, HEIGHT),
        fps=FPS,
        codec="libx264",
        pix_fmt_in="rgb24",
        pix_fmt_out="yuv420p",
        quality=7,
        ffmpeg_log_level="warning",
        output_params=["-movflags", "+faststart", "-an"],
    )
    writer.send(None)
    try:
        for frame in iter_video_frames(lang):
            writer.send(frame)
    finally:
        writer.close()
    return output


def contact_sheet(lang: str) -> Path:
    spec = LANGUAGES[lang]
    output_dir = ASSETS / "images"
    sheet = Image.new("RGB", (1920, 1080), BURGUNDY_DARK)
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 0, 1920, 12), fill=GOLD)
    title = "VinOS Product Screens — English" if lang == "en" else "VinOS-ის პროდუქტის ეკრანები — ქართული"
    draw.text((70, 46), title, font=font(spec["font_bold"], 44 if lang == "en" else 41), fill=CREAM)
    draw.text((70, 105), spec["taxonomy"], font=font(spec["font_bold"], 20), fill=GOLD)
    draw.text((70, 137), spec["demo_label"], font=font(spec["font_bold"], 17), fill="#d8c9c1")

    cell_w, cell_h = 570, 395
    start_x, start_y = 70, 180
    gap_x, gap_y = 35, 55
    for index, (filename, label) in enumerate(spec["slides"]):
        row, col = divmod(index, 3)
        x = start_x + col * (cell_w + gap_x)
        y = start_y + row * (cell_h + gap_y)
        screenshot = Image.open(ASSETS / "images" / lang / filename).convert("RGB")
        screenshot = screenshot.crop((0, 82, screenshot.width, screenshot.height))
        thumb = fit_contain(screenshot, cell_w, 321, background="#ede6dc")
        sheet.paste(thumb, (x, y))
        draw.rounded_rectangle((x, y + 321, x + cell_w, y + cell_h), radius=9, fill="#f5efe7")
        label_font = font(spec["font_bold"], 24 if lang == "en" else 22)
        words = label.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = word if not current else f"{current} {word}"
            width = draw.textbbox((0, 0), candidate, font=label_font)[2]
            if current and width > cell_w - 36:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        label_text = "\n".join(lines[:2])
        text_box = draw.multiline_textbbox((0, 0), label_text, font=label_font, spacing=1)
        text_height = text_box[3] - text_box[1]
        text_y = y + 321 + (cell_h - 321 - text_height) // 2 - text_box[1]
        draw.multiline_text((x + 18, text_y), label_text, font=label_font, fill="#2a1014", spacing=1)
    output = output_dir / f"contact-sheet-{lang}.png"
    sheet.save(output, optimize=True)
    return output


def photo_contact_sheet() -> Path | None:
    photo_dir = ASSETS / "photos"
    photos = [
        (photo_dir / "01-kakheti-vineyard-operations-hero.png", "Kakheti vineyard operations"),
        (photo_dir / "02-qvevri-cellar-operations-hero.png", "Georgian qvevri cellar"),
        (photo_dir / "03-modern-cellar-lab-operations-hero.png", "Cellar laboratory control"),
    ]
    if not all(path.exists() for path, _ in photos):
        return None

    sheet = Image.new("RGB", (1920, 1080), BURGUNDY_DARK)
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 0, 1920, 12), fill=GOLD)
    draw.text((70, 50), "VinOS Campaign Photography", font=font(ARIAL_BOLD, 48), fill=CREAM)
    draw.text((70, 116), "Language-neutral • AI-generated concept imagery", font=font(ARIAL_BOLD, 21), fill=GOLD)

    cell_w, image_h = 570, 650
    start_x, top = 70, 190
    for index, (path, label) in enumerate(photos):
        x = start_x + index * 605
        source = Image.open(path).convert("RGB")
        ratio = max(cell_w / source.width, image_h / source.height)
        resized = source.resize((round(source.width * ratio), round(source.height * ratio)), Image.Resampling.LANCZOS)
        left = (resized.width - cell_w) // 2
        crop = resized.crop((left, 0, left + cell_w, image_h))
        sheet.paste(crop, (x, top))
        draw.rounded_rectangle((x, top + image_h, x + cell_w, top + image_h + 94), radius=10, fill="#f5efe7")
        draw.text((x + 20, top + image_h + 30), label, font=font(ARIAL_BOLD, 25), fill="#2a1014")

    draw.text(
        (70, 1005),
        "Concept imagery for campaign layouts; no third-party stock photography used.",
        font=font(ARIAL, 20),
        fill="#d8c9c1",
    )
    output = photo_dir / "contact-sheet.png"
    sheet.save(output, optimize=True)
    return output


def main() -> None:
    for source in sorted((ASSETS / "images").glob("*/*.png")):
        with Image.open(source) as screenshot:
            if screenshot.format != "PNG":
                normalized = screenshot.convert("RGB")
                temporary = source.with_suffix(".normalized.png")
                normalized.save(temporary, format="PNG", optimize=True)
                os.replace(temporary, source)
    posters = ASSETS / "posters"
    posters.mkdir(parents=True, exist_ok=True)
    for lang in ("en", "ka"):
        title_card(lang).save(posters / f"vinos-product-tour-{lang}-cover.png", optimize=True)
        contact_sheet(lang)
        output = write_video(lang)
        print(output)
    photo_contact_sheet()


if __name__ == "__main__":
    main()
