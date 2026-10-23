"""Search words per clause type (spec section 4) and second wordings for the absence check (F8).

The structure module owns the main TERM_LISTS; this copy is only used when it cannot be imported.
Only generic wording is listed here: no values from the benchmark contracts.
"""
from __future__ import annotations

FALLBACK_TERM_LISTS: dict[str, list[str]] = {
    "C0": ["General Conditions of Contract", "Standard EPC Agreement", "Employer", "Authority",
           "Contractor", "Engineer-in-Charge", "estimated cost", "tendered value",
           "probable amount of contract", "Contract Price", "bid price", "time allowed",
           "stipulated period", "scheduled completion date", "defect liability period",
           "defects liability period", "maintenance period", "milestone", "mile stone"],
    "C1": ["running bill", "running account bill", "interim payment certificate",
           "stage payment statement", "milestone payment", "monthly statement", "interim payment",
           "working days", "ad hoc payment", "part payment", "interest at", "Bank Rate",
           "simple interest", "no interest", "final bill", "final payment statement",
           "completion certificate", "measurement book", "labour licence"],
    "C2": ["retention money", "security deposit", "guarantee money", "of each running bill",
           "of tendered value", "shall not exceed", "earnest money", "bid security", "refunded",
           "defect liability period", "bank guarantee", "FDR", "no interest"],
    "C3": ["mobilisation advance", "mobilization advance", "machinery advance",
           "plant and machinery advance", "secured advance", "advance payment", "instalment",
           "interest free", "simple interest", "Bank Rate", "recovery", "recovered",
           "utilisation certificate"],
    "C4": ["liquidated damages", "compensation for delay", "damages", "penalty", "amount withheld",
           "retention for slippage", "per day", "per week", "per month", "shall not exceed",
           "maximum", "milestone", "extension of time", "genuine pre-estimate", "not by way of penalty",
           "bonus", "terminate"],
    "C5": ["price variation", "price adjustment", "escalation", "rates firm", "no escalation",
           "10C", "10CA", "10CC", "wholesale price index", "labour index", "consumer price index",
           "base date", "formula", "fresh law", "statutory rule"],
    "C6": ["earnest money", "EMD", "bid security", "bid security declaration", "performance guarantee",
           "performance security", "additional performance security", "bank guarantee",
           "e-bank guarantee", "surety bond", "demand draft", "FDR", "banker's cheque",
           "scheduled bank", "commercial bank", "encash", "forfeit", "validity", "released"],
}

# Second wordings (trap T11): other names for the same thing.
SYNONYMS: dict[str, list[str]] = {
    "C0": ["name of work", "cost of work", "value of work", "time of completion",
           "period of completion", "date of start", "appointed date", "warranty period",
           "guarantee period", "stages of work", "time schedule"],
    "C1": ["on account payment", "progress payment", "payment certificate", "IPC", "RA bill",
           "bill of the contractor", "delayed payment", "interest on delayed payments",
           "certified by the Engineer", "payable within", "final certificate", "pay when paid",
           "funds received from"],
    "C2": ["retention", "SD", "security money", "deduction from bills", "deducted from each bill",
           "retained", "release of security", "refund of security deposit", "in lieu of"],
    "C3": ["advance to contractor", "equipment advance", "interest bearing advance",
           "advance against materials", "advance recovery", "advance bank guarantee",
           "no advance", "shall not be applicable"],
    "C4": ["delay damages", "compensation", "slippage", "amount retained", "levy", "recovery for delay",
           "time extension", "hindrance register", "extension of completion date", "deducted from",
           "pre-estimate", "proof of loss"],
    "C5": ["variation in prices", "price escalation", "increase or decrease in cost",
           "variation in rates", "PVC", "adjustment for changes in cost", "index", "indices",
           "components", "weightage", "firm price", "fixed price"],
    "C6": ["guarantee", "security", "irrevocable", "unconditional", "validity period",
           "extended", "forfeiture", "invoke", "release of performance guarantee",
           "below the estimated cost", "lower than the estimate"],
}
