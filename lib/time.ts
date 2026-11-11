/**
 * Local-time helpers. All timestamps are epoch milliseconds (UTC); "date keys" are
 * local calendar dates as 'YYYY-MM-DD'. The site's fixed UTC offset is passed in.
 */

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function dateKey(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * MIN).toISOString().slice(0, 10);
}

/** Epoch ms of local midnight at the start of the given date key. */
export function startOfDay(key: string, offsetMin: number): number {
  return Date.parse(`${key}T00:00:00Z`) - offsetMin * MIN;
}

/** Epoch ms for a local date + 'HH:MM' time. */
export function at(key: string, hhmm: string, offsetMin: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  return startOfDay(key, offsetMin) + h * HOUR + m * MIN;
}

export function addDays(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY);
}

/** Day of week for a date key, 0 = Sunday. */
export function weekday(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** Date key of the first day of the week containing `key`. */
export function weekStart(key: string, weekStartsOn: number): string {
  const diff = (weekday(key) - weekStartsOn + 7) % 7;
  return addDays(key, -diff);
}

export function fmtTime(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * MIN).toISOString().slice(11, 16);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2027-07-11' -> '11 Jul 2027' */
export function fmtDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** '2027-07-11' -> 'Sun 11 Jul' */
export function fmtDay(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${DAYS[weekday(key)]} ${d} ${MONTHS[m - 1]}`;
}

export function fmtDateTime(ms: number, offsetMin: number): string {
  return `${fmtDate(dateKey(ms, offsetMin))}, ${fmtTime(ms, offsetMin)}`;
}
