export interface CanonicalTier {
  amount: number;
  bonusPercent: number;
  label: string;
  tag: string;
}

export const WITHDRAWAL_TIERS: CanonicalTier[] = [
  { amount: 5, bonusPercent: 0, label: "$5.00", tag: "Minimum" },
  { amount: 7, bonusPercent: 0, label: "$7.00", tag: "Standard" },
];

export const DAILY_WITHDRAWAL_MAX = 7;

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
