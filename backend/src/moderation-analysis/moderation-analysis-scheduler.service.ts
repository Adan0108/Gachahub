import { Injectable } from '@nestjs/common';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import type { Prisma, ReportTargetType } from '../generated/prisma/client';
import type { ReportTargetSnapshot } from '../reports/domain/report-target-snapshot';
import {
  canonicalTextInput,
  TEXT_CLASSIFIER_PROFILE,
} from './canonical-text-input';

@Injectable()
export class ModerationAnalysisScheduler {
  constructor(private readonly eventPublisher: EventPublisherPort) {}

  // Caller owns the transaction and holds the case row lock (or created it).
  async scheduleIfNeeded(
    tx: Prisma.TransactionClient,
    params: {
      caseId: string;
      sourceReportId: string;
      targetType: ReportTargetType;
      targetId: string;
      snapshot: ReportTargetSnapshot;
    },
  ): Promise<void> {
    const input = canonicalTextInput(params.snapshot);
    const classifierProfile = TEXT_CLASSIFIER_PROFILE;
    const existing = await tx.moderationAnalysis.findUnique({
      where: {
        caseId_snapshotHash_classifierProfile: {
          caseId: params.caseId,
          snapshotHash: input.snapshotHash,
          classifierProfile,
        },
      },
      select: { id: true },
    });
    if (existing) return;

    const latest = await tx.moderationAnalysis.findFirst({
      where: { caseId: params.caseId },
      orderBy: { generation: 'desc' },
      select: { generation: true },
    });
    const analysis = await tx.moderationAnalysis.create({
      data: {
        caseId: params.caseId,
        sourceReportId: params.sourceReportId,
        targetType: params.targetType,
        targetId: params.targetId,
        generation: (latest?.generation ?? 0) + 1,
        classifierProfile,
        ...input,
      },
      select: { id: true, generation: true },
    });
    await this.eventPublisher.publish(
      {
        type: 'moderation.analysis.requested',
        aggregateId: params.caseId,
        payload: {
          analysisJobId: analysis.id,
          caseId: params.caseId,
          targetType: params.targetType,
          targetId: params.targetId,
          generation: analysis.generation,
          snapshotHash: input.snapshotHash,
          inputSchemaVersion: input.inputSchemaVersion,
          classifierProfile,
        },
      },
      tx,
    );
  }
}
