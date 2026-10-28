import {
  MODERATION_POLICY_SIGNALS,
  MODERATION_POLICY_VERSION_V1,
  type ModerationPolicyOutput,
  type ModerationPolicySignal,
} from './moderation-policy.types';

// Provisional engineering defaults, not calibrated violation probabilities.
export const MODERATION_POLICY_V1_THRESHOLDS = Object.freeze({
  severeToxicity: 0.9,
  toxicityWithInsult: 0.85,
  insultWithToxicity: 0.8,
  identityAttack: 0.85,
  sexualExplicit: 0.9,
  profanity: 0.9,
  threat: 0.7,
});

// Queue prioritization only. Correlated scores/signals are never summed.
export const MODERATION_POLICY_V1_PRIORITY = Object.freeze({
  low: 10,
  medium: 40,
  toxicityWithInsult: 50,
  high: 70,
});

/** Pure mapping of already validated production scores; use the service at boundaries. */
export function evaluateModerationPolicyRules(
  labels: Readonly<Record<string, number>>,
): ModerationPolicyOutput {
  const thresholds = MODERATION_POLICY_V1_THRESHOLDS;
  const matched: Record<ModerationPolicySignal, boolean> = {
    SEVERE_TOXICITY_HIGH_SCORE:
      labels.severe_toxicity >= thresholds.severeToxicity,
    TOXICITY_WITH_INSULT:
      labels.toxicity >= thresholds.toxicityWithInsult &&
      labels.insult >= thresholds.insultWithToxicity,
    IDENTITY_ATTACK_POSSIBLE:
      labels.identity_attack >= thresholds.identityAttack,
    SEXUAL_CONTENT_POSSIBLE:
      labels.sexual_explicit >= thresholds.sexualExplicit,
    PROFANITY_POSSIBLE: labels.obscene >= thresholds.profanity,
    POSSIBLE_THREAT: labels.threat >= thresholds.threat,
    CONTEXT_REVIEW_REQUIRED: labels.threat >= thresholds.threat,
  };
  const signals = MODERATION_POLICY_SIGNALS.filter((signal) => matched[signal]);
  const high =
    matched.SEVERE_TOXICITY_HIGH_SCORE || matched.IDENTITY_ATTACK_POSSIBLE;
  // CRITICAL is reserved: no v1 rule or combination maps to it.
  const riskLevel = high ? 'HIGH' : signals.length ? 'MEDIUM' : 'LOW';
  const bands = MODERATION_POLICY_V1_PRIORITY;
  const priorityScore = high
    ? bands.high
    : matched.TOXICITY_WITH_INSULT
      ? bands.toxicityWithInsult
      : signals.length
        ? bands.medium
        : bands.low;
  return {
    policyVersion: MODERATION_POLICY_VERSION_V1,
    riskLevel,
    priorityScore,
    signals,
  };
}
