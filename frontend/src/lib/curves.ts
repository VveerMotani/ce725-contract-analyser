// Planned monthly progress shapes (share of work per month, sums to 1).
export function sCurve(T: number): number[] {
  // Smooth bell-shaped monthly shares (cumulative S-curve), sums to 1.
  const raw = Array.from({ length: T }, (_, i) => {
    const x = (i + 0.5) / T;
    return Math.sin(Math.PI * x) ** 1.4 + 0.08;
  });
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / s);
}

export function evenCurve(T: number): number[] {
  return Array.from({ length: T }, () => 1 / T);
}

