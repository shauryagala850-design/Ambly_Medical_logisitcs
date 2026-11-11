import { describe, expect, it } from 'vitest';
import { marathonFuturex as rules } from '@/config/sites/marathon-futurex';
import { DAY, HOUR, addDays, addMonths, at, weekStart } from '@/lib/time';
import { expiryStatus, expiryTone } from '@/lib/rules/expiry';
import { assignmentBlocks, effectiveApproval, type DocForRules, type StaffForRules } from '@/lib/rules/eligibility';
import { coverageGaps, validateRoster, type ShiftForRules } from '@/lib/rules/roster';
import { trialLastDay, upcomingDeadlines } from '@/lib/rules/deadlines';

const off = rules.utcOffsetMinutes;
const MON = '2026-11-09'; // a Monday
const t = (dayOffset: number, hhmm: string) => at(addDays(MON, dayOffset), hhmm, off);

let n = 0;
const shift = (staffId: string, role: 'driver' | 'doctor', start: number, end: number): ShiftForRules => ({
  id: `s${++n}`,
  staffId,
  role,
  start,
  end,
});

/** A fully compliant week: 3 main drivers on 6 shifts each, a relief covering weekly offs, doctors 10-18. */
function compliantWeek(): ShiftForRules[] {
  const out: ShiftForRules[] = [];
  for (let d = 0; d < 7; d++) {
    out.push(shift(d === 6 ? 'relief' : 'A', 'driver', t(d, '06:00'), t(d, '14:00')));
    out.push(shift(d === 0 ? 'relief' : 'B', 'driver', t(d, '14:00'), t(d, '22:00')));
    out.push(shift(d === 1 ? 'relief' : 'C', 'driver', t(d, '22:00'), t(d + 1, '06:00')));
    out.push(shift(d === 6 ? 'doc-relief' : 'doc', 'doctor', t(d, '10:00'), t(d, '18:00')));
  }
  // The night shift running into Monday 06:00 from the previous Sunday.
  out.push(shift('C', 'driver', t(-1, '22:00'), t(0, '06:00')));
  return out;
}
const week = { from: t(0, '00:00'), to: t(7, '00:00') };
const codes = (shifts: ShiftForRules[]) => validateRoster(shifts, rules, week).map((v) => v.code);

