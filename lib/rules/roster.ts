import type { SiteRules, StaffRole } from '@/config/sites/types';
import { HOUR, addDays, at, dateKey, startOfDay, weekStart } from '../time';

export interface ShiftForRules {
  id: string;
  staffId: string;
  role: StaffRole;
  /** Epoch ms. */
  start: number;
  end: number;
}

export type ViolationCode =
  | 'SHIFT_TOO_LONG'
  | 'DAILY_LIMIT'
  | 'WEEKLY_LIMIT'
  | 'OVERLAP'
  | 'COVERAGE_GAP';

export interface Violation {
  code: ViolationCode;
  role: StaffRole;
  message: string;
  staffId?: string;
  shiftIds?: string[];
  /** For per-day or per-week limits: the local date (or first day of the week) concerned. */
  day?: string;
  hours?: number;
  /** For coverage gaps: the uncovered period, epoch ms. */
  from?: number;
  to?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hours of each shift falling inside each local calendar day, per staff member. */
function hoursByDay(shifts: ShiftForRules[], offset: number): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of shifts) {
    let cursor = s.start;
    while (cursor < s.end) {
      const day = dateKey(cursor, offset);
      const dayEnd = startOfDay(addDays(day, 1), offset);
      const sliceEnd = Math.min(s.end, dayEnd);
      const perStaff = out.get(s.staffId) ?? new Map<string, number>();
      perStaff.set(day, (perStaff.get(day) ?? 0) + (sliceEnd - cursor) / HOUR);
      out.set(s.staffId, perStaff);
      cursor = sliceEnd;
    }
  }
  return out;
}

/** Periods inside [from, to) not covered by any of the given shifts. */
export function coverageGaps(
  shifts: Pick<ShiftForRules, 'start' | 'end'>[],
  from: number,
  to: number,
): { from: number; to: number }[] {
  const sorted = [...shifts].sort((a, b) => a.start - b.start);
  const gaps: { from: number; to: number }[] = [];
  let covered = from;
  for (const s of sorted) {
    if (s.end <= covered) continue;
    if (s.start >= to) break;
    if (s.start > covered) gaps.push({ from: covered, to: Math.min(s.start, to) });
    covered = Math.max(covered, s.end);
    if (covered >= to) break;
  }
  if (covered < to) gaps.push({ from: covered, to });
  return gaps;
}

/**
 * Checks a set of shifts against the site's contract rules.
 *
 * - SHIFT_TOO_LONG: a single shift longer than the role's maximum.
 * - DAILY_LIMIT:    a person's hours inside one local calendar day exceed the daily maximum.
 * - WEEKLY_LIMIT:   a person's hours inside one week (starting on rules.weekStartsOn) exceed the weekly maximum.
 * - OVERLAP:        the same person is on two shifts at once.
 * - COVERAGE_GAP:   inside [range.from, range.to) a role has nobody on shift when the contract needs cover.
 *
 * For the hour limits to be accurate, pass in every shift that touches the weeks being checked.
 */
export function validateRoster(
  shifts: ShiftForRules[],
  rules: SiteRules,
  range: { from: number; to: number },
): Violation[] {
  const offset = rules.utcOffsetMinutes;
  const violations: Violation[] = [];
  const roleOf = new Map(shifts.map((s) => [s.staffId, s.role]));

  for (const s of shifts) {
    const max = rules.deployment.roles[s.role].maxShiftHours;
    const hours = (s.end - s.start) / HOUR;
    if (hours > max) {
      violations.push({
        code: 'SHIFT_TOO_LONG',
        role: s.role,
        staffId: s.staffId,
        shiftIds: [s.id],
        day: dateKey(s.start, offset),
        hours: round2(hours),
        message: `Shift is ${round2(hours)} h; the limit is ${max} h`,
      });
    }
  }

  const byStaff = new Map<string, ShiftForRules[]>();
  for (const s of shifts) byStaff.set(s.staffId, [...(byStaff.get(s.staffId) ?? []), s]);
  for (const [staffId, list] of byStaff) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) {
        violations.push({
          code: 'OVERLAP',
          role: sorted[i].role,
          staffId,
          shiftIds: [sorted[i - 1].id, sorted[i].id],
          day: dateKey(sorted[i].start, offset),
          message: 'Two shifts for the same person overlap',
        });
      }
    }
  }

  for (const [staffId, days] of hoursByDay(shifts, offset)) {
    const role = roleOf.get(staffId)!;
    const limits = rules.deployment.roles[role];
    const weeks = new Map<string, number>();
    for (const [day, hours] of days) {
      if (hours > limits.maxHoursPerDay) {
        violations.push({
          code: 'DAILY_LIMIT',
          role,
          staffId,
          day,
          hours: round2(hours),
          message: `${round2(hours)} h on one day; the limit is ${limits.maxHoursPerDay} h`,
        });
      }
      const wk = weekStart(day, rules.weekStartsOn);
      weeks.set(wk, (weeks.get(wk) ?? 0) + hours);
    }
    for (const [wk, hours] of weeks) {
      if (hours > limits.maxHoursPerWeek) {
        violations.push({
          code: 'WEEKLY_LIMIT',
          role,
          staffId,
          day: wk,
          hours: round2(hours),
          message: `${round2(hours)} h in one week; the limit is ${limits.maxHoursPerWeek} h`,
        });
      }
    }
  }

  for (const role of Object.keys(rules.deployment.roles) as StaffRole[]) {
    const cfg = rules.deployment.roles[role];
    const roleShifts = shifts.filter((s) => s.role === role);
    const windows: { from: number; to: number }[] = [];
    if (cfg.coverage === '24x7') {
      windows.push(range);
    } else if (cfg.window) {
      const lastDay = dateKey(range.to - 1, offset);
      for (let day = dateKey(range.from, offset); day <= lastDay; day = addDays(day, 1)) {
        const from = Math.max(at(day, cfg.window.start, offset), range.from);
        const to = Math.min(at(day, cfg.window.end, offset), range.to);
        if (from < to) windows.push({ from, to });
      }
    }
    for (const w of windows) {
      for (const gap of coverageGaps(roleShifts, w.from, w.to)) {
        violations.push({
          code: 'COVERAGE_GAP',
          role,
          day: dateKey(gap.from, offset),
          from: gap.from,
          to: gap.to,
          hours: round2((gap.to - gap.from) / HOUR),
          message: `No ${role} on shift for ${round2((gap.to - gap.from) / HOUR)} h`,
        });
      }
    }
  }

  return violations;
}
