"""Versioned prompt files (backend/prompts/<version>/<name>.txt) and a token estimate."""
from __future__ import annotations

import re
from functools import lru_cache

from .. import config

CHARS_PER_TOKEN = 3.5      # rough average for English contract text
IMAGE_TOKENS = 1600        # about one A4 page rendered at zoom 1.5


@lru_cache(maxsize=None)
def load_prompt(name: str, version: str | None = None) -> str:
    """Read prompts/<version>/<name>.txt. `name` is given without .txt, e.g. "extract"."""
    path = config.PROMPTS_DIR / (version or config.PROMPT_VERSION) / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")
    return path.read_text(encoding="utf-8")


def render(template: str, **values: object) -> str:
    """Fill {placeholders} in one pass. Unknown names (and JSON braces) are left as they are,
    and text that is filled in (for example contract pages) is never scanned again."""
    def fill(match: re.Match) -> str:
        name = match.group(1)
        return str(values[name]) if name in values else match.group(0)
    return re.sub(r"\{(\w+)\}", fill, template)


def estimate_tokens(text: str | None) -> int:
    """Rough token count: characters / 3.5. Good enough for planning, not for billing."""
    return int(len(text or "") / CHARS_PER_TOKEN)
