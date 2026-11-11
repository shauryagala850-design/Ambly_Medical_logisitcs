import type { SiteRules } from '@/config/sites/types';
import { addDays, addMonths, daysBetween } from '../time';

export interface Deadline {
  date: string;
  title: string;
  detail: string;
  /** Who has to act. */
  owner: 'us' | 'client';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthLabel = (firstOfMonth: string) => {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
const firstOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

/** Trial runs from the Commencement Date for N months; its last day is the day before the monthly anniversary. */
export function trialLastDay(rules: SiteRules): string | null {
  const start = rules.contract.commencementDate;
  return start ? addDays(addMonths(start, rules.contract.trialMonths), -1) : null;
}

/** Contract deadlines falling inside [today, today + horizonDays], soonest first. */
export function upcomingDeadlines(rules: SiteRules, today: string, horizonDays: number): Deadline[] {
  const out: Deadline[] = [];
  const c = rules.compliance;
  const thisMonth = firstOfMonth(today);

  for (let i = -1; i <= Math.ceil(horizonDays / 28) + 2; i++) {
    const month = addMonths(thisMonth, i);
    const label = monthLabel(month);
    out.push({
      date: addDays(month, -c.invoiceDaysBeforeMonthStart),
      title: `Raise invoice for ${label}`,
      detail: `Due ${c.invoiceDaysBeforeMonthStart} days before the month starts`,
      owner: 'us',
    });
    out.push({
      date: addDays(month, c.paymentDueDayOfMonth - 1),
      title: `Client payment due for ${label}`,
      detail: `Services may be paused after ${c.pauseServicesNoticeDays} days' written notice if unpaid`,
      owner: 'client',
    });
    const monthEnd = addDays(addMonths(month, 1), -1);
    out.push({
      date: addDays(monthEnd, c.wageProofDueDaysAfterMonthEnd),
      title: `Salary proof and PF challans for ${label}`,
      detail: `Due within ${c.wageProofDueDaysAfterMonthEnd} days of month-end, for all staff`,
      owner: 'us',
    });
  }

  const trialEnd = trialLastDay(rules);
  if (trialEnd) {
    out.push({
      date: addDays(trialEnd, -rules.contract.renewalNoticeDaysBeforeTrialEnd),
      title: 'Client renewal notice due',
      detail: `${rules.contract.renewalNoticeDaysBeforeTrialEnd} days before the trial ends; renewal runs ${rules.contract.renewalMonths} months`,
      owner: 'client',
    });
    out.push({ date: trialEnd, title: 'Trial period ends', detail: 'Last day of the trial', owner: 'client' });
  }

  return out
    .filter((d) => {
      const n = daysBetween(today, d.date);
      return n >= 0 && n <= horizonDays;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
