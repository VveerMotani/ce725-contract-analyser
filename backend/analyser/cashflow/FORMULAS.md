# M4 cash-flow engine: formulas, units, conventions

Code: `engine.py` (model), `reference.py` (reference view), `benchmark.py` (spec §8.4 workbook).
Spec: `Tender_Analyser_Build_Spec_v1.md` §8. Every number is computed in plain Python; the LLM never calculates.

## 1. Symbols and units

| Symbol | Field in `CashInputs` | Unit |
|---|---|---|
| V | `contract_value` | Rs |
| T | `duration_months` | months |
| p[m] | `progress` (None = even, 1/T) | share of V in month m, Σ p = 1 |
| c | `cost_share` | share of gross work |
| L_bill | (`cert_lag_days` + `pay_lag_days`) / 30 | months |
| L_sup | `supplier_credit_days` / 30 | months |
| MinBill | `min_bill_value` | Rs |
| r, Rmax | `retention_rate`, `retention_cap` (None = no cap) | share of bill, share of V |
| release steps (s_k, t_k) | `retention_release` | share of retention held, months after completion |
| A_k, month_k | `advance_instalments` | share of V, month cash arrives |
| ρ | `advance_recovery_rate` | share of each gross bill |
| δ | `advance_recovery_deadline` | share of T |
| i_a, i_od, i_late, g | `advance_interest_rate_pa`, `overdraft_rate_pa`, `late_interest_rate_pa`, `bg_commission_pa` | per year |
| D, grace | `delay_days`, `ld_grace_days` | calendar days |
| ℓ, Lmax | `ld_rate_per_day`, `ld_cap` (None = uncapped) | share of V per day, share of V |
| PS, PSval | `perf_security_pct`, `perf_security_validity_months_after_completion` | share of V, months |
| w_j, k_pv | `pv_weights`, `pv_factor` | shares, factor (e.g. 0.85) |
| λ | `index_lag_months` | months (index of month m − λ used for the bill of month m) |
| φ, L_part | `part_payment_share`, (`cert_lag_days` + `part_payment_days`) / 30 | share of each net bill, months |
| e_j | `index_rise_pa` | yearly rise of index j (scenario) |

## 2. Conventions (say these in the viva)

1. **1 month = 30 days**; 1 year = 365 days for late-payment interest; monthly interest = yearly rate / 12.
2. **Row m = the end of month m.** Row 0 is signing (advances can arrive there). Work done during month m is billed at the end of month m.
3. **Fractional months are split linearly** between the two neighbouring month-ends. An amount due at time t = k + f (k whole, 0 < f < 1) is put (1 − f) in month k and f in month k + 1. Example: 45 days after month 3 = 4.5 → half in month 4, half in month 5. Whole-month lags (30, 60 days) are not split.
4. **A balance at the end of month m is carried through month m + 1**, so interest-type costs are Σ over month-ends of balance × rate / 12.
5. **Delay** (D days) does *not* stretch the work programme. Work is still done and billed as planned in months 1..T. Delay only moves the completion certificate to Tc = T + D/30. That moves retention release, extends the performance security, and triggers delay damages. This is a deliberate simplification.
6. **Timeline is extended** past T until every cash event (lagged payments, retention release, damages, late advance instalments) has happened; trailing empty months are dropped. So all cash is captured (see §5 conservation).
7. **Shares are fractions** (0.05 = 5%). Money is in rupees inside the engine; the workbook uses Rs crore (1 crore = 10^7).

## 3. Monthly steps (spec §8.2)

**Step 1, gross work.** `B[m] = V × p[m]` for m = 1..T. Default p is even (1/T). `s_curve(T)` gives an S-shaped alternative: cumulative `S(x) = 3x² − 2x³` with x = m/T, and `p[m] = S(m/T) − S((m−1)/T)` (shares sum to exactly 1, slow start, peak at mid-point, slow finish). A user curve that does not add to 1 is scaled to 1 (noted).

**Billing with a minimum bill value.** Work accumulates until it reaches MinBill: `pending += B[m]`; if `pending ≥ MinBill` or m = T, then `Bill[m] = pending` and pending resets. The final bill (month T) is paid whatever its size. With MinBill = 0, `Bill[m] = B[m]`. Retention and recovery are taken from bills, not from work.

