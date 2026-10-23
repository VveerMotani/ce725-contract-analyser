"""LLMClient: caching, JSON repair, request shape. No network: _send is replaced by a fake."""
from types import SimpleNamespace

import pytest

from analyser.llm import LLMClient, LLMError, LLMRefusalError, MissingAPIKeyError, render


def message(text, stop_reason="end_turn"):
    usage = SimpleNamespace(input_tokens=100, output_tokens=20, cache_read_input_tokens=0,
                            cache_creation_input_tokens=0)
    return SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""),
                                    SimpleNamespace(type="text", text=text)],
                           stop_reason=stop_reason, usage=usage, model="claude-opus-5-5")


class ScriptedClient(LLMClient):
    """Replies with the given texts in order and records every request."""

    def __init__(self, replies, **kw):
        super().__init__(**kw)
        self.replies = list(replies)
        self.requests = []

    def _send(self, request):
        self.requests.append(request)
        reply = self.replies.pop(0)
        return reply if isinstance(reply, SimpleNamespace) else message(reply)


def test_cache_hit_on_repeat(tmp_path):
    llm = ScriptedClient(['{"a": 1}'], cache_dir=tmp_path)
    first, key1 = llm.call_json("sys", "question", schema={"type": "object"})
    second, key2 = llm.call_json("sys", "question", schema={"type": "object"})
    assert first == second == {"a": 1}
    assert key1 == key2
    assert llm.stats["calls"] == 1 and llm.stats["cache_hits"] == 1
    assert (tmp_path / f"{key1}.json").exists()
    entry = llm.cached_entry(key1)
    assert entry["usage"]["input_tokens"] == 100
    assert entry["stop_reason"] == "end_turn"
    assert "temperature not settable" in entry["metadata"]["temperature"]


def test_key_changes_with_inputs(tmp_path):
    llm = LLMClient(cache_dir=tmp_path)
    base = llm.cache_key("s", "u", [b"img"], {"type": "object"}, "doc")
    assert base != llm.cache_key("s", "u", [b"img2"], {"type": "object"}, "doc")
    assert base != llm.cache_key("s", "u", [b"img"], {"type": "object"}, "doc2")
    assert base != llm.cache_key("s", "u2", [b"img"], {"type": "object"}, "doc")


def test_retry_on_invalid_json(tmp_path):
    llm = ScriptedClient(["this is not json", '{"ok": true}'], cache_dir=tmp_path)
    parsed, _ = llm.call_json("sys", "question")
    assert parsed == {"ok": True}
    assert llm.stats["calls"] == 2 and llm.stats["repairs"] == 1
    assert "not valid JSON" in llm.requests[1]["messages"][0]["content"][-1]["text"]


def test_invalid_json_twice_raises(tmp_path):
    llm = ScriptedClient(["nope", "still nope"], cache_dir=tmp_path)
    with pytest.raises(LLMError):
        llm.call_json("sys", "question")


def test_retry_with_validation_errors(tmp_path):
    llm = ScriptedClient(['{"answers": []}', '{"answers": [1]}'], cache_dir=tmp_path)
    validate = lambda obj: [] if obj["answers"] else ["no record for question(s) 2.2"]
    parsed, _ = llm.call_json("sys", "question", validate=validate)
    assert parsed == {"answers": [1]}
    assert "no record for question(s) 2.2" in llm.requests[1]["messages"][0]["content"][-1]["text"]


def test_request_shape(tmp_path):
    llm = ScriptedClient(['{"x": 1}'], cache_dir=tmp_path)
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    llm.call_json("sys", "question", images=[b"\x89PNG"], schema=schema, document="BIG DOC")
    req = llm.requests[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["thinking"] == {"type": "adaptive"}
    assert req["output_config"]["effort"] == "high"
    assert req["output_config"]["format"] == {"type": "json_schema", "schema": schema}
    assert "temperature" not in req and "top_p" not in req
    assert req["extra_body"] == {"fallbacks": "default"}
    assert req["betas"] == ["server-side-fallback-2026-07-01"]
    content = req["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "BIG DOC", "cache_control": {"type": "ephemeral", "ttl": "1h"}}
    assert content[1]["type"] == "image" and content[1]["source"]["media_type"] == "image/png"
    assert content[2] == {"type": "text", "text": "question"}


def test_refusal_raises(tmp_path):
    llm = ScriptedClient([message("", stop_reason="refusal")], cache_dir=tmp_path)
    with pytest.raises(LLMRefusalError):
        llm.call_json("sys", "question")


def test_max_tokens_retries_with_more_room(tmp_path):
    llm = ScriptedClient([message("{", stop_reason="max_tokens"), '{"done": 1}'], cache_dir=tmp_path)
    parsed, _ = llm.call_json("sys", "question")
    assert parsed == {"done": 1}
    assert llm.requests[1]["max_tokens"] == 2 * llm.requests[0]["max_tokens"]


def test_missing_api_key_message(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    llm = LLMClient(cache_dir=tmp_path)
    with pytest.raises(MissingAPIKeyError, match="Add ANTHROPIC_API_KEY to backend/.env"):
        llm.call_json("sys", "question")


def test_render_fills_only_known_names():
    out = render('A {x} {"answers": []} {y}', x="1 {y}")
    assert out == 'A 1 {y} {"answers": []} {y}'
