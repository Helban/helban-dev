"""Subset the self-hosted Inter + JetBrains Mono woff2 files to the glyphs the
site actually uses, then overwrite them in place.

The upstream files are Google's full latin / latin-ext subsets (48-85 KB each,
~600 KB total) which was the entire cold-load cost on mobile: the 85 KB Polish
hero weight did not finish until ~4 s on Slow 4G, gating LCP. Subsetting to the
codepoints present anywhere in the site's HTML and JS (plus the full Polish set
and typographic punctuation as a buffer) cuts that to ~200 KB with no visible
change.

Re-run after adding copy that introduces a new glyph:
    python -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python build/subset_fonts.py
Keep the upstream full subsets in git history so a missed glyph is recoverable.
"""

import glob
import os

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(REPO, "fonts")

# Buffer so a future copy edit does not silently fall back to a system font.
# Deliberately tight: the full Polish set (its only Latin-1 letters, o-acute, are
# already in the used set) plus typographic punctuation. We do NOT pull the whole
# Latin-1 accent block, which added 64 unused glyphs to the heavy latin files.
POLISH = "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ"
PUNCTUATION = "–—‘’“”„…•·→←↑↓©®°×÷−±§€£¥$%&@#*/\\|~^`+=<>[](){}"
ASCII_PRINTABLE = range(0x20, 0x7F)
DELETE_CHARACTER = 0x7F


def collect_target_codepoints() -> set[int]:
    """Every character present in shipped markup or scripts across the whole
    site (raw file bytes, so visible text, data-en attributes and JS strings are
    all covered), widened by the Polish and punctuation buffers."""
    codepoints: set[int] = set()
    for pattern in ("**/*.html", "**/*.js"):
        for source_path in glob.glob(os.path.join(REPO, pattern), recursive=True):
            with open(source_path, encoding="utf-8") as source_file:
                codepoints.update(ord(char) for char in source_file.read())
    codepoints.update(ord(char) for char in POLISH + PUNCTUATION)
    codepoints.update(ASCII_PRINTABLE)
    return {cp for cp in codepoints if cp >= 0x20 and cp != DELETE_CHARACTER}


def subset_in_place(font_path: str, target_codepoints: set[int]) -> int:
    """Overwrite one woff2 with a subset holding only the target codepoints it
    has, and return the new file size in bytes."""
    options = Options()
    options.flavor = "woff2"
    options.ignore_missing_unicodes = True  # each file keeps only glyphs it has
    options.name_IDs = ["*"]  # keep the name table so the family resolves
    options.notdef_outline = True
    options.hinting = False  # browsers render web fonts unhinted; drop hint tables
    font = TTFont(font_path)
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=target_codepoints)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(font_path)
    return os.path.getsize(font_path)


def main() -> None:
    target_codepoints = collect_target_codepoints()
    font_paths = sorted(glob.glob(os.path.join(FONTS_DIR, "*.woff2")))
    print(f"Keeping {len(target_codepoints)} codepoints across {len(font_paths)} files")

    total_before = 0
    total_after = 0
    for font_path in font_paths:
        before_bytes = os.path.getsize(font_path)
        after_bytes = subset_in_place(font_path, target_codepoints)
        total_before += before_bytes
        total_after += after_bytes
        print(f"  {os.path.basename(font_path):<38} "
              f"{before_bytes/1024:6.1f} KB -> {after_bytes/1024:6.1f} KB")

    print(f"TOTAL {total_before/1024:.0f} KB -> {total_after/1024:.0f} KB")


if __name__ == "__main__":
    main()
