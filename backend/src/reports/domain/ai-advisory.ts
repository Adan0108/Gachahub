import {
  canonicalTextInput,
  hashTextInput,
  moderationInputSnapshotSchema,
  TEXT_INPUT_SCHEMA_VERSION,
  type CanonicalTextSource,
} from '../../moderation-analysis/canonical-text-input';
import {
  parseModerationPolicyOutput,
  parsePersistedPolicyInput,
} from '../../moderation-policy/moderation-policy.contract';
import { isSupportedPolicyClassifierEvidence } from '../../moderation-policy/moderation-policy.profiles';
import {
  MODERATION_POLICY_VERSION_V1,
  type ModerationPolicyOutput,
} from '../../moderation-policy/moderation-policy.types';

export const NON_CURRENT_ADVISORY_STATES = [
  'CASE_CLOSED',
  'TARGET_UNAVAILABLE',
  'NO_ANALYSIS',
  'CONTENT_CHANGED',
  'ANALYSIS_PENDING',
  'ANALYSIS_FAILED',
  'UNSUPPORTED_EVIDENCE',
  'POLICY_PENDING',
  'POLICY_FAILED',
  'FRESHNESS_UNVERIFIED',
] as const;
export type NonCurrentAdvisoryState =
  (typeof NON_CURRENT_ADVISORY_STATES)[number];

export const AI_ADVISORY_DESCRIPTION =
  ' aiAdvisory is a freshness discriminated union shared by list/detail. CURRENT contains analysisGeneration, policyVersion, riskLevel, priorityScore (advisory only; does not change sorting), signals and evaluatedAt (ISO date-time). Other states contain state and optional analysisGeneration only, never stale risk/priority/signals. States: CURRENT, ' +
  NON_CURRENT_ADVISORY_STATES.join(', ') +
  '. Highest allocated generation is selected before status filtering; no historical fallback. Current canonical target hash must match. No raw classifier scores, result JSON or retry/lease metadata is returned. GET projection is read-only.';
export type AiAdvisory =
  | ({
      state: 'CURRENT';
      analysisGeneration: number;
      evaluatedAt: string;
    } & ModerationPolicyOutput)
  | { state: NonCurrentAdvisoryState; analysisGeneration?: number };

/** Private database projection: never spread this record into an API response. */
export interface AdvisoryAnalysisRow {
  caseId: string;
  analysisId: string | null;
  analysisTargetType: string | null;
  analysisTargetId: string | null;
  generation: number | null;
  inputSchemaVersion: number | null;
  inputSnapshot: unknown;
  snapshotHash: string | null;
  classifierProfile: string | null;
  analysisStatus: string | null;
  result: unknown;
  policyVersion: string | null;
  policyStatus: string | null;
  riskLevel: unknown;
  priorityScore: unknown;
  signals: unknown;
  evaluatedAt: Date | null;
}

export interface AdvisoryCase {
  id: string;
  status: string;
  targetType: 'POST' | 'COMMENT';
  targetId: string;
}

/** No database, clock, policy evaluation, repair, or fallback to historical work. */
export function projectAiAdvisory(
  item: AdvisoryCase,
  target: { targetState: string; source: CanonicalTextSource | null },
  analysis?: AdvisoryAnalysisRow,
): AiAdvisory {
  const generation = analysis?.generation;
  const validGeneration =
    typeof generation === 'number' &&
    Number.isInteger(generation) &&
    generation > 0 &&
    generation <= 2147483647;
  const state = (value: NonCurrentAdvisoryState): AiAdvisory => ({
    state: value,
    ...(validGeneration ? { analysisGeneration: generation } : {}),
  });
  if (item.status === 'RESOLVED' || item.status === 'DISMISSED')
    return state('CASE_CLOSED');
  if (target.targetState !== 'available') return state('TARGET_UNAVAILABLE');
  if (!analysis?.analysisId) return state('NO_ANALYSIS');
  if (
    !['OPEN', 'IN_REVIEW'].includes(item.status) ||
    !validGeneration ||
    analysis.caseId !== item.id ||
    analysis.analysisTargetType !== item.targetType ||
    analysis.analysisTargetId !== item.targetId ||
    analysis.inputSchemaVersion !== TEXT_INPUT_SCHEMA_VERSION
  ) {
    return state('FRESHNESS_UNVERIFIED');
  }
  const stored = moderationInputSnapshotSchema.safeParse(
    analysis.inputSnapshot,
  );
  if (
    !stored.success ||
    stored.data.type !== item.targetType ||
    hashTextInput(stored.data) !== analysis.snapshotHash
  ) {
    return state('FRESHNESS_UNVERIFIED');
  }
  try {
    if (!target.source || target.source.targetType !== item.targetType)
      return state('FRESHNESS_UNVERIFIED');
    const current = canonicalTextInput(target.source);
    if (!moderationInputSnapshotSchema.safeParse(current.inputSnapshot).success)
      return state('FRESHNESS_UNVERIFIED');
    if (current.snapshotHash !== analysis.snapshotHash)
      return state('CONTENT_CHANGED');
  } catch {
    return state('FRESHNESS_UNVERIFIED');
  }
  if (analysis.analysisStatus === 'PENDING') return state('ANALYSIS_PENDING');
  if (analysis.analysisStatus === 'FAILED') return state('ANALYSIS_FAILED');
  if (analysis.analysisStatus !== 'SUCCEEDED')
    return state('FRESHNESS_UNVERIFIED');
  try {
    if (
      !analysis.classifierProfile ||
      !isSupportedPolicyClassifierEvidence(
        parsePersistedPolicyInput(analysis.classifierProfile, analysis.result)
          .classifier,
      )
    )
      return state('UNSUPPORTED_EVIDENCE');
  } catch {
    return state('UNSUPPORTED_EVIDENCE');
  }
  if (
    analysis.policyVersion !== MODERATION_POLICY_VERSION_V1 ||
    !analysis.policyStatus ||
    analysis.policyStatus === 'PENDING'
  )
    return state('POLICY_PENDING');
  if (analysis.policyStatus === 'FAILED') return state('POLICY_FAILED');
  if (analysis.policyStatus === 'UNSUPPORTED')
    return state('UNSUPPORTED_EVIDENCE');
  if (analysis.policyStatus !== 'SUCCEEDED')
    return state('FRESHNESS_UNVERIFIED');
  try {
    const output = parseModerationPolicyOutput({
      policyVersion: analysis.policyVersion,
      riskLevel: analysis.riskLevel,
      priorityScore: analysis.priorityScore,
      signals: analysis.signals,
    });
    if (
      !(analysis.evaluatedAt instanceof Date) ||
      !Number.isFinite(analysis.evaluatedAt.getTime())
    )
      return state('FRESHNESS_UNVERIFIED');
    return {
      state: 'CURRENT',
      analysisGeneration: generation,
      ...output,
      evaluatedAt: analysis.evaluatedAt.toISOString(),
    };
  } catch {
    return state('FRESHNESS_UNVERIFIED');
  }
}