describe('time helpers', () => {
  it('converts local time to UTC using the site offset', () => {
    expect(new Date(at('2026-11-09', '06:00', 330)).toISOString()).toBe('2026-11-09T00:30:00.000Z');
  });
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-11-15', 1)).toBe('2026-11-09');
    expect(weekStart('2026-11-09', 1)).toBe('2026-11-09');
  });
  it('clamps month arithmetic to the end of the month', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('document expiry', () => {
  const alerts = rules.documents.expiryAlertDays;
  it('is ok when further away than every threshold', () => {
    expect(expiryStatus('2027-07-11', '2026-11-11', alerts).state).toBe('ok');
  });
  it('reports the tightest threshold reached', () => {
    expect(expiryStatus(addDays(MON, 60), MON, alerts)).toMatchObject({ state: 'due', threshold: 60 });
    expect(expiryStatus(addDays(MON, 61), MON, alerts).state).toBe('ok');
    expect(expiryStatus(addDays(MON, 30), MON, alerts)).toMatchObject({ state: 'due', threshold: 30 });
    expect(expiryStatus(addDays(MON, 7), MON, alerts)).toMatchObject({ state: 'due', threshold: 7 });
  });
  it('is still valid on the expiry date and expired the day after', () => {
    expect(expiryStatus(MON, MON, alerts)).toMatchObject({ state: 'due', daysLeft: 0 });
    expect(expiryStatus(MON, addDays(MON, 1), alerts)).toMatchObject({ state: 'expired', daysLeft: -1 });
  });
  it('handles documents with no expiry', () => {
    expect(expiryStatus(null, MON, alerts).state).toBe('no_expiry');
  });
  it('maps to red, amber and green', () => {
    expect(expiryTone(expiryStatus(addDays(MON, -1), MON, alerts), alerts)).toBe('red');
    expect(expiryTone(expiryStatus(addDays(MON, 5), MON, alerts), alerts)).toBe('red');
    expect(expiryTone(expiryStatus(addDays(MON, 20), MON, alerts), alerts)).toBe('amber');
    expect(expiryTone(expiryStatus(addDays(MON, 45), MON, alerts), alerts)).toBe('amber');
    expect(expiryTone(expiryStatus(addDays(MON, 200), MON, alerts), alerts)).toBe('green');
  });
});

describe('client approval', () => {
  const sent = t(0, '12:00');
  it('is pending until 3 days after documents were sent, then deemed approved', () => {
    const s = { approvalStatus: 'submitted' as const, docsSentAt: sent };
    expect(effectiveApproval(s, sent + 3 * DAY - 1, rules).status).toBe('pending');
    expect(effectiveApproval(s, sent + 3 * DAY, rules).status).toBe('deemed_approved');
  });
  it('is never deemed approved after a client objection', () => {
    const s = { approvalStatus: 'objected' as const, docsSentAt: sent };
    expect(effectiveApproval(s, sent + 30 * DAY, rules).status).toBe('objected');
  });
  it('respects explicit approval and unsent documents', () => {
    expect(effectiveApproval({ approvalStatus: 'approved', docsSentAt: sent }, sent, rules).status).toBe('approved');
    expect(effectiveApproval({ approvalStatus: 'not_submitted', docsSentAt: null }, sent, rules).status).toBe(
      'not_submitted',
    );
  });
});

describe('assignment blocking', () => {
  const driver: StaffForRules = { id: 'd', role: 'driver', active: true, approvalStatus: 'approved', docsSentAt: null };
  const fullDocs = (over: Record<string, string | null> = {}): DocForRules[] =>
    rules.documents.requiredStaffDocs.driver.map((docType) => ({
      docType,
      expiresOn: docType in over ? over[docType] : docType === 'driving_licence' ? '2030-01-01' : null,
    }));
  const start = t(0, '22:00');
  const end = t(1, '06:00');

  it('allows an approved driver with a full, valid document set', () => {
    expect(assignmentBlocks(driver, fullDocs(), start, end, rules)).toEqual([]);
  });
  it('blocks when a required document is missing', () => {
    const docs = fullDocs().filter((d) => d.docType !== 'bls_certificate');
    expect(assignmentBlocks(driver, docs, start, end, rules)).toEqual(['Missing: BLS certificate']);
  });
  it('blocks when a document expires before the shift ends', () => {
    // Licence valid on the day the night shift starts but lapsed by the morning it ends.
    const docs = fullDocs({ driving_licence: addDays(MON, 0) });
    expect(assignmentBlocks(driver, docs, start, end, rules)).toEqual(['Expired: Driving licence']);
    expect(assignmentBlocks(driver, fullDocs({ driving_licence: addDays(MON, 1) }), start, end, rules)).toEqual([]);
  });
  it('accepts a renewed document alongside the expired one', () => {
    const docs = [...fullDocs({ driving_licence: '2020-01-01' }), { docType: 'driving_licence', expiresOn: '2031-01-01' }];
    expect(assignmentBlocks(driver, docs, start, end, rules)).toEqual([]);
  });
  it('blocks anyone not yet approved at the time of assignment, even for a later shift', () => {
    // Documents sent 2 days before assignment: still pending, although the shift is a week away.
    const pending = { ...driver, approvalStatus: 'submitted' as const, docsSentAt: start - 2 * DAY };
    expect(assignmentBlocks(pending, fullDocs(), start, end + 7 * DAY, rules)).toEqual(['Client approval still pending']);
    const deemed = { ...pending, docsSentAt: start - 3 * DAY };
    expect(assignmentBlocks(deemed, fullDocs(), start, end, rules)).toEqual([]);
    expect(assignmentBlocks({ ...driver, approvalStatus: 'objected' }, fullDocs(), start, end, rules)).toHaveLength(1);
    expect(assignmentBlocks({ ...driver, approvalStatus: 'not_submitted' }, fullDocs(), start, end, rules)).toHaveLength(1);
  });
  it('blocks inactive staff', () => {
    expect(assignmentBlocks({ ...driver, active: false }, fullDocs(), start, end, rules)).toEqual(['Marked inactive']);
  });
  it('requires MMC/NMC registration, not a BLS certificate, for doctors', () => {
    const doctor: StaffForRules = { ...driver, role: 'doctor' };
    const docs = rules.documents.requiredStaffDocs.doctor
      .filter((x) => x !== 'medical_registration')
      .map((docType) => ({ docType, expiresOn: null }));
    expect(assignmentBlocks(doctor, docs, start, end, rules)).toEqual(['Missing: MMC/NMC registration']);
  });
});

describe('roster: shift-hour limits', () => {
  it('passes a compliant week with no violations', () => {
    expect(validateRoster(compliantWeek(), rules, week)).toEqual([]);
  });
  it('allows exactly 8 hours and flags anything longer', () => {
    expect(codes([...compliantWeek(), shift('X', 'driver', t(0, '06:00'), t(0, '14:00'))])).toEqual([]);
    const v = validateRoster([...compliantWeek(), shift('X', 'driver', t(0, '06:00'), t(0, '14:30'))], rules, week);
    expect(v.filter((x) => x.code === 'SHIFT_TOO_LONG')).toMatchObject([{ staffId: 'X', hours: 8.5 }]);
  });
  it('flags more than 8 hours on one calendar day across two shifts', () => {
    const v = validateRoster(
      [...compliantWeek(), shift('X', 'driver', t(2, '00:00'), t(2, '06:00')), shift('X', 'driver', t(2, '14:00'), t(2, '22:00'))],
      rules,
      week,
    );
    expect(v).toMatchObject([{ code: 'DAILY_LIMIT', staffId: 'X', day: addDays(MON, 2), hours: 14 }]);
  });
  it('splits a night shift across the two days it touches', () => {
    // 22:00-06:00 every night is 6 h + 2 h per calendar day: within the daily limit.
    const nights = [0, 1, 2].map((d) => shift('N', 'driver', t(d, '22:00'), t(d + 1, '06:00')));
    expect(validateRoster(nights, rules, week).filter((v) => v.code === 'DAILY_LIMIT')).toEqual([]);
  });
  it('allows exactly 48 hours in a week and flags a 7th shift', () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => shift('X', 'driver', t(d, '06:00'), t(d, '14:00')));
    expect(validateRoster(six, rules, week).filter((v) => v.code === 'WEEKLY_LIMIT')).toEqual([]);
    const seven = [...six, shift('X', 'driver', t(6, '06:00'), t(6, '14:00'))];
    expect(validateRoster(seven, rules, week).filter((v) => v.code === 'WEEKLY_LIMIT')).toMatchObject([
      { staffId: 'X', day: MON, hours: 56 },
    ]);
  });
  it('counts weekly hours per Monday-to-Sunday week, splitting a shift that crosses the boundary', () => {
    // Six day shifts Mon-Sat (48 h) plus a Sunday 22:00 night shift: only 2 h fall in this week -> 50 h.
    const shifts = [0, 1, 2, 3, 4, 5].map((d) => shift('X', 'driver', t(d, '06:00'), t(d, '14:00')));
    shifts.push(shift('X', 'driver', t(6, '22:00'), t(7, '06:00')));
    expect(validateRoster(shifts, rules, week).filter((v) => v.code === 'WEEKLY_LIMIT')).toMatchObject([
      { day: MON, hours: 50 },
    ]);
  });
  it('flags overlapping shifts for one person', () => {
    const v = validateRoster(
      [shift('X', 'driver', t(0, '06:00'), t(0, '14:00')), shift('X', 'driver', t(0, '13:00'), t(0, '15:00'))],
      rules,
      { from: t(0, '06:00'), to: t(0, '15:00') },
    );
    expect(v.map((x) => x.code)).toContain('OVERLAP');
  });
});

