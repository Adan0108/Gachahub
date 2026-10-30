import { HUGGINGFACE_TEXT_CLASSIFIER_PROFILE } from '../moderation-analysis/canonical-text-input';
import type { ClassifierEvidence } from './moderation-policy.types';

const productionProfile = Object.freeze({
  profile: HUGGINGFACE_TEXT_CLASSIFIER_PROFILE,
  model: Object.freeze({
    name: 'Horizon-Labs/multilingual-toxicity-small',
    revision: '01adcc628a33848569816d4851a38544c321b92c',
  }),
  labels: Object.freeze([
    'toxicity',
    'severe_toxicity',
    'obscene',
    'threat',
    'insult',
    'identity_attack',
    'sexual_explicit',
  ] as const),
});

// Never repoint a profile to another bundle. Fixture inference is not policy evidence.
export const MODERATION_POLICY_CLASSIFIER_PROFILES = Object.freeze({
  [HUGGINGFACE_TEXT_CLASSIFIER_PROFILE]: productionProfile,
});

export function getModerationPolicyClassifierProfile(profile: string) {
  if (!Object.hasOwn(MODERATION_POLICY_CLASSIFIER_PROFILES, profile)) {
    return undefined;
  }
  return MODERATION_POLICY_CLASSIFIER_PROFILES[
    profile as keyof typeof MODERATION_POLICY_CLASSIFIER_PROFILES
  ];
}

// Compatibility validation only. Call after parsing persisted classifier evidence;
// this does not bypass ingestion identity/hash checks or evaluate a policy.
export function isSupportedPolicyClassifierEvidence(
  evidence: ClassifierEvidence,
): boolean {
  const profile = getModerationPolicyClassifierProfile(evidence.profile);
  if (
    !profile ||
    evidence.model.name !== profile.model.name ||
    evidence.model.revision !== profile.model.revision
  )
    return false;
  return (
    Object.keys(evidence.labels).length === profile.labels.length &&
    profile.labels.every(
      (label) =>
        Object.hasOwn(evidence.labels, label) &&
        Number.isFinite(evidence.labels[label]) &&
        evidence.labels[label] >= 0 &&
        evidence.labels[label] <= 1,
    )
  );
}
