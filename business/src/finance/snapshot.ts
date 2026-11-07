import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Store } from "../store.js";

const run = promisify(execFile);

/**
 * The Finance agent's numbers: spend against revenue, per source. Every figure carries where it came
 * from, and a source we couldn't read is reported as missing, never as zero.
 */
export interface SpendSource {
  name: "naive" | "monid" | "mobilerun";
  /** Spend so far in USD, or null when we couldn't read it. */
  spentUsd: number | null;
  /** Remaining balance in USD, or null when not known. */
  balanceUsd: number | null;
  note: string;
}

export interface FinanceSnapshot {
  at: string;
  revenueUsd: number;
  testModeRevenueUsd: number;
  payments: number;
  spend: SpendSource[];
  /** Known spend only. Missing sources are listed in `missing`. */
  totalKnownSpendUsd: number;
  missing: string[];
  /** Revenue minus known spend, real (live-mode) money only. */
  marginUsd: number;
  costPerAcceptedLevelUsd: number | null;
}

/** Reads `monid balance -j`. Monid's starting credit is passed in, since the CLI reports balance only. */
export async function readMonid(startingUsd: number, bin = "monid"): Promise<SpendSource> {
  try {
    const { stdout } = await run(bin, ["balance", "-j"], { env: { ...process.env, NO_COLOR: "1" } });
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const raw = parsed.balance ?? parsed.amount ?? (parsed.wallet as Record<string, unknown> | undefined)?.balance;
    const balance = typeof raw === "number" ? raw : typeof raw === "object" && raw ? Number((raw as { value?: unknown }).value) : Number(raw);
    if (!Number.isFinite(balance)) return { name: "monid", spentUsd: null, balanceUsd: null, note: "couldn't parse monid balance" };
    return { name: "monid", spentUsd: Number((startingUsd - balance).toFixed(4)), balanceUsd: balance, note: "monid balance" };
  } catch (err) {
    return { name: "monid", spentUsd: null, balanceUsd: null, note: `monid balance failed: ${String(err).slice(0, 120)}` };
  }
}

export function summarize(args: {
  store: Awaited<ReturnType<Store["listPayments"]>>;
  spend: SpendSource[];
  acceptedLevels: number | null;
  at?: string;
}): FinanceSnapshot {
  const live = args.store.filter((p) => p.livemode);
  const test = args.store.filter((p) => !p.livemode);
  const toUsd = (minor: number): number => minor / 100;
  const revenueUsd = live.reduce((s, p) => s + toUsd(p.amountMinor), 0);
  const testModeRevenueUsd = test.reduce((s, p) => s + toUsd(p.amountMinor), 0);
  const known = args.spend.filter((s) => s.spentUsd !== null);
  const totalKnownSpendUsd = Number(known.reduce((s, x) => s + (x.spentUsd ?? 0), 0).toFixed(4));
  return {
    at: args.at ?? new Date().toISOString(),
    revenueUsd,
    testModeRevenueUsd,
    payments: args.store.length,
    spend: args.spend,
    totalKnownSpendUsd,
    missing: args.spend.filter((s) => s.spentUsd === null).map((s) => s.name),
    marginUsd: Number((revenueUsd - totalKnownSpendUsd).toFixed(4)),
    costPerAcceptedLevelUsd:
      args.acceptedLevels && args.acceptedLevels > 0 ? Number((totalKnownSpendUsd / args.acceptedLevels).toFixed(4)) : null,
  };
}
