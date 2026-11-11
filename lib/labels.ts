import type { Tone } from '@/components/ui';
import type { EffectiveApproval } from './rules/eligibility';

export const APPROVAL_LABEL: Record<EffectiveApproval, [string, Tone]> = {
  approved: ['Approved by client', 'green'],
  deemed_approved: ['Deemed approved', 'green'],
  pending: ['Awaiting client', 'amber'],
  not_submitted: ['Not sent to client', 'grey'],
  objected: ['Client objected', 'red'],
};
