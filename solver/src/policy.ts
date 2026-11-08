// One acceptance policy for the program Tuner, compiler and MCP boundary.
export const MIN_VERIFICATION_RUNS = 200;
export const TOLERANCE = 0.05;
export const CI_TOLERANCE = 0.08;
export const REFERENCE_BOTS = ["human", "search", "greedy"] as const;
export const referenceBot = (a: { bots: string[] }): string => REFERENCE_BOTS.find(b => a.bots.includes(b)) ?? a.bots[0]!;
export function onTarget(r: { win_rate: number; ci95_low: number; ci95_high: number }, target: number): boolean {
  const difference = Math.abs(r.win_rate - target);
  return difference <= TOLERANCE + 1e-9 ||
    (difference <= CI_TOLERANCE + 1e-9 && r.ci95_low <= target && target <= r.ci95_high);
}
