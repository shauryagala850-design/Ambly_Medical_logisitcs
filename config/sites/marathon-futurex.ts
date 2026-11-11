import type { SiteRules } from './types';

/**
 * Contract rules for Marathon Futurex, Lower Parel, Mumbai.
 * Client: Marathon Nextgen Realty Limited. Provider: Ezung Healthcare Private Limited.
 *
 * EDIT THIS FILE when the contract changes. Nothing here is hard-coded elsewhere in the app.
 * To add a new client site, copy this file, change the values, and register it in config/sites/index.ts.
 */
export const marathonFuturex: SiteRules = {
  slug: 'marathon-futurex',
  name: 'Marathon Futurex, Lower Parel',
  clientName: 'Marathon Nextgen Realty Limited',
  providerName: 'Ezung Healthcare Private Limited',
  timezone: 'Asia/Kolkata',
  utcOffsetMinutes: 330,
  weekStartsOn: 1,

  deployment: {
    roles: {
      driver: {
        mainCount: 3,
        maxShiftHours: 8,
        maxHoursPerDay: 8,
        maxHoursPerWeek: 48,
        coverage: '24x7',
        standardShifts: [
          ['06:00', '14:00'],
          ['14:00', '22:00'],
          ['22:00', '06:00'],
        ],
      },
      doctor: {
        mainCount: 1,
        maxShiftHours: 8,
        maxHoursPerDay: 8,
        maxHoursPerWeek: 48,
        coverage: 'daily-window',
        window: { start: '10:00', end: '18:00' },
        standardShifts: [['10:00', '18:00']],
      },
    },
    deemedApprovalDays: 3,
  },

  response: {
    onPremisesResponseMinutes: 5,
    backupAmbulanceMinutes: 15,
  },

  absence: {
    replacementWindowMinutes: 120,
    replacementTargetMinutes: 60,
    warnAtMinutes: 90,
    terminationContinuousMinutes: 120,
    terminationMonthlyCount: 3,
    excludedReasons: [
      'emergency_trip',
      'maintenance_window',
      'statutory_inspection',
      'approved_substitute',
      'meal_break_on_site',
      'force_majeure',
      'replacement_window',
    ],
    maintenanceWindow: { start: '07:00', end: '08:00' },
    serviceCreditPerHour: 500,
    serviceCreditMonthlyCap: 21000,
  },

  movement: {
    refuelWindow: { start: '07:00', end: '08:00' },
    refuelNoticeHours: 24,
    refuelMinIntervalMonths: 1,
    refuelMaxIntervalMonths: 3,
    servicingNoticeHours: 48,
    servicingRequiresSubstituteOnSite: true,
    inspectionNoticeHours: 24,
  },

  documents: {
    expiryAlertDays: [60, 30, 7],
    requiredStaffDocs: {
      driver: [
        'id_proof',
        'qualification',
        'driving_licence',
        'bls_certificate',
        'employer_references',
        'self_declaration',
      ],
      doctor: [
        'id_proof',
        'qualification',
        'medical_registration',
        'employer_references',
        'self_declaration',
      ],
    },
    requiredVehicleDocs: [
      'rc',
      'fitness_certificate',
      'permit',
      'puc',
      'motor_insurance',
      'insurer_confirmation',
    ],
  },

  compliance: {
    wageProofDueDaysAfterMonthEnd: 20,
    invoiceDaysBeforeMonthStart: 15,
    paymentDueDayOfMonth: 1,
    pauseServicesNoticeDays: 3,
    dataBreachNoticeHours: 24,
    drillsPerMonth: 1,
  },

  contract: {
    signingDate: null,
    firstPaymentDate: null,
    // PLACEHOLDER for testing. Replace with the real Commencement Date (first day of deployment).
    commencementDate: '2026-11-01',
    deployWithinDays: 5,
    trialMonths: 1,
    renewalNoticeDaysBeforeTrialEnd: 7,
    renewalMonths: 12,
  },
};
