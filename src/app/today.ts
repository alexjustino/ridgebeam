import { useNow } from '@/ui/useNow';

/**
 * Today, as the one calendar day the whole interface agrees on.
 *
 * The domain never reads the clock (ADR-017): a decision's status, readiness's `decision.timely`
 * rule and the decisions-due figure all take `today` as an input. It is computed here and only
 * here — the local calendar day of this machine, `YYYY-MM-DD` — so two screens can never disagree
 * about what day it is, and a test can pass any day it likes.
 */
export function today(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today, kept current: re-read every minute, so a window left open past midnight moves to the new
 * day on its own and every status that depends on it follows.
 */
export function useToday(): string {
  return today(new Date(useNow(60_000)));
}
