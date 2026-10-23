// MOCK ONLY. A small TypeScript version of spec §8.2 so the cash page reacts to
// sliders while the real Python engine (backend/analyser/cashflow) is not running.
// The real numbers always come from POST /api/runs/{id}/cashflow.
import type { CashInputs, CashResult, MonthRow, Sensitivity } from "../types";

export { sCurve, evenCurve } from "../lib/curves";
import { evenCurve } from "../lib/curves";

function core(inp: CashInputs) {
  const V = inp.contract_value;
  const T = Math.max(1, Math.round(inp.duration_months));
  const p = inp.progress && inp.progress.length === T ? inp.progress : evenCurve(T);
  const payLag = Math.round((inp.cert_lag_days + inp.pay_lag_days) / 30);
  const supLag = Math.round(inp.supplier_credit_days / 30);
  const releaseMax = Math.max(0, ...inp.retention_release.map((r) => Math.ceil(r.months_after_completion)));
  const N = T + payLag + releaseMax + 1;

  const capRet = inp.retention_cap == null ? Infinity : inp.retention_cap * V;
  const advTotal = inp.advance_instalments.reduce((a, b) => a + b.share_of_value * V, 0);
  const deadlineMonth = inp.advance_recovery_deadline == null ? T : Math.floor(inp.advance_recovery_deadline * T);

  const gross: number[] = Array(N + 1).fill(0);
  const ret: number[] = Array(N + 1).fill(0);
  const rec: number[] = Array(N + 1).fill(0);
  const netC: number[] = Array(N + 1).fill(0);
  const cin: number[] = Array(N + 1).fill(0);
  const cout: number[] = Array(N + 1).fill(0);
  const advOut: number[] = Array(N + 1).fill(0);
  const retHeld: number[] = Array(N + 1).fill(0);

  let retCum = 0;
  let advPaid = 0;
  let advRecovered = 0;
  let pendingBill = 0;
  for (let m = 1; m <= N; m++) {
    if (m <= T) {
      const B = V * p[m - 1];
      gross[m] = B;
      const r = Math.min(inp.retention_rate * B, Math.max(0, capRet - retCum));
      retCum += r;
      ret[m] = r;
      for (const a of inp.advance_instalments) if (Math.max(1, a.month) === m) advPaid += a.share_of_value * V;
      let rc = Math.min(inp.advance_recovery_rate * B, Math.max(0, advPaid - advRecovered));
      if (m === deadlineMonth) rc = Math.max(rc, advPaid - advRecovered);
      advRecovered += rc;
      rec[m] = rc;
      netC[m] = B - r - rc;
      // minimum bill: certification waits until accumulated net reaches the minimum
      pendingBill += netC[m];
      if (pendingBill >= inp.min_bill_value || m === T) {
        if (m + payLag <= N) cin[m + payLag] += pendingBill;
        pendingBill = 0;
      }
      if (m + supLag <= N) cout[m + supLag] += inp.cost_share * B;
    }
    for (const a of inp.advance_instalments) if (Math.max(1, a.month) === m) cin[m] += a.share_of_value * V;
    advOut[m] = advPaid - advRecovered;
    retHeld[m] = retCum;
  }
  for (const r of inp.retention_release) {
    const m = Math.min(N, T + Math.max(1, Math.ceil(r.months_after_completion)));
    cin[m] += r.share * retCum;
    for (let k = m; k <= N; k++) retHeld[k] -= r.share * retCum;
  }

  const months: MonthRow[] = [];
  let ci = 0;
  let co = 0;
  for (let m = 1; m <= N; m++) {
    ci += cin[m];
    co += cout[m];
    months.push({
      month: m,
      gross: gross[m],
      retention: ret[m],
      advance_recovery: rec[m],
      net_certified: netC[m],
      cash_in: cin[m],
      cash_out: cout[m],
      cum_in: ci,
      cum_out: co,
      gap: co - ci,
      retention_held: Math.max(0, retHeld[m]),
      billed: netC[m],
      advance_outstanding: advOut[m],
    });
  }
  return { months, V, T, advTotal, retCum };
}

