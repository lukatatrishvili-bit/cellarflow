# VinOS marketing asset kit

This kit was created from the authorized `testuser1` demo workspace on 2026-07-14. It combines authentic product screens, bilingual copy, short product reels, and language-neutral campaign photography.

## What is included

- `photos/` — three AI-generated, language-neutral campaign hero images plus a contact sheet.
- `images/en/` and `images/ka/` — six authentic product screenshots per interface language.
- `images/contact-sheet-en.png` and `images/contact-sheet-ka.png` — presentation-ready screen overviews.
- `posters/` — English and Georgian video cover images.
- `videos/` — silent English and Georgian H.264 product tours, 1280×720, 24 fps, approximately 19 seconds each.
- `copy/` — positioning, feature benefits, social captions, and reel-timed voiceover scripts.
- `marketing-facts.md` — repository-evidenced product facts, demo metrics, and claim guardrails.
- `manifest.csv` — file metadata, checksums, sources, and review status.
- `licenses/asset-sources.md` and `licenses/image-generation-prompts.md` — provenance, generation notes, and the exact final image prompts.

## Suggested use

1. Use a campaign photograph for the landing-page or social hero.
2. Follow it with the appropriate English or Georgian product contact sheet.
3. Use the cropped contact sheets and videos as the release-ready product views. The individual screenshots are authenticated source captures; crop and review them before any standalone publication.
4. Publish the corresponding silent MP4 with platform-native captions, or record the included reel-timed voiceover.

## Important publishing notes

- All operational winery records and KPIs shown are fictional seeded demo data. Weather, date, and clock values may reflect the live capture context. Label any quoted operational figures as “demo workspace” or “example data.”
- Describe the product as offering English and Georgian interface options. Some specialist module labels remain English in Georgian mode, so do not claim complete localization.
- The release-ready contact sheets and videos identify the product views as demo-workspace material. Raw source captures may retain current in-product terminology and should not be reused as standalone marketing claims without review.
- Offline wording should be limited to locally queued operational changes that sync after reconnection. AI, weather, maps, and integrations require connectivity and configuration.
- AI is decision support. Drafts require human review and do not automatically modify official winery records.
- Documentation and certification tools support readiness workflows; they do not guarantee regulator approval or automatic filing.
- Campaign photographs in `photos/` are AI-generated concept imagery. They contain no third-party stock photography and should pass the publisher’s normal brand/legal review before paid use.

## Rebuilding the videos

Run `scripts/build_videos.py` with Python, Pillow, NumPy, and `imageio-ffmpeg` installed. The script normalizes source captures to real PNG files, regenerates contact sheets and posters, and writes browser-compatible H.264 MP4s.