**Step 2, deductions.**
- Retention: `Ret[m] = min(r × Bill[m], Rmax × V − Σ_{k<m} Ret[k])` (no cap → `r × Bill[m]`). Cap month = first month in which Σ Ret reaches Rmax × V.
- Advance recovery: `Rec[m] = min(ρ × Bill[m], advance received to date − Σ_{k<m} Rec[k])`.
  Forced full recovery: from month `M_δ = max(1, floor(δ × T))` (the last whole month inside the deadline) and in the final bill (month T), Rec[m] = everything still outstanding, even if that exceeds the bill (net becomes negative: the contractor repays). An instalment arriving after T is recovered in the month it arrives.

**Step 3, net certified.** `Net[m] = Bill[m] − Ret[m] − Rec[m]`.

**Step 4, cash in.**
`In[m] = Net paid at (m + L_bill) + advance instalments arriving in m + retention released in m − damages deducted in m`.
- Part-payment rule (only when both `part_payment_share` and `part_payment_days` are given): `φ × Net[m]` is paid at `m + L_part` and `(1 − φ) × Net[m]` at `m + L_bill`. Example (CPWD style): 75% after 10 days, the rest after 28.
- Advance: `A_k × V` in month_k.
- Retention release: retention held at completion `R_tot = Σ Ret`; step k releases `s_k × R_tot` at `Tc + t_k`. If Σ s_k < 1 the rest is released at `Tc + dlp_months` (noted). Default (`CashInputs`) = 100% half a month after completion ("within 15 days").
- Damages (step 9) are deducted from sums due at completion, at time Tc.
- Late-payment interest is earned only if the contract gives it (`i_late > 0`) **and** the employer pays later than the contract says. In the "as written" view payment is on time, so it is 0. In the "Payment lag +30 days" sensitivity: `LateInt = Σ max(0, Net[m]) × i_late × 30 / 365`. Reported as `late_interest_income` (reduces total cost), not put in the monthly curve.

**Step 5, cash out.** `Out[m + L_sup] = c × B[m]` (split if fractional).

**Bills in the output.** `MonthRow.gross` = work done B[m]; `MonthRow.billed` = Bill[m] (they differ only when a minimum bill value applies).

**Step 6, position.** `CumIn[m] = Σ_{k≤m} In[k]`, `CumOut[m] = Σ_{k≤m} Out[k]`, `Gap[m] = CumOut[m] − CumIn[m]` (positive = the contractor is funding the work). **Peak funding** = `max(0, max_m Gap[m])`; **peak month** = first month with that maximum (0 if the gap is never positive).
Also tracked: `RetentionHeld[m] = Σ Ret − Σ released` and `AdvanceOutstanding[m] = Σ advances received − Σ Rec`. `receivable_max` = largest sum certified but not yet paid = max over m of (Σ Net − Σ Net paid). `retention_cap_month` = first month Σ Ret reaches Rmax × V; `advance_repaid_month` = first month Σ Rec reaches the total advance (None if not applicable).

**Step 7, interest.**
- Overdraft interest `= Σ_m max(0, Gap[m]) × i_od / 12`.
- Advance interest `= Σ_m AdvanceOutstanding[m] × i_a / 12` (0 for an interest-free advance). The higher rate for an encashed guarantee (`advance_interest_rate_encashed_pa`) is **not modelled**: it applies only if the employer encashes the guarantee, which needs a default scenario the model does not have; the advance is always recovered from bills. A note is added when the field is set.
- Retention financing cost `= Σ_m RetentionHeld[m] × i_od / 12`. This is the cost of the cash locked in retention. It is **already part of** the overdraft interest whenever the contractor is in overdraft, so it is shown on its own and **not** added to the total.

**Step 8, guarantee cost.**
- Performance security: `g × PS × V × (Tc + PSval) / 12` (held from signing to completion plus validity; delay extends it, flag R14).
- Advance bank guarantee [ASSUMPTION]: 110% of the advance still outstanding, reduced as the advance is recovered: `Σ_m 1.10 × AdvanceOutstanding[m] × g / 12`.
- Guarantee cost = the two added.

**Step 9, delay damages.** `LD = min(ℓ × max(0, D − grace), Lmax) × V` (no cap → no min). Days to cap `= grace + Lmax / ℓ` (None if uncapped or ℓ = 0).