export function runCash(inp: CashInputs, withSens = true): CashResult {
  const { months, V, T, advTotal, retCum } = core(inp);
  let peak = 0;
  let peakMonth = 0;
  for (const r of months) if (r.gap > peak) { peak = r.gap; peakMonth = r.month; }
  const od = months.reduce((a, r) => a + Math.max(0, r.gap) * inp.overdraft_rate_pa / 12, 0);
  const advInt = months.reduce((a, r) => a + r.advance_outstanding * inp.advance_interest_rate_pa / 12, 0);
  const advMonths = months.filter((r) => r.advance_outstanding > 1).length;
  const psYears = (T + inp.dlp_months + inp.perf_security_validity_months_after_completion) / 12;
  const gCost = inp.bg_commission_pa * (inp.perf_security_pct * V * psYears + 1.1 * advTotal * (advMonths / 12) * 0.6);
  const retFin = months.reduce((a, r) => a + r.retention_held * inp.overdraft_rate_pa / 12, 0);
  const ldDays = Math.max(0, inp.delay_days - inp.ld_grace_days);
  const ldShare = inp.ld_rate_per_day * ldDays;
  const ld = Math.min(ldShare, inp.ld_cap ?? Infinity) * V;
  const daysToCap = inp.ld_cap != null && inp.ld_rate_per_day > 0 ? inp.ld_cap / inp.ld_rate_per_day : null;
  const rises = Object.values(inp.index_rise_pa);
  const avgRise = rises.length ? rises.reduce((a, b) => a + b, 0) / rises.length : 0;
  let esc = 0;
  months.forEach((r) => {
    if (!r.gross) return;
    const t = r.month / 12;
    if (inp.pv_applies) {
      const w = Object.entries(inp.pv_weights).reduce((a, [k, wt]) => a + wt * (inp.index_rise_pa[k] ?? avgRise) * t, 0);
      esc += inp.pv_factor * r.gross * w;
    } else {
      esc += inp.cost_share * 0.45 * r.gross * avgRise * t;
    }
  });
  const total = od + advInt + gCost + ld + (inp.pv_applies ? 0 : esc);
  const notes: string[] = [];
  if (retCum > 0 && inp.retention_cap != null) notes.push(`Retention stops when it reaches the cap of ${(inp.retention_cap * 100).toFixed(1)}% of value.`);
  if (!inp.pv_applies) notes.push("Fixed price: escalation shown as exposure, not recovery.");
  if (inp.late_interest_rate_pa === 0) notes.push("No interest on late payment: delays are funded by the contractor.");

  let sens: Sensitivity[] = [];
  if (withSens) {
    const mk = (name: string, o: Partial<CashInputs>): Sensitivity => {
      const r = runCash({ ...inp, ...o }, false);
      return { name, peak_funding: r.peak_funding, peak_month: r.peak_month, interest_cost: r.overdraft_interest, total_cost_of_terms: r.total_cost_of_terms };
    };
    sens = [
      mk("Payment lag +30 days", { pay_lag_days: inp.pay_lag_days + 30 }),
      mk("Retention release +6 months", { retention_release: inp.retention_release.map((r) => ({ ...r, months_after_completion: r.months_after_completion + 6 })) }),
      mk("Advance off", { advance_instalments: [], advance_recovery_rate: 0 }),
      mk("Delay 0 days", { delay_days: 0 }),
      mk("Delay 30 days", { delay_days: 30 }),
      mk("Delay 90 days", { delay_days: 90 }),
      mk("Delay 180 days", { delay_days: 180 }),
    ];
  }
  const capRow = inp.retention_cap != null ? months.find((r) => r.month <= T && r.retention_held >= inp.retention_cap! * V - 1) : undefined;
  const advRow = advTotal > 0 ? months.find((r) => r.month > 1 && r.advance_outstanding <= 1 && months.slice(0, r.month - 1).some((x) => x.advance_outstanding > 1)) : undefined;
  let recv = 0;
  let cumNet = 0;
  for (const r of months) { cumNet += r.net_certified; recv = Math.max(recv, cumNet + advTotal - r.cum_in); }
  return {
    months,
    peak_funding: peak,
    peak_month: peakMonth,
    overdraft_interest: od,
    advance_interest: advInt,
    guarantee_cost: gCost,
    retention_locked_max: retCum,
    retention_financing_cost: retFin,
    ld_amount: ld,
    ld_days_to_cap: daysToCap,
    escalation_amount: esc,
    escalation_is_recovery: inp.pv_applies,
    total_cost_of_terms: total,
    sensitivities: sens,
    notes,
    retention_cap_month: capRow?.month ?? null,
    advance_repaid_month: advRow?.month ?? null,
    receivable_max: Math.max(0, recv),
    late_interest_income: 0,
    escalation_net_burden: inp.pv_applies ? Math.max(0, esc * 0.15) : esc,
  };
}

/** Same project with risky terms set to reference values (spec §8.2 step 11). Mock version. */
export function referenceView(inp: CashInputs): CashInputs {
  return {
    ...inp,
    pay_lag_days: Math.min(inp.pay_lag_days, 30),
    retention_rate: Math.min(inp.retention_rate, 0.05),
    retention_cap: inp.retention_cap == null ? 0.05 : Math.min(inp.retention_cap, 0.05),
    ld_rate_per_day: Math.min(inp.ld_rate_per_day, 0.0005),
    ld_cap: inp.ld_cap == null ? 0.1 : Math.min(inp.ld_cap, 0.1),
    perf_security_pct: Math.min(inp.perf_security_pct, 0.03),
    advance_interest_rate_pa: 0,
  };
}
