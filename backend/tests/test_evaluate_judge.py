"""Optional LLM judge (off by default): batching, labels, accept_also cap, overrides win."""
import json

from analyser.evaluate import format_table, score_run
from analyser.evaluate.golden_check import golden_envelopes
from analyser.evaluate.judge import BATCH_SIZE, build_prompt


class FakeJudge:
    """Grades every test with a fixed verdict, except ids listed in ``special``."""

    def __init__(self, verdict="Correct", special=None, fail=False):
        self.verdict, self.special, self.fail = verdict, special or {}, fail
        self.calls = []

    def call_json(self, system, user_text, images=[], schema=None, call_tag="", document=None,
                  validate=None):
        self.calls.append(user_text)
        if self.fail:
            raise RuntimeError("API down")
        items = json.loads(user_text.split("Tests:")[-1])
        rows = [{"id": i["id"], "verdict": self.special.get(i["id"], self.verdict),
                 "missing": ["the 30-day fallback"] if i["id"] in self.special else [],
                 "reason": "fake"} for i in items]
        result = {"results": rows}
        assert validate is None or validate(result) == []
        return result, "key"


def test_judge_is_off_by_default():
    s = score_run(golden_envelopes(), "no-judge", overrides=[])
    assert not any(t.reason.startswith("LLM-judged:") for t in s.tests)
    assert "Labels set by LLM judge                                 0" in format_table(s)


def test_judge_grades_text_heavy_tests_in_batches():
    judge = FakeJudge(special={"BM1-1.3": "Partial"})
    s = score_run(golden_envelopes(), "judged", overrides=[], judge=judge)
    judged = [t for t in s.tests if t.reason.startswith("LLM-judged:")]
    flagged_before = sum(t.needs_human_check for t in score_run(golden_envelopes(), "x", overrides=[]).tests)
    assert len(judged) == flagged_before > 100
    assert len(judge.calls) == -(-len(judged) // BATCH_SIZE)        # about 15 tests per call
    t13 = next(t for t in s.tests if t.test_id == "BM1-1.3")
    assert t13.label == "Partial" and t13.needs_human_check and "30-day fallback" in t13.reason
    assert t13.cause_code == "ONE_OF_MANY_NUMBERS"
    assert f"Labels set by LLM judge                                 {len(judged)}" in format_table(s)


def test_accept_also_status_stays_partial():
    envs = golden_envelopes()
    for e in envs["BM3"]:
        if e.answer.question_id == "5.2":                   # expected NOT_APPLICABLE, accept FOUND
            e.answer.status = "FOUND"
    s = score_run({"BM3": envs["BM3"]}, "r", overrides=[], judge=FakeJudge("Correct"))
    assert next(t for t in s.tests if t.test_id == "BM3-5.2").label == "Partial"


def test_manual_override_beats_judge_and_failures_keep_code_labels():
    ov = [{"test_id": "BM1-1.3", "label": "Correct", "reason": "read the page"}]
    s = score_run({"BM1": golden_envelopes()["BM1"]}, "r", overrides=ov,
                  judge=FakeJudge(special={"BM1-1.3": "Incorrect"}))
    t = next(t for t in s.tests if t.test_id == "BM1-1.3")
    assert t.label == "Correct" and t.reason.startswith("MANUAL OVERRIDE") and "LLM-judged" in t.reason
    s2 = score_run({"BM1": golden_envelopes()["BM1"]}, "r", overrides=[], judge=FakeJudge(fail=True))
    assert s2.counts["Correct"] + s2.counts["Correct absent"] == 52


def test_prompt_contains_expected_and_tool_answers():
    from analyser.evaluate.golden_check import golden_answer
    from analyser.evaluate.scoring import load_golden, score_test
    g = next(x for x in load_golden() if x["test_id"] == "BM1-4.2")
    a = golden_answer(g)
    from analyser.models import AnswerEnvelope
    text = build_prompt([(g, score_test(g, AnswerEnvelope(question="q", answer=a)), a)])
    assert "BM1-4.2" in text and "0.05% of Contract Price" in text and "{items}" not in text
    assert '"verdict"' in text                                  # JSON braces in the prompt survive
