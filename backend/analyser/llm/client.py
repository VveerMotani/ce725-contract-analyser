"""Claude API client used by every module that asks the model something.

One public method, `call_json`: send a prompt (plus an optional large document and page images),
get JSON back. Every answer is cached on disk, so a repeat run costs nothing and is reproducible.

Request shape (see the Claude API notes in the project report):
  model            config.MODEL ("claude-opus-5-5")
  thinking         {"type": "adaptive"}   (always on for this model; effort controls depth)
  output_config    {"effort": config.EFFORT, "format": {"type": "json_schema", "schema": ...}}
  system           the frozen system prompt
  messages[0]      [document text block with cache_control ttl 1h] + [page images] + [question text]
  fallbacks        "default" (beta header server-side-fallback-2026-07-01): a refused request is
                   re-run server-side on Anthropic's recommended fallback model
  temperature      NOT sent: the API rejects it (400) since version 2026-10-21. Stability is
                   measured by repeat runs instead (spec 10.4).
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import anthropic

from .. import config

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
DEFAULT_MAX_TOKENS = 32000          # thinking counts towards this, so leave room
MAX_TOKENS_CEILING = 128000         # model maximum output
NETWORK_RETRIES = 3                 # on top of the SDK's own retries
TEMPERATURE_NOTE = "temperature not settable; stability measured by repeat runs"
MISSING_KEY_MESSAGE = "ANTHROPIC_API_KEY is not set. Add ANTHROPIC_API_KEY to backend/.env"

Validator = Callable[[object], list[str]]


class LLMError(RuntimeError):
    """Any failure talking to the model that the caller should show to the user."""


class MissingAPIKeyError(LLMError):
    """No (or an invalid) API key. The API layer can show the message as is."""


class LLMRefusalError(LLMError):
    """The model (and its fallback) declined the request: stop_reason == "refusal"."""


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_json_text(text: str) -> object:
    """Parse model text as JSON, tolerating a ```json fence around it."""
    text = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fence:
        text = fence.group(1)
    return json.loads(text)


class LLMClient:
    """Thin, cached wrapper around the Anthropic Messages API."""

    def __init__(self, model: str = config.MODEL, effort: str = config.EFFORT,
                 cache_dir: Path | None = None, use_fallbacks: bool = True,
                 max_tokens: int = DEFAULT_MAX_TOKENS):
        self.model = model
        self.effort = effort
        self.cache_dir = Path(cache_dir or config.LLM_CACHE_DIR)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.use_fallbacks = use_fallbacks
        self.max_tokens = max_tokens
        self.stats: dict = {"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0,
                            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                            "repairs": 0}
        self._client: anthropic.Anthropic | None = None

    # ------------------------------------------------------------------ public

    def call_json(self, system: str, user_text: str, images: list[bytes] = [],
                  schema: dict | None = None, call_tag: str = "",
                  document: str | None = None,
                  validate: Validator | None = None) -> tuple[object, str]:
        """Ask the model and return (parsed JSON, cache_key).

        document: large stable text (the whole package) sent first with cache_control, so
                  several calls over the same package reuse the cached prefix.
        validate: optional check on the parsed JSON returning a list of error strings; if it
                  finds errors, the call is repeated once with those errors shown to the model.
        """
        key = self.cache_key(system, user_text, images, schema, document)
        cached = self._read_cache(key)
        if cached is not None and cached.get("parsed") is not None:
            self.stats["cache_hits"] += 1
            return cached["parsed"], key

        parsed, entry = self._ask_with_repair(system, user_text, images, schema, document, validate)
        entry.update({"key": key, "call_tag": call_tag})
        self._write_cache(key, entry)
        return parsed, key

    def cache_key(self, system: str, user_text: str, images: list[bytes] = [],
                  schema: dict | None = None, document: str | None = None) -> str:
        """sha256 over everything that changes the answer."""
        parts = {
            "model": self.model,
            "effort": self.effort,
            "system": system,
            "document": document or "",
            "user_text": user_text,
            "images": [hashlib.sha256(img).hexdigest() for img in images],
            "schema": schema,
        }
        return sha256_text(json.dumps(parts, sort_keys=True, ensure_ascii=False))

    def cached_entry(self, key: str) -> dict | None:
        """The full cache record for a call (request summary, raw text, usage...)."""
        return self._read_cache(key)

    # ------------------------------------------------------------------ request building

    def build_request(self, system: str, user_text: str, images: list[bytes],
                      schema: dict | None, document: str | None,
                      max_tokens: int | None = None) -> dict:
        """The keyword arguments for client.beta.messages.stream(...)."""
        content: list[dict] = []
        if document:
            # The stable, large block goes first and carries the cache breakpoint, so the seven
            # clause calls over one package read it from the prompt cache.
            # 1-hour TTL: at high effort one clause call can take minutes, so the gap between
            # calls may pass the default 5-minute TTL.
            content.append({"type": "text", "text": document,
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}})
        for img in images:
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": "image/png",
                "data": base64.standard_b64encode(img).decode("ascii")}})
        content.append({"type": "text", "text": user_text})

        output_config: dict = {"effort": self.effort}
        if schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": schema}

        request = {
            "model": self.model,
            "max_tokens": max_tokens or self.max_tokens,
            "system": [{"type": "text", "text": system}],
            "messages": [{"role": "user", "content": content}],
            "thinking": {"type": "adaptive"},
            "output_config": output_config,
        }
        if self.use_fallbacks:
            # Installed SDK (0.109) types only the array form, so the "default" scalar form
            # is passed through extra_body with its own beta header.
            request["betas"] = [FALLBACK_BETA]
            request["extra_body"] = {"fallbacks": "default"}
        return request

    # ------------------------------------------------------------------ the call itself

    def _ask_with_repair(self, system, user_text, images, schema, document, validate):
        """Call, parse, validate; on invalid JSON or validation errors try once more."""
        attempts = []
        text_now = user_text
        parsed, errors, message = None, ["no call made"], None
        for attempt in (1, 2):
            message = self._call(system, text_now, images, schema, document)
            raw = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
            try:
                parsed = parse_json_text(raw)
                errors = validate(parsed) if validate else []
            except json.JSONDecodeError as exc:
                parsed, errors = None, [f"Reply was not valid JSON: {exc}"]
            attempts.append({"attempt": attempt, "raw_text": raw, "errors": errors,
                             "stop_reason": message.stop_reason})
            if not errors:
                break
            self.stats["repairs"] += 1
            text_now = (user_text + "\n\nYour previous reply had these problems:\n- "
                        + "\n- ".join(errors[:20])
                        + "\nReturn the complete corrected JSON only.")

        if parsed is None:
            raise LLMError("The model did not return valid JSON after a retry: " + "; ".join(errors))

        entry = {
            "request": {
                "model": self.model, "effort": self.effort,
                "thinking": {"type": "adaptive"},
                "fallbacks": "default" if self.use_fallbacks else None,
                "system_sha256": sha256_text(system), "system_chars": len(system),
                "document_sha256": sha256_text(document) if document else "",
                "document_chars": len(document or ""),
                "user_text": user_text,
                "image_sha256": [hashlib.sha256(i).hexdigest() for i in images],
                "schema": schema,
                "prompt_version": config.PROMPT_VERSION,
            },
            "metadata": {"temperature": TEMPERATURE_NOTE},
            "raw_text": attempts[-1]["raw_text"],
            "parsed": parsed,
            "validation_errors": errors,
            "attempts": attempts,
            "usage": _usage_dict(message),
            "served_by": getattr(message, "model", self.model),
            "stop_reason": message.stop_reason,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        return parsed, entry

    def _call(self, system, user_text, images, schema, document):
        """One logical request: network retries, max_tokens retry, refusal check."""
        max_tokens = self.max_tokens
        while True:
            request = self.build_request(system, user_text, images, schema, document, max_tokens)
            message = self._send_with_retries(request)
            self._count_usage(message)
            if message.stop_reason == "refusal":
                details = getattr(message, "stop_details", None)
                category = getattr(details, "category", None) if details else None
                raise LLMRefusalError(f"The model declined this request (category: {category}).")
            if message.stop_reason == "max_tokens":
                if max_tokens >= MAX_TOKENS_CEILING:
                    raise LLMError("The answer was cut off at the maximum output length.")
                max_tokens = min(max_tokens * 2, MAX_TOKENS_CEILING)
                log.warning("Output hit max_tokens; retrying with max_tokens=%s", max_tokens)
                continue
            return message

    def _send_with_retries(self, request: dict):
        delay = 2.0
        for attempt in range(NETWORK_RETRIES + 1):
            try:
                return self._send(request)
            except anthropic.AuthenticationError as exc:
                raise MissingAPIKeyError(
                    "ANTHROPIC_API_KEY was rejected by the API. Check the key in backend/.env") from exc
            except anthropic.BadRequestError as exc:
                if self.use_fallbacks and "fallback" in str(exc).lower():
                    log.warning("Server-side fallbacks rejected (%s); sending without them", exc)
                    self.use_fallbacks = False
                    request.pop("betas", None)
                    request.pop("extra_body", None)
                    continue
                raise LLMError(f"Bad request to the Claude API: {exc}") from exc
            except (anthropic.RateLimitError, anthropic.APIConnectionError,
                    anthropic.APIStatusError) as exc:
                transient = not isinstance(exc, anthropic.APIStatusError) or (
                    isinstance(exc, anthropic.RateLimitError) or exc.status_code >= 500)
                if not transient:
                    raise LLMError(f"Claude API error {exc.status_code}: {exc}") from exc
                if attempt == NETWORK_RETRIES:
                    raise LLMError(f"Claude API unavailable after retries: {exc}") from exc
                log.warning("Claude API error (%s); retrying in %.0fs", type(exc).__name__, delay)
                time.sleep(delay)
                delay *= 2
        raise LLMError("Claude API request failed")

    def _send(self, request: dict):
        """Stream the request (long inputs need streaming) and return the final message."""
        with self._get_client().beta.messages.stream(**request) as stream:
            return stream.get_final_message()

    def _get_client(self) -> anthropic.Anthropic:
        if self._client is None:
            if not os.getenv("ANTHROPIC_API_KEY"):
                raise MissingAPIKeyError(MISSING_KEY_MESSAGE)
            self._client = anthropic.Anthropic(max_retries=3)
        return self._client

    # ------------------------------------------------------------------ bookkeeping

    def _count_usage(self, message) -> None:
        self.stats["calls"] += 1
        for name, value in _usage_dict(message).items():
            if name in self.stats:
                self.stats[name] += value

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def _read_cache(self, key: str) -> dict | None:
        path = self._cache_path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def _write_cache(self, key: str, entry: dict) -> None:
        path = self._cache_path(key)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(entry, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)


def _usage_dict(message) -> dict:
    usage = getattr(message, "usage", None)
    out = {}
    for name in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                 "cache_creation_input_tokens"):
        out[name] = int(getattr(usage, name, 0) or 0) if usage is not None else 0
    return out
