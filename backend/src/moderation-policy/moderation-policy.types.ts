export const MODERATION_POLICY_VERSION_V1 = 'moderation-policy-v1';

export const MODERATION_POLICY_RISK_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const);

export type ModerationPolicyRiskLevel =
  (typeof MODERATION_POLICY_RISK_LEVELS)[number];

// Advisory identifiers only; no thresholds or enforcement actions are defined here.
export const MODERATION_POLICY_SIGNALS = Object.freeze([
  'SEVERE_TOXICITY_HIGH_SCORE',
  'TOXICITY_WITH_INSULT',
  'IDENTITY_ATTACK_POSSIBLE',
  'SEXUAL_CONTENT_POSSIBLE',
  'PROFANITY_POSSIBLE',
  'POSSIBLE_THREAT',
  'CONTEXT_REVIEW_REQUIRED',
] as const);

export type ModerationPolicySignal = (typeof MODERATION_POLICY_SIGNALS)[number];

export interface ClassifierEvidence {
  readonly profile: string;
  readonly model: { readonly name: string; readonly revision: string };
  readonly labels: Readonly<Record<string, number>>;
}

// Reserved input shape only: no context model, persistence or execution in 2D.1.
export type ContextEvidence = ClassifierEvidence;

export interface ModerationPolicyInput {
  readonly classifier: ClassifierEvidence;
  readonly context?: ContextEvidence;
}

export interface ModerationPolicyOutput {
  readonly policyVersion: typeof MODERATION_POLICY_VERSION_V1;
  readonly riskLevel: ModerationPolicyRiskLevel;
  // Queue prioritization only, NOT violation probability or model confidence.
  readonly priorityScore: number;
  readonly signals: readonly ModerationPolicySignal[];
}
