export interface CanonicalTier {
  amount: number;
  bonusPercent: number;
  label: string;
  tag: string;
}

export const WITHDRAWAL_TIERS: CanonicalTier[] = [
  { amount: 3, bonusPercent: 0, label: "$3.00", tag: "Minimum" },
  { amount: 5, bonusPercent: 0, label: "$5.00", tag: "Popular" },
  { amount: 7, bonusPercent: 0, label: "$7.00", tag: "Best Value" },
];

export const DAILY_WITHDRAWAL_MAX = 7;

function readNonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// New accounts must age this many hours before their first withdrawal is
// allowed. Owner-set default is 48h; override with NEW_ACCOUNT_HOLD_HOURS.
export const NEW_ACCOUNT_HOLD_HOURS = readNonNegativeNumberEnv("NEW_ACCOUNT_HOLD_HOURS", 48);

// Maximum number of withdrawal requests a single user can make per UTC day.
export const MAX_WITHDRAWALS_PER_DAY = Math.max(
  1,
  Math.floor(readNonNegativeNumberEnv("MAX_WITHDRAWALS_PER_DAY", 2)),
);

// Float discipline: the most the app will pay out to ALL users combined in a
// single UTC day. This is paced against the revenue float held in the corporate
// account so total daily outflow never exceeds what has been earned. Owner-set
// starting value is $60/day; override with DAILY_PAYOUT_FLOAT_USD. Read via a
// function so a redeploy with a new env value takes effect on restart.
export function getDailyPayoutFloatUsd(): number {
  return readNonNegativeNumberEnv("DAILY_PAYOUT_FLOAT_USD", 60);
}

export interface ResolvedTier {
  amount: number;
  bonusPercent: number;
  bonusAmount: number;
  totalPayout: number;
  label: string;
  tag: string;
}

export function resolveTierForAmount(amount: number): ResolvedTier | null {
  const tier = WITHDRAWAL_TIERS.find((t) => Math.abs(t.amount - amount) < 0.005);
  if (!tier) return null;
  const bonusAmount = parseFloat(((tier.amount * tier.bonusPercent) / 100).toFixed(2));
  const totalPayout = parseFloat((tier.amount + bonusAmount).toFixed(2));
  return {
    amount: tier.amount,
    bonusPercent: tier.bonusPercent,
    bonusAmount,
    totalPayout,
    label: tier.label,
    tag: tier.tag,
  };
}

export function getAvailableTiers(balance: number): ResolvedTier[] {
  return WITHDRAWAL_TIERS.filter((t) => t.amount <= balance + 1e-9).map((t) => {
    const bonusAmount = parseFloat(((t.amount * t.bonusPercent) / 100).toFixed(2));
    return {
      amount: t.amount,
      bonusPercent: t.bonusPercent,
      bonusAmount,
      totalPayout: parseFloat((t.amount + bonusAmount).toFixed(2)),
      label: t.label,
      tag: t.tag,
    };
  });
}

export const MIN_WITHDRAWAL = WITHDRAWAL_TIERS[0].amount;
