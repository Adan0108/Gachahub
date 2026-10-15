import type { ModerationCaseStatus } from '../generated/prisma/client';

// Temporary wire compatibility for existing report routes. Workflow state is
// stored only on ModerationCase; PENDING is the legacy spelling of OPEN.
export const LegacyReportStatus = {
  PENDING: 'PENDING',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;

export type LegacyReportStatus =
  (typeof LegacyReportStatus)[keyof typeof LegacyReportStatus];

export function toCaseStatus(status: LegacyReportStatus): ModerationCaseStatus {
  return status === 'PENDING' ? 'OPEN' : status;
}
