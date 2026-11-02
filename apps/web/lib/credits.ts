export type CreditAccountRow = {
  monthly_seconds: number | string | null;
  topup_seconds: number | string | null;
  reserved_seconds: number | string | null;
} | null;

export function creditAvailableFromAccount(acct: CreditAccountRow): number {
  if (!acct) return 0;
  const monthly = Number(acct.monthly_seconds ?? 0);
  const topup = Number(acct.topup_seconds ?? 0);
  const reserved = Number(acct.reserved_seconds ?? 0);
  return Math.max(0, monthly + topup - reserved);
}
