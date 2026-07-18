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


def to_thumbnail(screenshot: bytes, target_width: int) -> bytes:
    with Image.open(BytesIO(screenshot)) as shot:
        target_height = round(target_width * THUMBNAIL_RATIO)
        thumbnail = shot.convert("RGB").resize((target_width, target_height), Image.LANCZOS)
        encoded = BytesIO()
        thumbnail.save(encoded, format="WEBP", quality=WEBP_QUALITY, method=6)
        return encoded.getvalue()


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
            thumbnail = to_thumbnail(screenshot, demo.target_width)
            demo.output_path.write_bytes(thumbnail)
            total_bytes += len(thumbnail)
            logger.info(
                "Wrote %s (%d px wide, %.1f KB)",
                demo.output_path.relative_to(REPO_ROOT),
                demo.target_width,
                len(thumbnail) / 1024,
            )
        browser.close()

    logger.info("%d thumbnails, %.1f KB total", len(DEMOS), total_bytes / 1024)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    build_all()
