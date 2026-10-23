"""verify_answers: checks V1-V9, F9 conflicts, F10 normaliser, F14 review queue."""
from analyser.models import (Answer, AnswerEnvelope, Conflict, DocumentFile, Package, PageInfo,
                             ReviewState)
from analyser.verify import normalise_answer, verify_answers

PAGES = {
    10: "Clause 2 Compensation for Delay. The contractor shall pay compensation at the rate of "
        "1% (one percent) per month of delay of the tendered value, to be computed on per day basis, "
        "subject to a maximum of 10% of the tendered value.",
    11: "Clause 7.5 Retention. The Authority shall retain 6% of every payment for Works, "
        "subject to a maximum of 5% of the Contract Price, as per Schedule F.",
    12: "Payment. The Authority shall pay within 30 days of the Stage Payment Statement. "
        "Performance Security of 3% of the Bid Price shall be furnished.",
    13: "Schedule F. Minimum value of gross work for interim payment: Rs 30 lakhs.",
}


def package() -> Package:
    pages = [PageInfo(doc_id="d1", page=n, text=t, char_count=len(t)) for n, t in PAGES.items()]
    f = DocumentFile(doc_id="d1", filename="x.pdf", path="x.pdf", sha256="", page_count=20)
    return Package(package_id="T", contract_id="T", files=[f], pages=pages)


def env(qid="2.2", status="FOUND", value="6% of every payment", quote="retain 6% of every payment",
        page=11, unit="% of payment", base="every payment for Works", clause="C2", **kw) -> AnswerEnvelope:
    a = Answer(contract_id="T", clause_id=clause, question_id=qid, status=status, answer_value=value,
               unit=unit, base=base, value_source=kw.pop("value_source", "clause"),
               section_ref=kw.pop("section_ref", "Clause 7.5"), pdf_page=page,
               verbatim_quote=quote, confidence=kw.pop("confidence", "high"), **kw)
    return AnswerEnvelope(question="q", answer=a)


def check(e: AnswerEnvelope, code: str, name_part: str = ""):
    return next(c for c in e.verification.checks if c.check == code and name_part in c.name)


def test_good_answer_passes_and_sets_doc_id():
    e = env(qid="1.3", clause="C1", value="30 days from the Stage Payment Statement",
            quote="shall pay within 30 days of the Stage Payment Statement", page=12, unit="days", base="")
    verify_answers([e], package())
    v = e.verification
    assert v.quote_found and v.found_page == 12 and v.page_matches and e.doc_id == "d1"
    assert check(e, "V3").passed is True
    assert v.verdict == "pass" and not v.discard
    assert e.review.decision == "not_needed" and e.review.reasons == []


def test_planted_fake_quote_fails_and_is_discarded():
    e = env(quote="The Authority shall retain 8% of every payment without any maximum")
    verify_answers([e], package())
    v = e.verification
    assert v.quote_found is False and check(e, "V1").passed is False
    assert v.verdict == "fail" and v.discard is True
    assert e.review.decision == "pending" and any("Discarded" in r for r in e.review.reasons)


def test_page_off_by_one_is_a_warning():
    e = env(page=12)
    verify_answers([e], package())
    assert e.verification.page_matches is True and e.verification.found_page == 11
    assert check(e, "V2").passed is False and e.verification.verdict == "warn"


def test_page_far_off_is_not_a_match():
    e = env(page=40)
    verify_answers([e], package())
    assert e.verification.page_matches is False and e.verification.verdict == "warn"


def test_number_only_on_page_warns_and_invented_number_fails():
    e1 = env(value="6% of every payment; cap 5% of Contract Price")
    e2 = env(qid="2.3", value="7% of Contract Price")
    verify_answers([e1, e2], package())
    assert check(e1, "V3").passed is False and e1.verification.verdict == "warn"
    assert check(e2, "V3").detail.startswith("FAIL") and e2.verification.verdict == "fail"
    assert check(e2, "V3").severity == "fail" and check(e1, "V3").severity == "warn"
    assert check(e1, "V1").severity == "info"
    assert not e2.verification.discard          # discard only when the quote is not in the text


def test_unit_and_base_required():
    e = env(unit="", base="", value="6%")
    verify_answers([e], package())
    assert check(e, "V4").passed is False


def test_schedule_pointer_with_clause_only_answer():
    e = env(quote="subject to a maximum of 5% of the Contract Price, as per Schedule F", qid="2.3",
            value="5% of Contract Price")
    verify_answers([e], package())
    assert check(e, "V5").passed is False


