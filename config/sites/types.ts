/** Shape of the editable contract-rules file kept for each client site. */

export type StaffRole = 'driver' | 'doctor';

export interface RoleDeployment {
  /** Number of main (non-relief) staff the contract expects. */
  mainCount: number;
  maxShiftHours: number;
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  /** '24x7' = someone of this role must be on shift at all times. 'daily-window' = only during the window below. */
  coverage: '24x7' | 'daily-window';
  /** Required when coverage is 'daily-window'. 24-hour local time. */
  window?: { start: string; end: string };
  /** Shift slots offered in the planner (local time, [start, end]). */
  standardShifts: [string, string][];
}

export interface SiteRules {
  slug: string;
  name: string;
  clientName: string;
  providerName: string;
  /** Local time zone. utcOffsetMinutes must match it (India has no daylight saving). */
  timezone: string;
  utcOffsetMinutes: number;
  /** 1 = Monday. The 48-hour weekly limit is counted over this week. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  deployment: {
    roles: Record<StaffRole, RoleDeployment>;
    /** New pool members are deemed approved this many days after documents are sent, unless the client objects. */
    deemedApprovalDays: number;
  };

  response: {
    onPremisesResponseMinutes: number;
    backupAmbulanceMinutes: number;
  };

  absence: {
    replacementWindowMinutes: number;
    replacementTargetMinutes: number;
    warnAtMinutes: number;
    /** Client may terminate if one absence runs longer than this many continuous minutes. */
    terminationContinuousMinutes: number;
    /** Client may terminate if there are MORE than this many absences in a calendar month. */
    terminationMonthlyCount: number;
    /** Reasons that do not count as absence. */
    excludedReasons: string[];
    maintenanceWindow: { start: string; end: string };
    serviceCreditPerHour: number;
    serviceCreditMonthlyCap: number;
  };

  movement: {
    refuelWindow: { start: string; end: string };
    refuelNoticeHours: number;
    refuelMinIntervalMonths: number;
    refuelMaxIntervalMonths: number;
    servicingNoticeHours: number;
    servicingRequiresSubstituteOnSite: boolean;
    inspectionNoticeHours: number;
  };

  documents: {
    /** Alert this many days before a document expires. */
    expiryAlertDays: number[];
    requiredStaffDocs: Record<StaffRole, string[]>;
    requiredVehicleDocs: string[];
  };

  compliance: {
    wageProofDueDaysAfterMonthEnd: number;
    invoiceDaysBeforeMonthStart: number;
    paymentDueDayOfMonth: number;
    pauseServicesNoticeDays: number;
    dataBreachNoticeHours: number;
    drillsPerMonth: number;
  };

  contract: {
    /** ISO dates (YYYY-MM-DD). Leave null until known. */
    signingDate: string | null;
    firstPaymentDate: string | null;
    commencementDate: string | null;
    deployWithinDays: number;
    trialMonths: number;
    renewalNoticeDaysBeforeTrialEnd: number;
    renewalMonths: number;
  };
}

/** Human-readable names for document type codes. Add new codes here. */
export const DOC_LABELS: Record<string, string> = {
  id_proof: 'ID proof',
  qualification: 'Qualification certificate',
  driving_licence: 'Driving licence',
  medical_registration: 'MMC/NMC registration',
  bls_certificate: 'BLS certificate',
  employer_references: 'Previous employer references',
  self_declaration: 'Self-declaration (no criminal record)',
  rc: 'Registration certificate (RC)',
  fitness_certificate: 'Fitness certificate',
  permit: 'Permit',
  puc: 'PUC certificate',
  motor_insurance: 'Motor insurance',
  insurer_confirmation: 'Insurer confirmation of use',
  other: 'Other',
};
