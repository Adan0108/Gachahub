import { moderationPolicyOutputSchema } from './moderation-policy.contract';
import { evaluateModerationPolicyRules } from './moderation-policy.rules';
import { MODERATION_POLICY_SIGNALS } from './moderation-policy.types';

const scores = (patch: Record<string, number> = {}) => ({
  toxicity: 0,
  severe_toxicity: 0,
  obscene: 0,
  threat: 0,
  insult: 0,
  identity_attack: 0,
  sexual_explicit: 0,
  ...patch,
});

describe('provisional v1 moderation rules', () => {
  it('maps low scores to LOW/10 with no signals', () => {
    expect(evaluateModerationPolicyRules(scores())).toEqual({
      policyVersion: 'moderation-policy-v1',
      riskLevel: 'LOW',
      priorityScore: 10,
      signals: [],
    });
  });
  it.each([
    ['severe_toxicity', 0.9, 'SEVERE_TOXICITY_HIGH_SCORE', 'HIGH', 70],
    ['identity_attack', 0.85, 'IDENTITY_ATTACK_POSSIBLE', 'HIGH', 70],
    ['sexual_explicit', 0.9, 'SEXUAL_CONTENT_POSSIBLE', 'MEDIUM', 40],
    ['obscene', 0.9, 'PROFANITY_POSSIBLE', 'MEDIUM', 40],
    ['threat', 0.7, 'POSSIBLE_THREAT', 'MEDIUM', 40],
  ] as const)(
    'maps %s independently',
    (label, score, signal, riskLevel, priorityScore) => {
      const output = evaluateModerationPolicyRules(scores({ [label]: score }));
      expect(output).toMatchObject({ riskLevel, priorityScore });
      expect(output.signals).toEqual(
        label === 'threat'
          ? ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED']
          : [signal],
      );
    },
  );
  it('uses the stronger medium band for the toxicity/insult conjunction', () => {
    expect(
      evaluateModerationPolicyRules(scores({ toxicity: 0.85, insult: 0.8 })),
    ).toMatchObject({
      riskLevel: 'MEDIUM',
      priorityScore: 50,
      signals: ['TOXICITY_WITH_INSULT'],
    });
  });
  it.each(['toxicity', 'insult'])(
    'does not escalate %s alone, even at 1',
    (label) => {
      expect(
        evaluateModerationPolicyRules(scores({ [label]: 1 })),
      ).toMatchObject({ riskLevel: 'LOW', priorityScore: 10, signals: [] });
    },
  );
  it('does not escalate threat plus toxicity to HIGH', () => {
    expect(
      evaluateModerationPolicyRules(scores({ toxicity: 1, threat: 1 })),
    ).toMatchObject({
      riskLevel: 'MEDIUM',
      priorityScore: 40,
      signals: ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED'],
    });
  });

  describe.each([
    ['severe_toxicity', 0.9, 'SEVERE_TOXICITY_HIGH_SCORE', {}],
    ['identity_attack', 0.85, 'IDENTITY_ATTACK_POSSIBLE', {}],
    ['sexual_explicit', 0.9, 'SEXUAL_CONTENT_POSSIBLE', {}],
    ['obscene', 0.9, 'PROFANITY_POSSIBLE', {}],
    ['threat', 0.7, 'POSSIBLE_THREAT', {}],
    ['toxicity', 0.85, 'TOXICITY_WITH_INSULT', { insult: 0.8 }],
    ['insult', 0.8, 'TOXICITY_WITH_INSULT', { toxicity: 0.85 }],
  ] as const)('%s threshold', (label, threshold, signal, companion) => {
    it.each([
      [-0.000001, false],
      [0, true],
      [0.000001, true],
    ] as const)('handles threshold offset %s', (offset, expected) => {
      const result = evaluateModerationPolicyRules(
        scores({ ...companion, [label]: threshold + offset }),
      );
      expect(result.signals.includes(signal)).toBe(expected);
      if (label === 'threat')
        expect(result.signals.includes('CONTEXT_REVIEW_REQUIRED')).toBe(
          expected,
        );
    });
  });

  it('uses canonical signal ordering independent of label insertion order', () => {
    const labels = Object.fromEntries(
      Object.keys(scores())
        .reverse()
        .map((label) => [label, 1]),
    );
    expect(evaluateModerationPolicyRules(labels)).toEqual({
      policyVersion: 'moderation-policy-v1',
      riskLevel: 'HIGH',
      priorityScore: 70,
      signals: [...MODERATION_POLICY_SIGNALS],
    });
  });
  it('never emits CRITICAL and uses the maximum fixed band for every rule combination', () => {
    const groups = [
      { severe_toxicity: 1 },
      { toxicity: 1, insult: 1 },
      { identity_attack: 1 },
      { sexual_explicit: 1 },
      { obscene: 1 },
      { threat: 1 },
    ];
    for (let mask = 0; mask < 2 ** groups.length; mask++) {
      const labels = scores();
      groups.forEach((group, index) => {
        if (mask & (1 << index)) Object.assign(labels, group);
      });
      const output = evaluateModerationPolicyRules(labels);
      expect(output.riskLevel).not.toBe('CRITICAL');
      const expectedPriority = mask & 5 ? 70 : mask & 2 ? 50 : mask ? 40 : 10;
      expect(output.priorityScore).toBe(expectedPriority);
      expect(moderationPolicyOutputSchema.safeParse(output).success).toBe(true);
    }
  });
  it('keeps the gaming representative score vector at MEDIUM with context caution', () => {
    // "Tối nay vào game giết boss rồi bắn hạ đội địch nhé."
    // Fixed illustrative vector, not a real-model floating-point golden test.
    expect(
      evaluateModerationPolicyRules(scores({ toxicity: 0.74, threat: 0.74 })),
    ).toEqual({
      policyVersion: 'moderation-policy-v1',
      riskLevel: 'MEDIUM',
      priorityScore: 40,
      signals: ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED'],
    });
  });
});
