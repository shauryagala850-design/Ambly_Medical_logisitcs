import { daysBetween } from '../time';

export type ExpiryState = 'no_expiry' | 'ok' | 'due' | 'expired';

export interface ExpiryStatus {
  state: ExpiryState;
  /** Days until expiry (negative once expired). null when the document has no expiry date. */
  daysLeft: number | null;
  /** The alert threshold reached (e.g. 60, 30 or 7) when state is 'due'. */
  threshold: number | null;
}

/**
 * A document is valid up to and including its expiry date, and expired from the next day.
 * 'due' means it is inside one of the alert thresholds (e.g. 60/30/7 days).
 */
export function expiryStatus(expiresOn: string | null, today: string, alertDays: number[]): ExpiryStatus {
  if (!expiresOn) return { state: 'no_expiry', daysLeft: null, threshold: null };
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0) return { state: 'expired', daysLeft, threshold: null };
  const reached = alertDays.filter((d) => daysLeft <= d).sort((a, b) => a - b)[0];
  if (reached === undefined) return { state: 'ok', daysLeft, threshold: null };
  return { state: 'due', daysLeft, threshold: reached };
}

/** Colour band for the UI: red for expired or inside the tightest threshold, amber for other thresholds. */
export function expiryTone(s: ExpiryStatus, alertDays: number[]): 'red' | 'amber' | 'green' | 'none' {
  if (s.state === 'no_expiry') return 'none';
  if (s.state === 'expired') return 'red';
  if (s.state === 'ok') return 'green';
  return s.threshold === Math.min(...alertDays) ? 'red' : 'amber';
}
