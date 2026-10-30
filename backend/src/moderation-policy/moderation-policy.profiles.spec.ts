import { TEXT_CLASSIFIER_PROFILE } from '../moderation-analysis/canonical-text-input';
import {
  getModerationPolicyClassifierProfile,
  isSupportedPolicyClassifierEvidence,
  MODERATION_POLICY_CLASSIFIER_PROFILES,
} from './moderation-policy.profiles';
import type { ClassifierEvidence } from './moderation-policy.types';

const PROFILE = 'toxicity-mmbert-small-v1';
const MODEL = 'Horizon-Labs/multilingual-toxicity-small';
const REVISION = '01adcc628a33848569816d4851a38544c321b92c';
const LABELS = [
  'toxicity',
  'severe_toxicity',
  'obscene',
  'threat',
  'insult',
  'identity_attack',
  'sexual_explicit',
];
const evidence = (): ClassifierEvidence => ({
  profile: PROFILE,
  model: { name: MODEL, revision: REVISION },
  labels: Object.fromEntries(LABELS.map((label) => [label, 0.5])),
});

describe('policy classifier profile registry', () => {
  it('pins the exact production profile, model, immutable revision and taxonomy', () => {
    expect(getModerationPolicyClassifierProfile(PROFILE)).toEqual({
      profile: PROFILE,
      model: { name: MODEL, revision: REVISION },
      labels: LABELS,
    });
    expect(isSupportedPolicyClassifierEvidence(evidence())).toBe(true);
  });
  it.each([
    TEXT_CLASSIFIER_PROFILE,
    'unknown',
    '__proto__',
    'constructor',
    'toString',
  ])('rejects nonproduction profile %s', (profile) => {
    expect(getModerationPolicyClassifierProfile(profile)).toBeUndefined();
    expect(
      isSupportedPolicyClassifierEvidence({ ...evidence(), profile }),
    ).toBe(false);
  });
  it.each([
    { name: 'fixture', revision: REVISION },
    { name: MODEL, revision: 'main' },
  ])('rejects mismatched model identity %#', (model) => {
    expect(isSupportedPolicyClassifierEvidence({ ...evidence(), model })).toBe(
      false,
    );
  });
  it('rejects missing, extra, renamed or inherited taxonomy entries', () => {
    const labels = { ...evidence().labels };
    delete labels.threat;
    for (const invalid of [
      labels,
      { ...labels, THREAT: 0.5 },
      { ...evidence().labels, extra: 0.5 },
      Object.create(evidence().labels) as Record<string, number>,
    ]) {
      expect(
        isSupportedPolicyClassifierEvidence({ ...evidence(), labels: invalid }),
      ).toBe(false);
    }
  });
  it.each([-0.01, 1.01, NaN, Infinity, -Infinity])(
    'rejects invalid score %s',
    (score) => {
      expect(
        isSupportedPolicyClassifierEvidence({
          ...evidence(),
          labels: { ...evidence().labels, threat: score },
        }),
      ).toBe(false);
    },
  );
  it.each([0, 1])('accepts score boundary %s', (score) => {
    expect(
      isSupportedPolicyClassifierEvidence({
        ...evidence(),
        labels: { ...evidence().labels, threat: score },
      }),
    ).toBe(true);
  });
  it('freezes registry, profile, model and label array at runtime', () => {
    const profile = getModerationPolicyClassifierProfile(PROFILE)!;
    for (const value of [
      MODERATION_POLICY_CLASSIFIER_PROFILES,
      profile,
      profile.model,
      profile.labels,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Reflect.set(profile.model, 'revision', 'main')).toBe(false);
    expect(Reflect.set(profile.labels, '0', 'safe')).toBe(false);
    expect(
      Reflect.set(MODERATION_POLICY_CLASSIFIER_PROFILES, 'fixture', profile),
    ).toBe(false);
  });
});
