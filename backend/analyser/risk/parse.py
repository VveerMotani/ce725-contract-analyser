"""Small, deterministic text parsers used by the risk rules.

They read numbers out of the plain-words answers ("0.05% of Contract Price for
each day", "10 working days", "Rs 188.65 lakh"). No LLM, only regular
expressions, so the same answer always gives the same number.
"""
from __future__ import annotations

import re

# "5%", "2.50%", "0 .05%" (broken text, trap T17), "5 per cent"
_PCT = re.compile(r"(\d+(?:\s?\.\s?\d+)?|\.\d+)\s*(?:%|per\s?cent\b|percent\b)", re.I)

# "30 days", "10 working days", "9 months", "5 years", "2 weeks"
_DUR = re.compile(
    r"(\d+(?:\.\d+)?)\s*(working\s+days?|business\s+days?|calendar\s+days?|days?|"
    r"months?|weeks?|years?)\b", re.I)

# "Rs 2,12,27,336", "Rs. 30 lakhs", "INR 10 crore", "Rs 188.65 lakh"
_RUPEE = re.compile(
    r"(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b\.?|lakhs?|lacs?|lac\b)?", re.I)

DAYS_PER_MONTH = 365 / 12          # 30.42, only for converting a stated duration to months


def _num(s: str) -> float:
    return float(re.sub(r"\s", "", s))


def percents(text: str) -> list[tuple[float, int, int]]:
    """Every percentage in the text as (value in percent, start, end)."""
    return [(_num(m.group(1)), m.start(), m.end()) for m in _PCT.finditer(text or "")]


def first_percent(text: str) -> float | None:
    p = percents(text)
    return p[0][0] if p else None


def max_percent(text: str) -> float | None:
    p = percents(text)
    return max(v for v, _, _ in p) if p else None


def segments(text: str) -> list[str]:
    """Split a multi-part answer on semicolons (the answer format uses them)."""
    return [s.strip() for s in re.split(r";", text or "") if s.strip()]


def has(text: str, patterns: list[str]) -> bool:
    """True if any regex pattern matches (case-insensitive)."""
    return any(re.search(p, text or "", re.I) for p in patterns)


def find(text: str, patterns: list[str]) -> str:
    """The first matching phrase, or ''."""
    for p in patterns:
        m = re.search(p, text or "", re.I)
        if m:
            return m.group(0)
    return ""


def durations(text: str) -> list[tuple[float, str]]:
    """Every duration as (number, unit) with unit in day, working_day, week, month, year."""
    out = []
    for m in _DUR.finditer(text or ""):
        unit = m.group(2).lower()
        if unit.startswith(("working", "business")):
            u = "working_day"
        elif unit.startswith(("calendar", "day")):
            u = "day"
        elif unit.startswith("week"):
            u = "week"
        elif unit.startswith("month"):
            u = "month"
        else:
            u = "year"
        out.append((float(m.group(1)), u))
    return out


def to_calendar_days(value: float, unit: str, working_day_factor: float) -> float:
    """Convert a duration to calendar days (working days x factor, months x 30)."""
    return {"day": value, "working_day": value * working_day_factor, "week": value * 7,
            "month": value * 30, "year": value * 365}[unit]


def to_months(value: float, unit: str) -> float:
    return {"day": value / DAYS_PER_MONTH, "working_day": value * 1.4 / DAYS_PER_MONTH,
            "week": value * 7 / DAYS_PER_MONTH, "month": value, "year": value * 12}[unit]


def first_duration_months(text: str) -> float | None:
    d = durations(text)
    return round(to_months(*d[0]), 2) if d else None


def rupees(text: str) -> list[float]:
    """Every rupee amount, in rupees ("Rs 30 lakhs" -> 3,000,000)."""
    out = []
    for m in _RUPEE.finditer(text or ""):
        digits = m.group(1).replace(",", "")
        if not digits or digits == ".":
            continue
        val = float(digits)
        word = (m.group(2) or "").lower()
        if word.startswith("cr"):
            val *= 1e7
        elif word.startswith("la"):
            val *= 1e5
        out.append(val)
    return out


def per_day_rates(text: str, days_per_month: float) -> list[tuple[float, str]]:
    """Delay-damages rates converted to % of value per day.

    For each percentage, look at the words right after it (up to the next
    percentage or semicolon) for "per day / each day / per week / per month".
    Percentages with no time unit (caps, milestone shares) are ignored.
    Returns (rate % per day, the original phrase).
    """
    text = text or ""
    found = percents(text)
    out = []
    for i, (val, start, end) in enumerate(found):
        stop = found[i + 1][1] if i + 1 < len(found) else len(text)
        window = text[end:stop].split(";")[0][:90]
        m = re.search(r"\b(?:per|each|a|every|for each)\s+(day|week|month)\b", window, re.I)
        if not m:
            continue
        unit = m.group(1).lower()
        rate = val if unit == "day" else val / 7 if unit == "week" else val / days_per_month
        out.append((round(rate, 6), text[start:end] + window[:m.end()]))
    return out


def fmt_rupees(x: float | None) -> str:
    """Rs in crore or lakh, e.g. 'Rs 3.00 crore'."""
    if x is None:
        return ""
    if abs(x) >= 1e7:
        return f"Rs {x / 1e7:,.2f} crore"
    if abs(x) >= 1e5:
        return f"Rs {x / 1e5:,.2f} lakh"
    return f"Rs {x:,.0f}"


def fmt_num(x: float) -> str:
    """2.0 -> '2', 0.05 -> '0.05'."""
    return f"{x:.4f}".rstrip("0").rstrip(".")