def test_own_conflicts_and_low_confidence_go_to_review():
    e = env(conflicts=[Conflict(value="5%", section_ref="Sch E", pdf_page=13)], confidence="low")
    verify_answers([e], package())
    assert check(e, "V6").passed is False
    assert any(r.startswith("Conflict") for r in e.review.reasons)
    assert "Low confidence" in e.review.reasons


def test_plausibility_ranges():
    e1 = env(value="40% of every payment", quote="")       # retention 40%
    e2 = env(qid="4.2", clause="C4", value="2% per day of tendered value", quote="", base="tendered value")
    for e in (e1, e2):
        e.answer.visual_check = "done"
        e.answer.visual_evidence = "read from image"
    verify_answers([e1, e2], package())
    assert check(e1, "V7").passed is False
    assert check(e2, "V7").passed is False


def test_not_stated_key_field_needs_review():
    e = env(status="NOT_STATED", value="", quote="", page=0)
    verify_answers([e], package())
    v = e.verification
    assert v.quote_found is None and check(e, "V8").passed is False
    assert e.review.decision == "pending"
    assert any(r.startswith("NOT_STATED") for r in e.review.reasons)


def test_points_elsewhere_and_visual_needed_go_to_review():
    e1 = env(status="POINTS_ELSEWHERE", value="Rate in GCC clause 2", quote="", points_to="CPWD GCC 2023")
    e2 = env(visual_check="needed")
    verify_answers([e1, e2], package())
    assert any("POINTS_ELSEWHERE" in r for r in e1.review.reasons)
    assert any("Visual check needed" in r for r in e2.review.reasons)


def test_human_decision_is_kept():
    e = env(status="NOT_STATED", value="", quote="", page=0)
    e.review = ReviewState(decision="accepted")
    verify_answers([e], package())
    assert e.review.decision == "accepted" and e.review.reasons


def test_cross_answer_conflict_f9():
    e22 = env(qid="2.2", value="6% of every payment")
    e15 = env(qid="1.5", clause="C1", value="Retention 5% of each bill; advance recovery 15%",
              quote="retain 6% of every payment")
    e62 = env(qid="6.2", clause="C6", value="Performance Security 3% of Bid Price",
              quote="Performance Security of 3% of the Bid Price", page=12)
    e61 = env(qid="6.1", clause="C6", value="Performance security 5% of Bid Price; retention money",
              quote="Performance Security of 3% of the Bid Price", page=12)
    verify_answers([e22, e15, e62, e61], package())
    for e in (e22, e15):
        c = check(e, "V6", "across")
        assert c.passed is False and "retention" in c.detail
    assert "performance security" in check(e62, "V6", "across").detail
    assert any("Consistent across answers" in r for r in e15.review.reasons)


def test_normaliser_f10():
    a = env(qid="4.2", clause="C4", value="Maximum 1% per month of delay, computed per day",
            base="tendered value").answer
    n = normalise_answer(a)
    assert abs(n["rate_per_day_of_value"] - 0.01 / 30) < 1e-6
    assert "1/30" in n["rate_conversion"]
    n2 = normalise_answer(env(qid="4.2", clause="C4", value="0.05% of Contract Price for each day").answer)
    assert n2["rate_per_day_of_value"] == 0.0005
    n3 = normalise_answer(env(qid="2.2", value="6% of every payment; not more than 5% of Contract Price").answer)
    assert n3["rate_share"] == 0.06 and n3["cap_share_of_value"] == 0.05
    n4 = normalise_answer(env(qid="1.3", value="10 working days; Rs 1.5 crore minimum").answer)
    assert n4["days"] == 10 and n4["days_kind"] == "working" and n4["amount_rs"] == 15_000_000
    assert normalise_answer(env(qid="0.4", value="9 months").answer)["months"] == 9


class FakeLLM:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def call_json(self, system, user_text, images=[], schema=None, call_tag=""):
        self.calls.append(user_text)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply, "key"


def test_v9_optional_llm_check():
    e = env()
    llm = FakeLLM({"verdict": "PARTIAL", "reason": "cap missing"})
    verify_answers([e], package(), llm=llm)
    assert check(e, "V9").passed is False and "cap missing" in check(e, "V9").detail
    assert "retain 6% of every payment" in llm.calls[0]
    e2 = env()
    verify_answers([e2], package(), llm=FakeLLM(RuntimeError("no network")))
    assert check(e2, "V9").passed is None
    e3 = env()
    verify_answers([e3], package())
    assert not [c for c in e3.verification.checks if c.check == "V9"]
