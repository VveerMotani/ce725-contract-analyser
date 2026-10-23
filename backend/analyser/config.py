"""Paths and settings shared by every module."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

BENCHMARK_DIR = PROJECT_DIR / "Benchmark Contracts"
DEV_DOCS_DIR = PROJECT_DIR / "Dev Documents"
GOLDEN_TESTS = PROJECT_DIR / "golden_tests_v1.json"
EXTRACTION_SCHEMA = PROJECT_DIR / "extraction_schema_v1.json"
QUESTIONNAIRE = PROJECT_DIR / "Contract_Extraction_Questionnaire_v0.1.md"
PROMPTS_DIR = BACKEND_DIR / "prompts"
LLM_CACHE_DIR = BACKEND_DIR / "cache" / "llm"
RUNS_DIR = PROJECT_DIR / "runs"
UPLOADS_DIR = PROJECT_DIR / "runs" / "_uploads"

PROMPT_VERSION = os.getenv("PROMPT_VERSION", "v1")
MODEL = os.getenv("ANALYSER_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("ANALYSER_EFFORT", "high")

# Benchmark packages preloaded in the app. Test contracts must never be used for prompt tuning.
BENCHMARKS: dict[str, dict] = {
    "BM1": {"title": "NHAI Makhu Town EPC Agreement",
            "files": [("BM1_NHAI_Makhu_Town_EPC_Agreement.pdf", "gcc")]},
    "BM2": {"title": "IIT Bombay Chemistry Lab Tender",
            "files": [("BM2_IIT_Bombay_Chemistry_Lab_Tender.pdf", "notice")]},
    "BM3": {"title": "MP Agro Gwalior Tender",
            "files": [("BM3_MP_Agro_Gwalior_Tender.pdf", "notice")]},
    "BM4": {"title": "MoEF Zoological Park NIT",
            "files": [("BM4_MoEF_Zoological_Park_NIT.pdf", "notice")]},
}
TEST_PDF_NAMES = {f for b in BENCHMARKS.values() for f, _ in b["files"]}

for _d in (LLM_CACHE_DIR, RUNS_DIR, UPLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)
