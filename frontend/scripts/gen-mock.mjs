// Copies the golden tests into src/mock/golden.json so the website can show
// realistic MOCK data while the backend is not running. Run: npm run gen-mock
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../golden_tests_v1.json");
const out = resolve(here, "../src/mock/golden.json");
const g = JSON.parse(readFileSync(src, "utf8"));
const keep = [
  "test_id", "contract_id", "contract", "pdf_file", "clause_id", "question_id", "question",
  "expected_status", "expected_answer", "expected_unit", "section_ref", "pdf_page",
  "verbatim_quote", "core", "accept_also_status", "scanned_or_visual_only", "notes",
];
const tests = g.tests.map((t) => Object.fromEntries(keep.map((k) => [k, t[k]])));
writeFileSync(out, JSON.stringify({ note: "MOCK SOURCE: copied from golden_tests_v1.json", version: g.version, tests }, null, 0));
console.log(`wrote ${tests.length} tests to ${out}`);
