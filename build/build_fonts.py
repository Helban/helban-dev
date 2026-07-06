"""Build the six served web fonts from the Google-hosted Inter / JetBrains Mono
subsets in build/fonts-src/.

The Google sources are variable fonts. For each weight we pin the variable
source to that weight (a real static instance, not the default master), merge
its latin + latin-ext pair into one face, then subset to the glyphs the site
uses. Wins over shipping Google's files directly:

  - one file per weight instead of two (latin + latin-ext), so a Polish visitor
    makes 6 font requests, not 12. Twelve parallel requests made Lighthouse log
    ERR_TIMED_OUT on whichever were still in flight when it ended the run, which
    cost the Best Practices score.
  - subset to ~140 codepoints, so the six files stay small (~100 KB total vs
    ~605 KB) while keeping kerning (GPOS) and the correct per-weight outlines.

Run after adding copy that introduces a new glyph:
    python -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python build/build_fonts.py
"""

import glob
import os

from fontTools.merge import Merger
from fontTools.varLib import instancer
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, "build", "fonts-src")
FONTS_DIR = os.path.join(REPO, "fonts")

# One served file per (family, weight); each merges its own latin + latin-ext pair.
FONT_WEIGHTS = [
    ("inter", 400),
    ("inter", 600),
    ("inter", 700),
    ("inter", 800),
    ("jetbrains-mono", 500),
    ("jetbrains-mono", 700),
]

POLISH = "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ"
PUNCTUATION = "–—‘’“”„…•·→←↑↓©®°×÷−±§€£¥$%&@#*/\\|~^`+=<>[](){}"


def collect_target_codepoints() -> set[int]:
    """Every character present in shipped markup or scripts across the whole site,
    widened by the full Polish set and typographic punctuation as a buffer."""
    codepoints: set[int] = set()
    for pattern in ("**/*.html", "**/*.js"):
        for source_path in glob.glob(os.path.join(REPO, pattern), recursive=True):
            with open(source_path, encoding="utf-8") as source_file:
                codepoints.update(ord(char) for char in source_file.read())
    codepoints.update(ord(char) for char in POLISH + PUNCTUATION)
    codepoints.update(range(0x20, 0x7F))
    return {cp for cp in codepoints if cp >= 0x20 and cp != 0x7F}


def _instance_to_temp(src_path: str, weight: int, temp_path: str) -> None:
    """Pin the variable source to its target weight and save a static copy.

    The Google sources are variable fonts (a wght axis). Deleting fvar/gvar
    outright would leave the default master (Regular), which is why an earlier
    build rendered every weight too thin. instantiateVariableFont bakes the
    real weight and removes the variation tables cleanly so the merge can run."""
    font = TTFont(src_path)
    instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True)
    font.flavor = None
    font.save(temp_path)


def build_weight(family: str, weight: int, target_codepoints: set[int]) -> int:
    latin_temp = os.path.join(FONTS_DIR, f"_{family}-{weight}-latin.ttf")
    latin_ext_temp = os.path.join(FONTS_DIR, f"_{family}-{weight}-latin-ext.ttf")
    _instance_to_temp(os.path.join(SRC_DIR, f"{family}-{weight}-latin.woff2"), weight, latin_temp)
    _instance_to_temp(os.path.join(SRC_DIR, f"{family}-{weight}-latin-ext.woff2"), weight, latin_ext_temp)

    merged_font = Merger().merge([latin_temp, latin_ext_temp])

    options = Options()
    options.flavor = "woff2"
    options.ignore_missing_unicodes = True
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.hinting = False
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=target_codepoints)
    subsetter.subset(merged_font)

    merged_font.flavor = "woff2"
    out_path = os.path.join(FONTS_DIR, f"{family}-{weight}.woff2")
    merged_font.save(out_path)

    os.remove(latin_temp)
    os.remove(latin_ext_temp)
    return os.path.getsize(out_path)


def main() -> None:
    target_codepoints = collect_target_codepoints()
    print(f"Keeping {len(target_codepoints)} codepoints, building {len(FONT_WEIGHTS)} files")

    total = 0
    for family, weight in FONT_WEIGHTS:
        built_bytes = build_weight(family, weight, target_codepoints)
        total += built_bytes
        print(f"  {family}-{weight}.woff2  {built_bytes/1024:6.1f} KB")
    print(f"TOTAL {total/1024:.0f} KB across {len(FONT_WEIGHTS)} files")


if __name__ == "__main__":
    main()
