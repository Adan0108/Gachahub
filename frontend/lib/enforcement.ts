export type SanctionKind =
  "WARNING" | "COMMUNITY_RESTRICTION" | "COMMUNITY_BAN" | "PLATFORM_SUSPENSION";
export const sanctionLabels: Record<SanctionKind, string> = {
  WARNING: "Formal warning",
  COMMUNITY_RESTRICTION: "Community write restriction",
  COMMUNITY_BAN: "Community ban",
  PLATFORM_SUSPENSION: "Platform suspension",
};
export const sanctionEffects: Record<SanctionKind, string> = {
  WARNING: "This warning records a concern. It does not restrict your account.",
  COMMUNITY_RESTRICTION:
    "You can read this community, but cannot post, comment, react or participate there until this ends.",
  COMMUNITY_BAN:
    "Your account cannot access or participate in this community until this ends. Other communities are unaffected.",
  PLATFORM_SUSPENSION:
    "Your account cannot use platform features until this ends. Your moderation notices and appeals remain available.",
};
export type Appeal = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  statement: string;
  decisionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
};
export type Sanction = {
  id: string;
  type: SanctionKind;
  scope: "COMMUNITY" | "PLATFORM";
  reason: string;
  startsAt: string;
  expiresAt: string | null;
  effectiveStatus: "ACTIVE" | "EXPIRED" | "REVOKED";
  status: string;
  game: { name: string; slug: string } | null;
  appeal: Appeal | null;
  caseId: string | null;
  violationId?: string | null;
  enforcementId?: string | null;
};
export type Violation = {
  scope: "COMMUNITY" | "PLATFORM";
  gameId: string | null;
  id: string;
  caseId: string;
  category: string;
  severity: string;
  reason: string;
  createdAt: string;
  reversedAt: string | null;
};
export type EnforcementOverview = {
  subject: { id: string; name: string };
  scope: "COMMUNITY" | "PLATFORM";
  counts: {
    warnings?: number;
    previousSuspensions?: number;
    activeSanctions?: number;
    expiredSanctions?: number;
    revokedSanctions?: number;
    successfulAppeals?: number;
    reports: number;
    cases: number;
    pending: number;
    dismissedReports: number;
    confirmedViolations: number;
    reversedFindings: number;
  };
  risk: {
    score: number;
    tier: "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
    explanation: string;
    evaluatedAt: string;
    confirmedIncidents: number;
    factors: {
      violationId: string;
      severity: string;
      elapsedDays: number;
      halfLifeDays: number;
      contribution: number;
      repeatMultiplier: number;
    }[];
  };
  violations: Violation[];
  sanctions: Sanction[];
  contentHistory: {
    id: string;
    scope: string;
    reason: string;
    createdAt: string;
    revokedAt: string | null;
  }[];
  history: {
    id: string;
    action: string;
    reason: string;
    createdAt: string;
    actor: { name: string } | null;
  }[];
  permissions: {
    durationDays?: number[];
    canConfirm: boolean;
    canSanction: boolean;
    customDuration: boolean;
    scope: string;
    sanctionTypes: SanctionKind[];
  };
};
export type SanctionPage = {
  contentNotices?: {
    id: string;
    targetType: string;
    reason: string;
    scope: string;
    createdAt: string;
    revokedAt: string | null;
    game: { name: string } | null;
  }[];
  contentNextCursor?: string | null;
  items: Sanction[];
  nextCursor: string | null;
};
export type AppealPage = {
  items: (Appeal & { canReview: boolean; sanction: Sanction & { subjectId: string } })[];
  nextCursor: string | null;
};
