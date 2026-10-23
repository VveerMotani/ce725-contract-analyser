"""F5 term lists: words to look for, per clause type (spec §4, synonyms per trap T11).

Built from the "Look for" columns of spec §4 plus general Indian public-works
wording. Nothing here comes from the test contracts' answers.

A "#" inside a term stands for a number, optionally followed by the number in
words in brackets: "within # days" matches "within 15 (fifteen) days".
"""
from __future__ import annotations

TERM_LISTS: dict[str, list[str]] = {
    # C0 contract facts: form, parties, value, period, defects period, milestones
    "C0": [
        "general conditions of contract", "standard epc agreement", "epc agreement",
        "conditions of contract", "form of agreement", "articles of agreement", "contract form",
        "employer", "engineer-in-charge", "engineer in charge", "authority's engineer",
        "president of india", "name of work", "name of the work", "parties", "hereinafter called",
        "of the one part", "of the other part", "on behalf of", "tender form", "form of tender",
        "cpwd-7", "cpwd-8", "cpwd 7", "cpwd 8", "notice inviting", "invites", "percentage rate",
        "item rate",
        "estimated cost", "tendered value", "tendered amount", "probable amount of contract",
        "contract price", "contract value", "bid price", "accepted tender", "amount put to tender",
        "time allowed", "stipulated period", "stipulated date of completion", "period of completion",
        "completion period", "scheduled completion date", "time for completion", "date of start",
        "appointed date", "defect liability period", "defects liability period", "maintenance period",
        "warranty", "defects", "any defect", "guarantee period", "milestone", "mile stone", "project completion schedule",
    ],
    # C1 payment terms
    "C1": [
        "running bill", "running account bill", "running account", "interim payment",
        "interim payment certificate", "ipc", "stage payment statement", "stage payment",
        "milestone payment", "monthly statement", "statement of the value", "on account payment",
        "gross work to be done", "since the last such payment", "eligible to interim payment",
        "working days", "within # days", "# days of", "on or before the #", "ad hoc payment", "part payment", "payment of bills",
        "interest at", "bank rate", "simple interest", "no interest", "interest shall be payable",
        "delayed payment", "late payment", "deductions", "recoveries",
        "final bill", "final payment", "final payment statement", "completion certificate", "discharge",
        "labour licence", "labour license", "no running account bill", "pay when paid",
        "measurement book", "computerised measurement book", "electronic measurement book",
        "payment", "bill", "certified", "certificate of payment",
        "security deposit", "retention money", "guarantee money", "recovery of advance",
    ],
    # C2 retention and security deposit
    "C2": [
        "retention money", "retention", "security deposit", "guarantee money", "each running bill",
        "of tendered value", "of gross amount", "maximum limit", "shall not exceed", "up to",
        "earnest money", "converted into security", "bid security", "performance security",
        "refunded", "refund", "released", "release of security", "defect liability period",
        "defects liability period", "year wise", "after six months",
        "bank guarantee", "fixed deposit", "fdr", "surety bond", "government securities",
        "no interest", "deducted",
    ],
    # C3 advances
    "C3": [
        "mobilisation advance", "mobilization advance", "mobilisation", "mobilization",
        "machinery advance", "plant and machinery advance", "construction machinery",
        "secured advance", "advance payment", "advance", "interest free", "interest-free",
        "simple interest", "interest bearing", "interest-bearing", "bank rate", "instalment",
        "installment", "110%", "hypothecat", "recovery", "recovered", "recoverable",
        "utilisation certificate", "utilization certificate", "pro-rata", "pro rata",
    ],
    # C4 delay damages (T11 synonyms: compensation for delay, amount withheld, slippage)
    "C4": [
        "liquidated damages", "compensation for delay", "damages", "penalty", "amount withheld",
        "withheld", "withhold", "retention for slippage", "slippage", "per day", "per week",
        "per month", "of delay", "delay in completion", "# % per", "per day of delay", "shall not exceed", "limited to a maximum",
        "maximum of", "milestone", "mile stone", "fails to achieve", "progress",
        "extension of time", "time extension", "rescheduling", "hindrance", "force majeure",
        "genuine pre-estimate", "pre-estimated", "without reference to actual loss",
        "not by way of penalty", "lane closure", "bonus", "early completion",
        "terminate", "termination", "authority to decide", "actual loss", "reasonable compensation",
        "liable to pay", "late fee", "default", "at the rate of", "recovered from",
    ],
    # C5 price escalation / price variation
    "C5": [
        "price variation", "price adjustment", "escalation", "rates firm", "firm price", "fixed price",
        "no escalation", "10c", "10ca", "10cc", "formula", "formulae", "v =",
        "weightage", "weights", "component of labour", "component of materials", "labour", "cement",
        "steel", "bitumen", "fuel", "pol", "plant and machinery", "other materials",
        "wholesale price index", "wpi", "consumer price index", "cpi", "price index", "index",
        "indices", "base date", "base index", "base price", "stipulated period", "statutory",
        "fresh law", "statutory rule", "0.85", "variation in", "increase or decrease",
    ],
    # C6 guarantees and securities
    "C6": [
        "earnest money", "emd", "bid security", "bid security declaration", "performance guarantee",
        "performance security", "additional performance security", "additional security",
        "bank guarantee", "e-bank guarantee", "surety bond", "insurance surety", "demand draft",
        "fixed deposit", "fdr", "banker's cheque", "bankers cheque", "scheduled bank",
        "commercial bank", "nationalised bank", "valid", "validity", "extended", "extension",
        "encash", "forfeit", "forfeiture", "on demand", "first written demand", "110%",
        "unbalanced", "below the estimated", "returned", "refunded", "late fee",
        "guarantee bond", "reserve bank of india", "bank incorporated", "scheduled commercial bank",
    ],
}

# Terms so common in contracts that one hit says little: they count half.
GENERIC_TERMS = {
    "payment", "bill", "certified", "refund", "refunded", "released", "deducted", "advance",
    "recovery", "recovered", "progress", "valid", "extended", "extension", "returned", "labour",
    "cement", "steel", "fuel", "index", "weights", "up to", "employer", "warranty", "terminate",
    "termination", "withhold", "per month", "per day", "maximum of", "statutory", "milestone",
    "parties", "on behalf of", "invites", "default", "at the rate of",
    "mile stone", "instalment", "installment", "deductions", "recoveries", "discharge",
}


def term_weight(term: str) -> float:
    """Weight of one term hit: generic words and number patterns 0.5, single words 1, phrases 2."""
    if term in GENERIC_TERMS or "#" in term:
        return 0.5
    return 2.0 if " " in term.strip() or "-" in term else 1.0
