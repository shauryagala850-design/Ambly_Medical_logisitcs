import type { SiteRules, StaffRole } from '@/config/sites/types';
import { DOC_LABELS } from '@/config/sites/types';
import { DAY, dateKey } from '../time';
import { expiryStatus } from './expiry';

export type ApprovalStatus = 'not_submitted' | 'submitted' | 'approved' | 'objected';
export type EffectiveApproval = 'approved' | 'deemed_approved' | 'pending' | 'objected' | 'not_submitted';

export interface StaffForRules {
  id: string;
  role: StaffRole;
  active: boolean;
  approvalStatus: ApprovalStatus;
  /** Epoch ms when documents were sent to the client, if they have been. */
  docsSentAt: number | null;
}

export interface DocForRules {
  docType: string;
  expiresOn: string | null;
}

/**
 * Client approval, including the contract's deemed-approval rule: a pool member is deemed
 * approved N days after their documents were sent, unless the client has objected.
 */
export function effectiveApproval(
  staff: Pick<StaffForRules, 'approvalStatus' | 'docsSentAt'>,
  now: number,
  rules: SiteRules,
): { status: EffectiveApproval; deemedAt: number | null } {
  const deemedAt =
    staff.docsSentAt === null ? null : staff.docsSentAt + rules.deployment.deemedApprovalDays * DAY;
  switch (staff.approvalStatus) {
    case 'approved':
      return { status: 'approved', deemedAt };
    case 'objected':
      return { status: 'objected', deemedAt: null };
    case 'not_submitted':
      return { status: 'not_submitted', deemedAt: null };
    case 'submitted':
      if (deemedAt !== null && now >= deemedAt) return { status: 'deemed_approved', deemedAt };
      return { status: 'pending', deemedAt };
  }
}

/**
 * Reasons this person may NOT be put on a shift. An empty list means they can be assigned.
 * `now` and `shiftEnd` are epoch ms. The person must already be approved (or deemed approved)
 * at the moment of assignment, because the client can still object while approval is pending.
 * Every required document must be valid through the local date on which the shift ends.
 */
export function assignmentBlocks(
  staff: StaffForRules,
  docs: DocForRules[],
  now: number,
  shiftEnd: number,
  rules: SiteRules,
): string[] {
  const blocks: string[] = [];
  if (!staff.active) blocks.push('Marked inactive');

  const approval = effectiveApproval(staff, now, rules).status;
  if (approval === 'not_submitted') blocks.push('Documents not yet sent to the client for approval');
  if (approval === 'pending') blocks.push('Client approval still pending');
  if (approval === 'objected') blocks.push('Client objected to this person');

  const lastDay = dateKey(shiftEnd - 1, rules.utcOffsetMinutes);
  for (const type of rules.documents.requiredStaffDocs[staff.role]) {
    const label = DOC_LABELS[type] ?? type;
    const held = docs.filter((d) => d.docType === type);
    if (held.length === 0) {
      blocks.push(`Missing: ${label}`);
    } else if (!held.some((d) => expiryStatus(d.expiresOn, lastDay, []).state !== 'expired')) {
      blocks.push(`Expired: ${label}`);
    }
  }

  // Any other document on file that has lapsed (e.g. an extra licence) also blocks deployment.
  const required = new Set(rules.documents.requiredStaffDocs[staff.role]);
  for (const d of docs) {
    if (required.has(d.docType)) continue;
    const others = docs.filter((o) => o.docType === d.docType);
    if (others.every((o) => expiryStatus(o.expiresOn, lastDay, []).state === 'expired')) {
      const msg = `Expired: ${DOC_LABELS[d.docType] ?? d.docType}`;
      if (!blocks.includes(msg)) blocks.push(msg);
    }
  }
  return blocks;
}
