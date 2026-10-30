import { ModerationAnalysisScheduler } from './moderation-analysis-scheduler.service';
import {
  configuredTextClassifierProfile,
  HUGGINGFACE_TEXT_CLASSIFIER_PROFILE,
  TEXT_CLASSIFIER_PROFILE,
} from './canonical-text-input';
import type { EventPublisherPort } from '../domain-events/event-publisher.port';
import type { Prisma } from '../generated/prisma/client';
import type { ReportTargetSnapshot } from '../reports/domain/report-target-snapshot';

describe('immutable classifier profile scheduling', () => {
  const original = process.env.MODERATION_CLASSIFIER_PROFILE;
  afterEach(() => {
    if (original === undefined)
      delete process.env.MODERATION_CLASSIFIER_PROFILE;
    else process.env.MODERATION_CLASSIFIER_PROFILE = original;
  });

  it('defaults to the existing fixture profile and rejects unknown profiles', () => {
    delete process.env.MODERATION_CLASSIFIER_PROFILE;
    expect(configuredTextClassifierProfile()).toBe(TEXT_CLASSIFIER_PROFILE);
    process.env.MODERATION_CLASSIFIER_PROFILE = 'unknown';
    expect(() => configuredTextClassifierProfile()).toThrow(
      'Unsupported MODERATION_CLASSIFIER_PROFILE',
    );
  });

  it('schedules a distinct immutable bundle without repointing the fixture identity', async () => {
    process.env.MODERATION_CLASSIFIER_PROFILE =
      HUGGINGFACE_TEXT_CLASSIFIER_PROFILE;
    const publish = jest.fn();
    const scheduler = new ModerationAnalysisScheduler({
      publish,
    } as unknown as EventPublisherPort);
    const tx = {
      moderationAnalysis: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ generation: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'job', generation: 2 }),
      },
    };
    const snapshot = {
      targetType: 'COMMENT',
      content: 'sample',
    } as ReportTargetSnapshot;
    await scheduler.scheduleIfNeeded(
      tx as unknown as Prisma.TransactionClient,
      {
        caseId: 'case',
        sourceReportId: 'report',
        targetType: 'COMMENT',
        targetId: 'comment',
        snapshot,
      },
    );
    expect(tx.moderationAnalysis.findUnique).toHaveBeenCalledWith({
      where: {
        caseId_snapshotHash_classifierProfile: expect.objectContaining({
          classifierProfile: HUGGINGFACE_TEXT_CLASSIFIER_PROFILE,
        }),
      },
      select: { id: true },
    });
    expect(tx.moderationAnalysis.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classifierProfile: HUGGINGFACE_TEXT_CLASSIFIER_PROFILE,
        generation: 2,
      }),
      select: { id: true, generation: true },
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          classifierProfile: HUGGINGFACE_TEXT_CLASSIFIER_PROFILE,
        }),
      }),
      tx,
    );
    expect(TEXT_CLASSIFIER_PROFILE).toBe('moderation-text-v1');
  });
});
