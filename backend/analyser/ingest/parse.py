"""F2 page parsing and F3 visual triggers.

For every PDF page we keep the text (in reading order) and a few measurements
that tell later stages when the text layer cannot be trusted and the page must
be looked at as an image:

* low_text      - almost no text (scan, image printout, text drawn as vector shapes)
* garbled       - broken text: replacement glyphs or legacy-font Hindi (trap T17)
* choice_fields - "Yes/No", "Applicable/Not Applicable" patterns (trap T1)
* strike_hits   - words with a line drawn through them (trap T1, see strike.py)
* formula_image - an image on a page that talks about a formula (trap T2)
"""
from __future__ import annotations

import re

import fitz  # PyMuPDF

from ..models import PageInfo
from .strike import find_strike_hits

LOW_TEXT_CHARS = 80          # fewer non-space characters than this = "low text"
SCAN_TEXT_CHARS = 400        # a big image plus less text than this = scan with a header line
SCAN_IMAGE_SHARE = 0.40      # image covers at least this share of the page
FRONT_PAGES = 3              # image-only pages within the first N pages are portal printouts (T16)

CHOICE_PATTERNS = [
    (re.compile(r"\bYes\s*/\s*No\b", re.I), "Yes/No"),
    (re.compile(r"\bApplicable\s*/\s*Not\s+Applicable\b", re.I), "Applicable/Not Applicable"),
    (re.compile(r"\bRequired\s*/\s*Not\s+Required\b", re.I), "Required/Not Required"),
]
FORMULA_WORDS = re.compile(r"formula|\bV\s*=|price\s+adjustment|\bind(?:ex|ices)\b", re.I)

# Common English words: real English text is full of them; legacy-font Hindi
# (Kruti Dev etc. mapped onto Latin letters, e.g. "fufonk vkea=.k") has almost none.
STOPWORDS = set("""the of and to in a be shall or by for is on as any with this that
which at from such an will not under all no are if it his may other has have
been per than within said its their date work works contractor contract""".split())


def clean_text(text: str) -> str:
    """Tidy extracted text: drop trailing spaces, squeeze long space runs and blank lines."""
    lines = [re.sub(r"[ \t]{3,}", "  ", ln.rstrip()) for ln in text.splitlines()]
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def is_garbled(text: str) -> bool:
    """True when the text layer is broken (replacement glyphs or legacy-font Hindi)."""
    chars = [c for c in text if not c.isspace()]
    if len(chars) < 40:
        return False
    odd = sum(1 for c in chars if c == "�" or 0xE000 <= ord(c) <= 0xF8FF or ord(c) < 32)
    if odd / len(chars) > 0.05:
        return True
    tokens = re.findall(r"\S+", text)
    alpha = [t for t in tokens if sum(ch.isalpha() for ch in t) >= 2]
    if len(alpha) < 30:
        return False
    stop = sum(1 for t in alpha if t.lower().strip(".,;:()\"'") in STOPWORDS)
    # legacy-font words: capital inside a lower-case word, or symbols glued inside letters
    weird = sum(1 for t in alpha
                if re.search(r"[a-z][A-Z]", t) or re.search(r"[a-zA-Z][\]\[=;~\\|{}`][a-zA-Z]", t)
                or re.match(r"^[,'\]][a-z]", t))
    return stop / len(alpha) < 0.06 and weird / len(alpha) > 0.12


def image_share(page: fitz.Page) -> tuple[int, float]:
    """Number of images on the page and the share of the page area they cover."""
    infos = page.get_image_info()
    area = abs(page.rect) or 1.0
    covered = sum(abs(fitz.Rect(i["bbox"]) & page.rect) for i in infos)
    return len(infos), min(covered / area, 1.0)


def parse_page(page: fitz.Page, doc_id: str) -> PageInfo:
    """Extract one page's text and set its visual-pass triggers."""
    text = clean_text(page.get_text("text", sort=True))
    n_chars = sum(1 for c in text if not c.isspace())
    n_images, share = image_share(page)
    page_no = page.number + 1

    low_text = n_chars < LOW_TEXT_CHARS or (share >= SCAN_IMAGE_SHARE and n_chars < SCAN_TEXT_CHARS)
    garbled = is_garbled(text)
    choices: list[str] = []
    for rx, label in CHOICE_PATTERNS:
        if rx.search(text) and label not in choices:
            choices.append(label)
    strikes = find_strike_hits(page)
    # a "formula image" needs a real picture (not a tiny logo, not a full-page background)
    formula_image = (n_images > 0 and 0.01 <= share <= 0.9 and not low_text
                     and bool(FORMULA_WORDS.search(text)))

    reasons: list[str] = []
    if low_text:
        has_drawing = n_images > 0 or len(page.get_drawings()) > 20
        if page_no <= FRONT_PAGES and has_drawing:
            reasons.append("image-only front page (portal printout?)")
        elif has_drawing:
            reasons.append("low text: scanned or image page")
        # a short page with no picture (e.g. a title page) has nothing more to see
    if garbled:
        reasons.append("garbled text (legacy font or broken glyphs)")
    if choices:
        reasons.append("choice field: " + ", ".join(choices))
    if strikes:
        reasons.append("strike-through: " + ", ".join(sorted({h.word[:30] for h in strikes}))[:200])
    if formula_image:
        reasons.append("formula may be an image")

    return PageInfo(doc_id=doc_id, page=page_no, text=text, char_count=n_chars,
                    image_count=n_images, low_text=low_text, garbled=garbled,
                    choice_fields=choices, strike_hits=strikes, formula_image=formula_image,
                    needs_visual=bool(reasons), visual_reasons=reasons)


def parse_document(path: str, doc_id: str) -> list[PageInfo]:
    """Parse every page of one PDF file."""
    with fitz.open(path) as doc:
        return [parse_page(page, doc_id) for page in doc]


def is_blank(p: PageInfo) -> bool:
    """A page with no text and no visual reason (truly empty, nothing to look at)."""
    return p.char_count == 0 and not p.needs_visual
