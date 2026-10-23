"""F9 conflict detector across answers (trap T10).

The same item is often stated in several answers: the retention rate in 2.2 and in the
list of deductions (1.5) and of securities (6.1, 6.2); the performance security in
6.1, 6.2 and 2.4; the earnest money in 0.3, 6.1 and 6.2. If two answers give different
values for one item, every answer involved gets a V6 check and a review reason.
(Conflicts inside one answer are reported by the model in ``answer.conflicts``; V6.)
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from analyser.models import Answer

from .numbers import extract_quantities


@dataclass(frozen=True)
class Item:
    name: str
    kind: str                     # quantity kind to read: percent or rupees
    primary: frozenset            # questions that are about this item: first value counts
    secondary: frozenset          # questions where the value must follow the keyword
    keyword: str                  # regex for the item's name


ITEMS = [
    Item("retention / security deposit rate", "percent", frozenset({"2.2"}),
         frozenset({"1.5", "2.1", "6.1", "6.2"}), r"retention(?: money)?|security deposit"),
    Item("performance security", "percent", frozenset(),
         frozenset({"2.4", "6.1", "6.2"}), r"(?<!additional )performance (?:security|guarantee)"),
    Item("earnest money / bid security", "rupees", frozenset(),
         frozenset({"0.3", "2.4", "6.1", "6.2"}), r"earnest money|\bemd\b|bid security"),
]


def item_value(item: Item, a: Answer) -> float | None:
    """The value this answer gives for the item, or None if it does not give one."""
    if a.status != "FOUND":
        return None
    text = a.answer_value
    if a.question_id in item.primary:
        for q in extract_quantities(text):
            if q.kind == item.kind:
                return q.rupees if item.kind == "rupees" else q.value
        return None
    if a.question_id not in item.secondary:
        return None
    low = text.lower()
    for m in re.finditer(item.keyword, low):
        segment = low[m.end(): m.end() + 60].split(";")[0]
        for q in extract_quantities(segment):
            if q.kind == item.kind:
                return q.rupees if item.kind == "rupees" else q.value
    return None


def find_conflicts(answers: list[Answer]) -> list[dict]:
    """List of conflicts: {"item", "values": {question_id: value}} with 2+ distinct values."""
    out = []
    for item in ITEMS:
        values = {}
        for a in answers:
            v = item_value(item, a)
            if v is not None:
                values.setdefault(a.question_id, v)
        if len({round(v, 6) for v in values.values()}) > 1:
            out.append({"item": item.name, "kind": item.kind, "values": values})
    return out


def describe(conflict: dict) -> str:
    unit = "%" if conflict["kind"] == "percent" else ""
    prefix = "Rs " if conflict["kind"] == "rupees" else ""
    parts = [f"{qid} says {prefix}{v:g}{unit}" for qid, v in sorted(conflict["values"].items())]
    return f"{conflict['item']}: " + ", ".join(parts)
