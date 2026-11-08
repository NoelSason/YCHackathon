// Small, dependency-free statistics for bot results.

/**
 * 95% Wilson score interval for a win rate (wins out of runs).
 * Better than the normal approximation near 0% and 100%, which is where badly tuned levels sit.
 */
export function wilson95(wins: number, runs: number): { low: number; high: number } {
  if (runs <= 0) return { low: 0, high: 1 };
  const z = 1.959963984540054;
  const p = wins / runs;
  const z2 = z * z;
  const denom = 1 + z2 / runs;
  const center = (p + z2 / (2 * runs)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / runs + z2 / (4 * runs * runs))) / denom;
  // At 0 or all wins the exact bound is 0 or 1; set it directly so float error can't leak in.
  return {
    low: wins <= 0 ? 0 : Math.max(0, center - half),
    high: wins >= runs ? 1 : Math.min(1, center + half),
  };
}

/** Round to 4 decimal places so stored results stay readable. */
export function r4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
