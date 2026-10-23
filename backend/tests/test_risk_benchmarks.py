"""Run the risk rules on fixtures built from the golden expected answers (BM1-BM4).

Run with `python -m pytest tests/test_risk_benchmarks.py -q -s` to see the printed flags.
The assertions are sanity checks on behaviour, not a scoring of the rules.
"""
from __future__ import annotations

import pytest

from analyser.risk import flag_risks_with_trace

from .test_risk_support import (HAND_BENCHMARK_CASH, golden_envelopes, golden_package, ids, one, summary)


@pytest.mark.parametrize("cid", ["BM1", "BM2", "BM3", "BM4"])
def test_benchmark_flags(cid):
    flags, skipped = flag_risks_with_trace(golden_envelopes(cid), golden_package(cid))
    print("\n" + summary(cid, flags, skipped))
    assert flags
    for f in flags:
        assert f.explanation and f.reference_source and f.rule
        if f.flag_id != "R18":
            assert f.question_ids, f.flag_id
        if f.category == "risk" and f.flag_id not in ("R9",):
            assert f.quote, f"{cid} {f.flag_id} has no quote"


def test_bm1_with_hand_benchmark_cash():
    flags, skipped = flag_risks_with_trace(golden_envelopes("BM1"), golden_package("BM1"), HAND_BENCHMARK_CASH)
    print("\n" + summary("BM1 + spec 8.4 cash inputs", flags, skipped))
    assert one(flags, "R9").rupee_impact == pytest.approx(10e7)
    assert one(flags, "R2").severity == "Info"


def test_benchmark_sanity():
    bm = {c: flag_risks_with_trace(golden_envelopes(c), golden_package(c))[0] for c in ("BM1", "BM2", "BM3", "BM4")}
    assert one(bm["BM3"], "R6").severity == "High"           # "No interest payable" (MP tender)
    assert one(bm["BM1"], "R2").severity == "Info"           # retention 6% capped at 5%
    assert "R13" in ids(bm["BM2"])                           # Rs 30 lakh minimum bill (IIT Bombay)
    assert {"R17", "R18"} <= set(ids(bm["BM4"]))             # GCC 2023 referenced, not supplied
    assert "R16" in ids(bm["BM3"])                           # two weight tables (trap T10)
    assert "R6" not in ids(bm["BM1"]) and "R4" not in ids(bm["BM1"])
