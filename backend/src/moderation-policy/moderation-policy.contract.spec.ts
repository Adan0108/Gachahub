import { parseModerationPolicyOutput } from './moderation-policy.contract';
import {
  MODERATION_POLICY_RISK_LEVELS,
  MODERATION_POLICY_SIGNALS,
  MODERATION_POLICY_VERSION_V1,
} from './moderation-policy.types';
import { Test } from '@nestjs/testing';
import { ModerationPolicyModule } from './moderation-policy.module';

const valid = () => ({
  policyVersion: MODERATION_POLICY_VERSION_V1,
  riskLevel: 'LOW',
  priorityScore: 10,
  signals: ['CONTEXT_REVIEW_REQUIRED'],
});

describe('moderation policy output contract', () => {
  it('accepts valid output without adding actions or changing scores', () => {
    expect(parseModerationPolicyOutput(valid())).toEqual(valid());
  });
  it.each([0, 100])(
    'accepts inclusive priority boundary %s',
    (priorityScore) => {
      expect(
        parseModerationPolicyOutput({ ...valid(), priorityScore })
          .priorityScore,
      ).toBe(priorityScore);
    },
  );
  it.each([-1, 101, 0.5, NaN, Infinity, -Infinity, '10', null])(
    'rejects invalid priority %s',
    (priorityScore) => {
      expect(() =>
        parseModerationPolicyOutput({ ...valid(), priorityScore }),
      ).toThrow();
    },
  );
  it.each(MODERATION_POLICY_RISK_LEVELS)(
    'accepts risk enum %s without evaluating it',
    (riskLevel) => {
      expect(
        parseModerationPolicyOutput({ ...valid(), riskLevel }).riskLevel,
      ).toBe(riskLevel);
    },
  );
  it.each([
    { riskLevel: 'UNKNOWN' },
    { policyVersion: 'moderation-policy-v2' },
    { signals: ['HIDE_CONTENT'] },
    { signals: ['POSSIBLE_THREAT', 'POSSIBLE_THREAT'] },
    { signals: Array(8).fill('POSSIBLE_THREAT') },
    { signals: null },
    { signals: [{ code: 'POSSIBLE_THREAT' }] },
    { extra: true },
    { action: 'BAN' },
  ])('rejects invalid contract shape %#', (patch) => {
    expect(() =>
      parseModerationPolicyOutput({ ...valid(), ...patch }),
    ).toThrow();
  });
  it('accepts empty or complete unique signal sets', () => {
    expect(
      parseModerationPolicyOutput({ ...valid(), signals: [] }).signals,
    ).toEqual([]);
    expect(
      parseModerationPolicyOutput({
        ...valid(),
        signals: [...MODERATION_POLICY_SIGNALS],
      }).signals,
    ).toEqual(MODERATION_POLICY_SIGNALS);
  });
  it.each(['policyVersion', 'riskLevel', 'priorityScore', 'signals'])(
    'requires %s',
    (key) => {
      const output: Record<string, unknown> = valid();
      delete output[key];
      expect(() => parseModerationPolicyOutput(output)).toThrow();
    },
  );
  it('compiles the inert module', async () => {
    const module = await Test.createTestingModule({
      imports: [ModerationPolicyModule],
    }).compile();
    await module.close();
  });
});
