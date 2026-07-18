"""Render the proof-section thumbnails from the live demos.

The proof cards used to carry hand-drawn abstract SVG wireframes. A buyer comparing
freelancers decides largely on what the work looks like, and an abstract purple
rectangle answers that question with nothing, so each card now shows the actual page
it links to.

Run after a demo changes its look:

    build/.venv/bin/python build/build_shots.py

Everything under assets/shots/ is a DERIVED ARTIFACT. The thumbnails are decorative
(the card's heading and paragraph carry the meaning), which is why the markup keeps
aria-hidden and an empty alt: a screenshot caption would otherwise need translating
into the English tree as well.
"""

from __future__ import annotations

import logging
import math
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright

logger = logging.getLogger("build_shots")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "assets" / "shots"

# 16:10 to match the .shot aspect-ratio, so nothing is cropped by object-fit.
CAPTURE_VIEWPORT = {"width": 1440, "height": 900}
FLAGSHIP_WIDTH = 1120
STANDARD_WIDTH = 560
THUMBNAIL_RATIO = 10 / 16
WEBP_QUALITY = 72
# Hero animations and webfonts settle well after the network goes quiet.
SETTLE_MS = 2500

# Shot brightness measured across the set spanned 13.7x (0.071 for the near-black AETHOS
# demo up to 0.972 for the white calculator landing). Side by side that reads as random
# flashing: the dark ones dissolve into the card fill and the light ones flare, so which
# project draws the eye depends on the demo's theme rather than on the work.
#
# The treatment is deliberately ASYMMETRIC, because the two ends are not the same problem.
#
# The bright end distorts attention: a white page at 0.97 against a 0.04 background pulls
# the eye first regardless of the work, so those get dimmed.
#
# The dark end does not. A dark demo IS dark, and lifting it lies about the product. Tried
# and rejected at floor 0.18: AETHOS turned its barely-there particle field into dense
# speckle and its black into washed navy, which is not the page the client would get. The
# floor is therefore a guard against a shot that is nearly pure black, not a normalizer.
# The real complaint about dark shots, that they dissolve into the card, is a framing
# problem and is solved in CSS by giving every .shot the same plate and hairline.
LUMINANCE_FLOOR = 0.10
LUMINANCE_CEILING = 0.75
LUMINANCE_SAMPLE = (64, 40)
SRGB_WEIGHTS = (0.2126, 0.7152, 0.0722)
LUMINANCE_PASSES = 6


@dataclass(frozen=True)
class Demo:
    """One proof card: the page to shoot and the file the card points at."""

    slug: str
    url: str
    flagship: bool = False

    @property
    def output_path(self) -> Path:
        return OUTPUT_DIR / f"{self.slug}.webp"

    @property
    def target_width(self) -> int:
        return FLAGSHIP_WIDTH if self.flagship else STANDARD_WIDTH


DEMOS = (
    Demo("salon", "https://salon.helban.dev", flagship=True),
    Demo("kalkulator", "https://kalkulator.helban.dev"),
    Demo("dropwatch", "https://dropwatch.helban.dev"),
    Demo("voltera", "https://voltera.helban.dev"),
    Demo("aurum", "https://aurum-casino.helban.dev"),
    Demo("aethos", "https://aethos.helban.dev"),
    Demo("orqa", "https://orqa.helban.dev"),
)


def capture(page: Page, demo: Demo) -> bytes:
    page.goto(demo.url, wait_until="networkidle", timeout=45_000)
    page.wait_for_timeout(SETTLE_MS)
    return page.screenshot(type="png")


def mean_luminance(thumbnail: Image.Image) -> float:
    sample = thumbnail.resize(LUMINANCE_SAMPLE, Image.LANCZOS)
    channels = sample.tobytes()
    red_weight, green_weight, blue_weight = SRGB_WEIGHTS
    total = sum(
        channels[offset] * red_weight
        + channels[offset + 1] * green_weight
        + channels[offset + 2] * blue_weight
        for offset in range(0, len(channels), 3)
    )
    return total / (sample.width * sample.height * 255)


def lift(thumbnail: Image.Image, exponent: float) -> Image.Image:
    """Gamma rather than a flat multiply: it opens the shadows, where a dark UI keeps its
    content, without blowing out the few bright accents such a design relies on."""

    curve = [round(255 * (step / 255) ** exponent) for step in range(256)]
    return thumbnail.point(curve * 3)


def dim(thumbnail: Image.Image, scale: float) -> Image.Image:
    """Gamma at the bright end would need an exponent near 9 and would crush a white page
    to flat grey. A linear scale dims the whole shot evenly and keeps it legible."""

    curve = [min(255, round(step * scale)) for step in range(256)]
    return thumbnail.point(curve * 3)


def pull_into_band(thumbnail: Image.Image) -> tuple[Image.Image, float, float]:
    """Lift a too-dark shot, dim a too-bright one, leave everything else alone.

    Both corrections are solved by iteration rather than in one shot. A gamma derived
    from the mean does not move the mean to where the algebra says it will: these are
    bimodal images (a near-black UI with a few bright accents), and the curve acts on
    every pixel, not on the average. Converging numerically is simpler than modelling
    the histogram, and the cap keeps a pathological image from looping.
    """

    before = mean_luminance(thumbnail)
    corrected = thumbnail
    current = before

    for _ in range(LUMINANCE_PASSES):
        if LUMINANCE_FLOOR <= current <= LUMINANCE_CEILING:
            break
        if current < LUMINANCE_FLOOR:
            corrected = lift(corrected, math.log(LUMINANCE_FLOOR) / math.log(current))
        else:
            corrected = dim(corrected, LUMINANCE_CEILING / current)
        current = mean_luminance(corrected)

    return corrected, before, current


def to_thumbnail(screenshot: bytes, target_width: int) -> tuple[bytes, float, float]:
    with Image.open(BytesIO(screenshot)) as shot:
        target_height = round(target_width * THUMBNAIL_RATIO)
        resized = shot.convert("RGB").resize((target_width, target_height), Image.LANCZOS)
        thumbnail, before, after = pull_into_band(resized)
        encoded = BytesIO()
        thumbnail.save(encoded, format="WEBP", quality=WEBP_QUALITY, method=6)
        return encoded.getvalue(), before, after


def build_all() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport=CAPTURE_VIEWPORT, device_scale_factor=2)
        for demo in DEMOS:
            try:
                screenshot = capture(page, demo)
            except PlaywrightError as unreachable:
                browser.close()
                raise RuntimeError(f"could not capture {demo.url}: {unreachable}") from unreachable
            thumbnail, before, after = to_thumbnail(screenshot, demo.target_width)
            demo.output_path.write_bytes(thumbnail)
            total_bytes += len(thumbnail)
            logger.info(
                "Wrote %s (%d px wide, %.1f KB, luminance %.3f -> %.3f)",
                demo.output_path.relative_to(REPO_ROOT),
                demo.target_width,
                len(thumbnail) / 1024,
                before,
                after,
            )
        browser.close()

    logger.info("%d thumbnails, %.1f KB total", len(DEMOS), total_bytes / 1024)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    build_all()
