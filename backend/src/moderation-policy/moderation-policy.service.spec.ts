import { PrismaService } from '../prisma/prisma.service';
import { Test } from '@nestjs/testing';
import { ModerationPolicyModule } from './moderation-policy.module';
import { getModerationPolicyClassifierProfile } from './moderation-policy.profiles';
import {
  ModerationPolicyService,
  UnsupportedModerationPolicyEvidenceError,
} from './moderation-policy.service';
import type { ModerationPolicyInput } from './moderation-policy.types';

function input(): ModerationPolicyInput {
  const profile = getModerationPolicyClassifierProfile(
    'toxicity-mmbert-small-v1',
  )!;
  return {
    classifier: {
      profile: profile.profile,
      model: { ...profile.model },
      labels: Object.fromEntries(profile.labels.map((label) => [label, 0])),
    },
  };
}
const service = new ModerationPolicyService();

describe('pure moderation policy service', () => {
  it('evaluates supported evidence without injected dependencies', () => {
    expect(service.evaluate(input())).toEqual({
      policyVersion: 'moderation-policy-v1',
      riskLevel: 'LOW',
      priorityScore: 10,
      signals: [],
    });
  });
  it.each([
    null,
    undefined,
    {},
    { classifier: null },
    { classifier: {} },
    { classifier: { ...input().classifier, model: null } },
    { classifier: { ...input().classifier, labels: null } },
    { classifier: { ...input().classifier, labels: [] } },
    { classifier: { ...input().classifier, profile: 'moderation-text-v1' } },
    { classifier: { ...input().classifier, profile: 'constructor' } },
    {
      classifier: {
        ...input().classifier,
        model: { ...input().classifier.model, name: 'fixture' },
      },
    },
    {
      classifier: {
        ...input().classifier,
        model: { ...input().classifier.model, revision: 'main' },
      },
    },
    {
      classifier: {
        ...input().classifier,
        labels: { ...input().classifier.labels, extra: 0 },
      },
    },
    {
      classifier: {
        ...input().classifier,
        labels: { ...input().classifier.labels, threat: undefined },
      },
    },
    {
      classifier: {
        ...input().classifier,
        labels: { ...input().classifier.labels, threat: '0.7' },
      },
    },
    ...[NaN, Infinity, -Infinity, -0.01, 1.01].map((threat) => ({
      classifier: {
        ...input().classifier,
        labels: { ...input().classifier.labels, threat },
      },
    })),
  ])(
    'rejects unsupported or malformed runtime evidence %# without a LOW fallback',
    (raw) => {
      expect(() => service.evaluate(raw as ModerationPolicyInput)).toThrow(
        UnsupportedModerationPolicyEvidenceError,
      );
      expect(() => service.evaluate(raw as ModerationPolicyInput)).toThrow(
        'Unsupported moderation policy classifier evidence',
      );
    },
  );
  it('rejects missing taxonomy entries', () => {
    const evidence = input();
    const labels = { ...evidence.classifier.labels };
    delete labels.insult;
    expect(() =>
      service.evaluate({ classifier: { ...evidence.classifier, labels } }),
    ).toThrow(UnsupportedModerationPolicyEvidenceError);
  });
  it('explicitly ignores optional context without interpreting its labels', () => {
    const evidence = input();
    expect(
      service.evaluate({
        ...evidence,
        context: {
          profile: 'future-context',
          model: { name: 'unselected', revision: 'unselected' },
          labels: { real_world_threat: 1 },
        },
      }),
    ).toEqual(service.evaluate(evidence));
  });
  it('is deterministic on frozen input without a clock, random source or HTTP', () => {
    const evidence = input();
    Object.freeze(evidence.classifier.labels);
    Object.freeze(evidence.classifier.model);
    Object.freeze(evidence.classifier);
    Object.freeze(evidence);
    const unavailable = () => {
      throw new Error('Side effects are unavailable');
    };
    const clock = jest.spyOn(Date, 'now').mockImplementation(unavailable);
    const random = jest.spyOn(Math, 'random').mockImplementation(unavailable);
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(unavailable);
    try {
      const first = service.evaluate(evidence);
      expect(service.evaluate(evidence)).toEqual(first);
      expect(Object.keys(first).sort()).toEqual([
        'policyVersion',
        'priorityScore',
        'riskLevel',
        'signals',
      ]);
      expect(service.evaluate(evidence).signals).not.toBe(first.signals);
      expect(service.evaluate(evidence)).toEqual({
        policyVersion: 'moderation-policy-v1',
        riskLevel: 'LOW',
        priorityScore: 10,
        signals: [],
      });
    } finally {
      clock.mockRestore();
      random.mockRestore();
      http.mockRestore();
    }
  });
  it('exports the evaluator through the module without external infrastructure', async () => {
    const module = await Test.createTestingModule({
      imports: [ModerationPolicyModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(
      module.get(ModerationPolicyService).evaluate(input()).riskLevel,
    ).toBe('LOW');
    await module.close();
  });
});
