"""Find first-person PLURAL in the visible copy of every page, PL and EN.

Run after writing or editing any copy on this site:

    build/.venv/bin/python build/check_voice.py

It PRINTS, it does not fix: some plurals are correct and no regex can tell them apart.

helban.dev is one person, so "nasza wtyczka" is wrong. Three kinds of match are CORRECT and
must stay: the "we" that means me and the reader ("zanim zaczniemy rozmawiać o cenie"), the
English "my" inside client quotes on the home page, and "o nas" as the name of a section on
someone else's site. Measured 2026-09-03 after Adam caught "nasza wtyczka" in a case study:
13 matches across the site, 4 of them real. That ratio is why this prints instead of fixing.
"""
import re
import subprocess
from pathlib import Path

REPO = Path("/home/kramarz/projects/portfolio/helban-dev")
EXTRACT = REPO / "build" / "extract_copy.py"
PYTHON = REPO / "build" / ".venv" / "bin" / "python"

PAGES = [
    "index.html",
    "privacy/index.html",
    "case-studies/index.html",
    "case-studies/frontpage-to-wordpress/index.html",
    "case-studies/wordpress-speed/index.html",
    "case-studies/ksef-woocommerce/index.html",
    "case-studies/notion-operating-system/index.html",
    "case-studies/generateblocks-pro-traps/index.html",
    "case-studies/cloneable-wordpress-template/index.html",
    "case-studies/grok-to-blogger/index.html",
    "dziekuje/index.html",
]

PATTERNS = {
    "pl": re.compile(
        r"\b(nasz\w*|nam|nami|nas|my)\b|\b\w+(?:liśmy|łyśmy|liście|śmy)\b", re.IGNORECASE),
    "en": re.compile(r"\b(we|our|ours|us|we're|we've|we'll)\b", re.IGNORECASE),
}


def copy_of(page: str, lang: str) -> str:
    finished = subprocess.run(
        [str(PYTHON), str(EXTRACT), str(REPO / page), lang],
        capture_output=True, text=True, check=True)
    return finished.stdout


total = 0
for page in PAGES:
    for lang in ("pl", "en"):
        if lang == "en" and page in ("case-studies/ksef-woocommerce/index.html",):
            continue  # Polish-only page, no English twin
        text = copy_of(page, lang)
        for line in text.splitlines():
            for match in PATTERNS[lang].finditer(line):
                start = max(0, match.start() - 60)
                total += 1
                print(f"{page} [{lang}] …{line[start:match.end() + 60]}…")
print(f"\nrazem trafień: {total}")
