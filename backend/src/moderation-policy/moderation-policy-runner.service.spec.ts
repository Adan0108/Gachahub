import { Logger } from '@nestjs/common';
import {
  ModerationPolicyRunner,
  persistedPolicyInput,
} from './moderation-policy-runner.service';
import {
  ModerationPolicyRepository,
  type PolicyClaim,
} from './moderation-policy.repository';
import { UnsupportedModerationPolicyEvidenceError } from './moderation-policy.service';
import {
  POLICY_POLL_MS,
  POLICY_RECONCILE_MS,
  POLICY_WORK_BATCH_SIZE,
  policyRetryDelay,
} from './moderation-policy-execution.constants';

const claim: PolicyClaim = {
  id: 'evaluation',
  analysisId: 'analysis',
  policyVersion: 'moderation-policy-v1',
  attemptCount: 1,
  leaseToken: 'token',
};
const stored = {
  output: {
    model: { name: 'fixture', revision: '1' },
    labels: [{ label: 'threat', score: 0.7 }],
  },
};
const output = {
  policyVersion: 'moderation-policy-v1',
  riskLevel: 'LOW',
  priorityScore: 10,
  signals: [],
} as const;

describe('policy execution orchestration', () => {
  const repository = {
    claimNext: jest.fn(),
    loadAnalysis: jest.fn(),
    succeed: jest.fn(),
    unsupported: jest.fn(),
    retry: jest.fn(),
    reconcile: jest.fn(),
  };
  const policy = { evaluate: jest.fn() };
  let runner: ModerationPolicyRunner;
  beforeEach(() => {
    jest.resetAllMocks();
    repository.claimNext.mockResolvedValue(claim);
    repository.loadAnalysis.mockResolvedValue({
      status: 'SUCCEEDED',
      classifierProfile: 'fixture',
      result: stored,
    });
    policy.evaluate.mockReturnValue(output);
    runner = new ModerationPolicyRunner(
      repository as unknown as ModerationPolicyRepository,
      policy,
    );
  });
  afterEach(async () => {
    await runner.onModuleDestroy();
    jest.useRealTimers();
  });

  it('reads the stored output wrapper and evaluates persisted evidence only', async () => {
    await runner.processNext();
    expect(policy.evaluate).toHaveBeenCalledWith(
      persistedPolicyInput('fixture', stored),
    );
    expect(repository.succeed).toHaveBeenCalledWith(claim, output);
    expect(repository.retry).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { output: {} },
    {
      output: {
        ...stored.output,
        labels: [...stored.output.labels, ...stored.output.labels],
      },
    },
  ])('rejects malformed or duplicate persisted labels %#', (result) => {
    expect(() => persistedPolicyInput('fixture', result)).toThrow(
      UnsupportedModerationPolicyEvidenceError,
    );
  });
  it('finalizes unsupported evidence without retrying', async () => {
    policy.evaluate.mockImplementation(() => {
      throw new UnsupportedModerationPolicyEvidenceError();
    });
    await runner.processNext();
    expect(repository.unsupported).toHaveBeenCalledWith(claim);
    expect(repository.retry).not.toHaveBeenCalled();
  });
  it('retries unexpected evaluator failures without forwarding error details', async () => {
    policy.evaluate.mockImplementation(() => {
      throw new Error('private input');
    });
    await runner.processNext();
    expect(repository.retry).toHaveBeenCalledWith(claim);
    expect(repository.succeed).not.toHaveBeenCalled();
  });
  it('retries invalid evaluator output before writing an advisory', async () => {
    policy.evaluate.mockReturnValue({ ...output, priorityScore: 101 });
    await runner.processNext();
    expect(repository.retry).toHaveBeenCalledWith(claim);
    expect(repository.succeed).not.toHaveBeenCalled();
  });
  it('does not classify a database outage as unsupported evidence', async () => {
    repository.loadAnalysis.mockRejectedValue(new Error('db unavailable'));
    await expect(runner.processNext()).rejects.toThrow();
    expect(repository.unsupported).not.toHaveBeenCalled();
    expect(repository.retry).not.toHaveBeenCalled();
  });
  it('handles an empty queue', async () => {
    repository.claimNext.mockResolvedValue(null);
    expect(await runner.processNext()).toBe(false);
    expect(repository.loadAnalysis).not.toHaveBeenCalled();
  });
  it('polls after completion, never overlaps and stops cleanly while work is in flight', async () => {
    jest.useFakeTimers();
    let finish!: (value: null) => void;
    repository.claimNext.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(POLICY_POLL_MS * 3);
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = runner.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(null);
    await stopping;
    await jest.advanceTimersByTimeAsync(POLICY_POLL_MS * 3);
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
  });
  it('bounds work per tick and reconciles once per configured interval', async () => {
    jest.useFakeTimers();
    runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(repository.claimNext).toHaveBeenCalledTimes(POLICY_WORK_BATCH_SIZE);
    expect(repository.reconcile).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(POLICY_POLL_MS);
    expect(repository.claimNext).toHaveBeenCalledTimes(
      2 * POLICY_WORK_BATCH_SIZE,
    );
    expect(repository.reconcile).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(POLICY_RECONCILE_MS - POLICY_POLL_MS);
    expect(repository.reconcile).toHaveBeenCalledTimes(2);
  });
  it('logs a fixed message and backs off after infrastructure failure', async () => {
    jest.useFakeTimers();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    repository.reconcile.mockRejectedValueOnce(
      new Error('secret query parameters'),
    );
    try {
      runner.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledWith(
        'Moderation policy cycle failed; durable work will retry',
      );
      expect(repository.reconcile).toHaveBeenCalledTimes(1);
      repository.claimNext.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(POLICY_POLL_MS);
      expect(repository.reconcile).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
  it('caps deterministic exponential retry delay', () => {
    expect([1, 2, 3, 4, 5, 10].map(policyRetryDelay)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000,
    ]);
  });
});
