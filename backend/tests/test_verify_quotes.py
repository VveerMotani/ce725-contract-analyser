"""quote_in_text: tolerant of PDF text quirks, strict about invented quotes (V1, trap T17)."""
from analyser.verify import quote_in_text
from analyser.verify.numbers import extract_quantities
from analyser.verify.text import compact, normalise

PAGE = """7.5 Retention Money
(i) The Authority shall retain by way of retention money 6% (six per cent) of the amount
due to the Contractor in every payment for Works, subject to a maxi-
mum of 5% of the Contract Price. Damages shall be paid at the rate of 0 .05% of the
Contract Price for each day of delay, and the Contractor shall be entitled to “Time
Extension” in accordance with Clause 10.3.
"""


def test_exact_quote_found():
    assert quote_in_text("retain by way of retention money 6% (six per cent)", PAGE) == (True, 100.0)


def test_line_break_and_hyphenation():
    found, score = quote_in_text(
        "of the amount due to the Contractor in every payment for Works, subject to a maximum of 5% "
        "of the Contract Price", PAGE)
    assert found and score == 100.0


def test_split_digits_and_curly_quotes():
    assert quote_in_text("at the rate of 0.05% of the Contract Price for each day of delay", PAGE)[0]
    assert quote_in_text('entitled to "Time Extension" in accordance with Clause 10.3', PAGE)[0]
    assert normalise("0 .05 %") == "0.05%"


def test_fuzzy_match_tolerates_a_misread_letter():
    found, score = quote_in_text("The Authority shall retain by way of retentlon money 6% (six per cent) "
                                 "of the amount due to the Contractor", PAGE)
    assert found and 92 <= score < 100


def test_planted_fake_quote_fails():
    found, score = quote_in_text("The Contractor shall be paid a mobilisation advance of 25% of the "
                                 "Contract Price free of interest", PAGE)
    assert not found and score < 92


def test_real_sentence_with_changed_number_fails():
    found, _ = quote_in_text("The Authority shall retain by way of retention money 8% (six per cent) "
                             "of the amount due to the Contractor in every payment for Works", PAGE)
    assert not found


def test_real_sentence_with_added_negation_fails():
    found, _ = quote_in_text("the Contractor shall not be entitled to Time Extension in accordance "
                             "with Clause 10.3", PAGE)
    assert not found


def test_ellipsis_quote_needs_every_part():
    assert quote_in_text("retain by way of retention money ... maximum of 5% of the Contract Price", PAGE)[0]
    assert not quote_in_text("retain by way of retention money ... maximum of 9% of the bid", PAGE)[0]


def test_empty_inputs():
    assert quote_in_text("", PAGE) == (False, 0.0)
    assert quote_in_text("anything", "") == (False, 0.0)
    assert compact("A-b, c") == "abc"


def test_number_kinds():
    qs = {q.raw: q for q in extract_quantities(
        "0.05% of Contract Price per day; 10 working days; Rs 4,24,547; Rs 30 lakhs; "
        "two instalments; Clause 19.2; dated 05.08.2021")}
    assert extract_quantities("clause 10CC applies")[0].kind == "ref"
    assert qs["0.05"].kind == "percent" and qs["0.05"].per == "day" and qs["0.05"].base == "contract price"
    assert qs["10"].kind == "days" and qs["10"].day_type == "working"
    assert qs["4,24,547"].rupees == 424547
    assert qs["30"].rupees == 3_000_000
    assert qs["two"].kind == "count" and qs["two"].value == 2
    assert qs["19.2"].kind == "ref"
    assert all(q.kind == "ref" for q in qs.values() if q.raw in ("05.08", "2021"))