**Step 10, escalation.** Index rise from the base date (month 0) to month m: `rise_j(m) = (1 + e_j)^(m/12) − 1` (the base date is taken as month 0).
- Contractor's cost rise: `CostRise = Σ_m c × B[m] × Σ_j w_j × rise_j(m)`. Weights: `pv_weights`; if none are given, equal weights over the indices in the scenario (1/n each) [ASSUMPTION].
- If price variation applies: recovery `PV = Σ_m k_pv × Bill[m] × Σ_j w_j × rise_j(max(0, m − λ))` (index lag λ: the contract pays on an older, lower index, so a lag reduces recovery while the cost rise is unchanged); `escalation_amount = PV`, `escalation_is_recovery = True`. Without weights the recovery is 0 (noted).
- If fixed price: `escalation_amount = CostRise` (exposure), `escalation_is_recovery = False`.
- Net escalation burden `escalation_net_burden` = `CostRise − PV` (PV = 0 if fixed price). This goes into the total. Escalation is **not** put into the monthly cash curve.

**Total cost of terms** `= overdraft interest + advance interest + guarantee cost + LD + net escalation burden − late-payment interest`.

## 4. Sensitivities (`CashResult.sensitivities`)

| Name | Change |
|---|---|
| Payment lag +30 days | employer pays 30 days later than the contract says (late interest earned only if the contract gives it) |
| Retention release +6 months | every release step 6 months later |
| Advance off | no instalments, no recovery |
| Delay 0 / 30 / 90 / 180 days | `delay_days` set to that value |

Each reports peak funding, peak month, interest cost (= overdraft + advance interest) and total cost of terms.

## 5. Checks that always hold (tested)

- Σ gross = V; Σ Rec = Σ advances; Σ Net = V − Σ Ret − Σ advances.
- Total cash in = V + advances − recoveries + retention released − LD = **V − LD**; total cash out = c × V; final gap = c × V − V + LD; retention held and advance outstanding end at 0.

## 6. Reference view (`reference_view`, spec §8.2 step 11, §7, Appendix A)

Only terms **worse** for the contractor are changed; better terms are kept. `reference_changes(inputs)` lists what was changed and why.

| Term | Reference value | Source |
|---|---|---|
| Retention | 5% of each bill, cap 5% of V, 100% released at completion | Manual for Procurement of Works 2022 (R1) [SEEN]; release at completion per brief |
| Payment | 30 days in total (cert lag 0 + pay lag 30) | NHAI 30 days [SEEN]; the 30-day line is [ASSUMPTION] (R7) |
| Delay damages | 0.05% of V per day, cap 10% | NHAI [SEEN], Manual 10% cap [SEEN] (R4) |
| Performance security | 5% of V | Manual 2022 "usually 5%" [SEEN]. Chosen over the 3% of the DoE OM of 12 Nov 2020 so the reference view matches flag R3 ("above 5%"). Change `REFERENCE["perf_security_pct"]` to 0.03 to use 3%. |
| Price variation | switched on (factor 0.85) if T > 18 months | Manual: no PV up to 18 months [SEEN] (R10); 0.85 from CPWD 10CC [SEEN]. If no weights are known, equal weights over the scenario indices. |

`diff_views(a, b)` lists each item (peak funding, peak month, interest, guarantee, retention, LD, escalation, total) with `as_written`, `reference` and `difference = as_written − reference` (positive on a cost item = the contract as written costs that much more).

## 7. Spec §8.4 benchmark

`benchmark_inputs()`: V = Rs 100 crore, T = 24, even, retention 6% cap 5%, advance 5% + 5% (months 0 and 2 [ASSUMPTION]), recovery 15%, deadline 80%, damages 0.05%/day cap 10%, D = 60 days; payment 30 days, retention released 1 month after completion, c = 0.85, i_od = 10% [ASSUMPTIONS that keep months whole].
`python -m analyser.cashflow.benchmark` (from `backend/`) writes `benchmark_8_4.xlsx` with live Excel formulas, the spec table typed in, the Python values beside them and a month-by-month comparison of the gap. **A person must check the workbook by hand (course requirement) and sign the 'Read me' sheet.**

## 8. Limitations

- Delay does not stretch the work curve or add prolongation costs; it only moves completion, guarantees and retention release and adds damages.
- No credit for surplus cash (no deposit interest when the gap is negative), so retention or slow payment costs nothing while an advance keeps the contractor in surplus.
- One bill per month at most; the part-payment rule has one split only; working days are treated as calendar days unless the caller converts them.
- Escalation uses no base-date offset and the same weights for cost and recovery; the cost-side rise is not in the monthly curve.
- Milestone withholding (e.g. 1.25% per missed milestone), bonus for early completion and the higher interest rate on encashed advances are not modelled.
- Guarantee commission is flat per year on the face value; no minimum charges or margin money.