describe('roster: 24x7 cover', () => {
  it('finds gaps at the start, middle and end of a period', () => {
    const gaps = coverageGaps(
      [
        { start: 2 * HOUR, end: 4 * HOUR },
        { start: 5 * HOUR, end: 8 * HOUR },
      ],
      0,
      10 * HOUR,
    );
    expect(gaps).toEqual([
      { from: 0, to: 2 * HOUR },
      { from: 4 * HOUR, to: 5 * HOUR },
      { from: 8 * HOUR, to: 10 * HOUR },
    ]);
  });
  it('flags a missing driver shift as an 8-hour gap', () => {
    const shifts = compliantWeek().filter((s) => !(s.role === 'driver' && s.start === t(3, '14:00')));
    expect(validateRoster(shifts, rules, week)).toMatchObject([
      { code: 'COVERAGE_GAP', role: 'driver', from: t(3, '14:00'), to: t(3, '22:00'), hours: 8 },
    ]);
  });
  it('flags a handover that leaves even a short gap', () => {
    const shifts = compliantWeek().map((s) =>
      s.role === 'driver' && s.start === t(2, '14:00') ? { ...s, start: t(2, '14:15') } : s,
    );
    expect(validateRoster(shifts, rules, week)).toMatchObject([{ code: 'COVERAGE_GAP', hours: 0.25 }]);
  });
  it('requires a doctor only during 10:00-18:00, every day', () => {
    const noSundayDoctor = compliantWeek().filter((s) => s.staffId !== 'doc-relief');
    expect(validateRoster(noSundayDoctor, rules, week)).toMatchObject([
      { code: 'COVERAGE_GAP', role: 'doctor', from: t(6, '10:00'), to: t(6, '18:00') },
    ]);
    const lateDoctor = compliantWeek().map((s) => (s.staffId === 'doc' && s.start === t(1, '10:00') ? { ...s, start: t(1, '11:00') } : s));
    expect(validateRoster(lateDoctor, rules, week)).toMatchObject([
      { code: 'COVERAGE_GAP', role: 'doctor', from: t(1, '10:00'), to: t(1, '11:00') },
    ]);
  });
  it('reports the whole period when nothing is rostered', () => {
    const v = validateRoster([], rules, week);
    expect(v.filter((x) => x.role === 'driver')).toMatchObject([{ code: 'COVERAGE_GAP', hours: 168 }]);
    expect(v.filter((x) => x.role === 'doctor')).toHaveLength(7);
  });
});

