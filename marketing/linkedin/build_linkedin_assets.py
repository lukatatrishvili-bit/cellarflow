from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
INSTAGRAM = ROOT / "marketing" / "instagram"
OUTPUT = Path(__file__).resolve().parent


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)


def cover_crop(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.LANCZOS)


def build_banner() -> None:
    source = Image.open(INSTAGRAM / "story-hero.jpg")
    canvas = cover_crop(source, (1128, 191))

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 760, 191), fill=(11, 9, 8, 198))
    for x in range(760, 1050):
        alpha = max(0, int(198 * (1050 - x) / 290))
        draw.line((x, 0, x, 191), fill=(11, 9, 8, alpha))

    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(canvas)
    burgundy = (164, 45, 67, 255)
    cream = (247, 241, 226, 255)
    gold = (214, 180, 103, 255)

    draw.ellipse((45, 57, 75, 87), fill=burgundy)
    draw.ellipse((67, 45, 97, 75), fill=burgundy)
    draw.ellipse((76, 72, 106, 102), fill=burgundy)
    draw.ellipse((52, 83, 82, 113), fill=burgundy)
    draw.line((91, 49, 107, 26), fill=gold, width=5)
    draw.text((126, 36), "VinOS", font=font(48, bold=True), fill=cream)
    draw.text((128, 95), "THE OPERATING SYSTEM FOR WINE", font=font(20, bold=True), fill=gold)
    draw.text((128, 127), "Vineyard  •  Cellar  •  Laboratory  •  One connected record", font=font(17), fill=cream)

    canvas.convert("RGB").save(OUTPUT / "vinos-linkedin-banner.jpg", quality=94)


def build_logo() -> None:
    source = Image.open(INSTAGRAM / "profile-avatar.png").convert("RGB")
    logo = ImageOps.fit(source, (600, 600), method=Image.Resampling.LANCZOS)
    logo.save(OUTPUT / "vinos-linkedin-logo.png", optimize=True)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    build_banner()
    build_logo()
