import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessedEventRepository } from '../notifications/processed-event.repository';
import {
  ModerationResultEvent,
  toStoredModerationResult,
} from './moderation-result.contract';

const CONSUMER_ID = 'moderation-results';

@Injectable()
export class ModerationResultService {
  private readonly logger = new Logger(ModerationResultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processedEvents: ProcessedEventRepository,
  ) {}

  async ingest(event: ModerationResultEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      /**
       * Transport-level deduplication.
       *
       * Same Kafka eventId replayed:
       * only one transaction gets the claim.
       */
      const claimed = await this.processedEvents.claim(
        tx,
        event.eventId,
        CONSUMER_ID,
      );

      if (!claimed) {
        return;
      }

      // Nonlocking identity read; the first row lock below is on the case.
      const analysis = await tx.moderationAnalysis.findUnique({
        where: {
          id: event.payload.analysisJobId,
        },
        select: {
          id: true,
          caseId: true,
          generation: true,
          snapshotHash: true,
          classifierProfile: true,
        },
      });

      /**
       * Structurally valid event referencing a deleted/
       * unknown analysis is permanently irrelevant.
       *
       * Keep the ProcessedEvent claim so the same event
       * does not retry forever.
       */
      if (!analysis) {
        this.logger.warn(
          `Ignoring moderation result ${event.eventId}: analysis job not found`,
        );
        return;
      }

      if (
        analysis.caseId !== event.payload.caseId ||
        analysis.generation !== event.payload.generation ||
        analysis.snapshotHash !== event.payload.snapshotHash ||
        analysis.classifierProfile !== event.payload.classifierProfile
      ) {
        this.logger.warn(
          `Ignoring moderation result ${event.eventId}: analysis identity mismatch`,
        );
        return;
      }

      /**
       * Lock case before terminal write.
       *
       * Keeps the lock order compatible with later policy:
       *
       * case -> analysis
       */
      const caseRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM moderation_cases
          WHERE id = ${analysis.caseId}
          FOR UPDATE
        `;

      if (caseRows.length === 0) {
        this.logger.warn(
          `Ignoring moderation result ${event.eventId}: case not found`,
        );
        return;
      }

      /**
       * Logical-result idempotency.
       *
       * Different Kafka event IDs may carry results for
       * the same analysis job.
       *
       * Only PENDING -> terminal is allowed.
       */
      const updated = await tx.moderationAnalysis.updateMany({
        where: {
          id: analysis.id,
          status: 'PENDING',
        },

        data: {
          status: event.payload.status,

          result: toStoredModerationResult(event),
        },
      });

      if (updated.count === 0) {
        /**
         * Another consumer/result already won.
         *
         * Do NOT overwrite terminal data.
         */
        this.logger.debug(
          `Moderation analysis ${analysis.id} already terminal`,
        );
      }

      /**
       * IMPORTANT:
       *
       * Stage 2B ends here.
       *
       * Do NOT:
       * - mutate ModerationCase risk
       * - hide content
       * - resolve case
       * - emit Policy events
       */
    });
  }
}