describe('contract deadlines', () => {
  it('ends the trial one month after commencement', () => {
    expect(trialLastDay({ ...rules, contract: { ...rules.contract, commencementDate: '2026-11-01' } })).toBe('2026-11-30');
    expect(trialLastDay({ ...rules, contract: { ...rules.contract, commencementDate: null } })).toBeNull();
  });
  it('lists invoice, payment, wage-proof and renewal dates', () => {
    const r = { ...rules, contract: { ...rules.contract, commencementDate: '2026-11-01' } };
    const d = upcomingDeadlines(r, '2026-11-11', 45);
    const find = (title: string) => d.find((x) => x.title.startsWith(title))?.date;
    expect(find('Raise invoice for December 2026')).toBe('2026-11-16');
    expect(find('Salary proof and PF challans for October 2026')).toBe('2026-11-20');
    expect(find('Client renewal notice due')).toBe('2026-11-23');
    expect(find('Trial period ends')).toBe('2026-11-30');
    expect(find('Client payment due for December 2026')).toBe('2026-12-01');
    expect(find('Salary proof and PF challans for November 2026')).toBe('2026-12-20');
    expect(d.map((x) => x.date)).toEqual([...d.map((x) => x.date)].sort());
    expect(d.every((x) => x.date >= '2026-11-11' && x.date <= '2026-12-26')).toBe(true);
  });
});
