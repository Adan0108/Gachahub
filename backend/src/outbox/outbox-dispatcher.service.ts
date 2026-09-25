import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  DOMAIN_EVENT_TYPES,
  type DomainEventType,
} from '../domain-events/domain-event.types';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { OutboxRepository } from './outbox.repository';

const DISPATCH_INTERVAL_MS = 2_000;
const BATCH_SIZE = 20;

const MAX_ATTEMPTS = 8;

const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

const STALE_PROCESSING_MS = 5 * 60 * 1_000;

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  private timer?: ReturnType<typeof setInterval>;

  private isRunning = false;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    /*
     * Run immediately when the application starts,
     * then continue polling periodically.
     */
    void this.dispatch();

    this.timer = setInterval(() => {
      void this.dispatch();
    }, DISPATCH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async dispatch(): Promise<void> {
    /*
     * Prevent overlapping polling cycles inside the same process.
     */
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      await this.recoverStaleEvents();

      const events = await this.outboxRepository.findReady(BATCH_SIZE);

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error(
        'Outbox dispatch cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processEvent(
    event: Awaited<ReturnType<OutboxRepository['findReady']>>[number],
  ): Promise<void> {
    const claimed = await this.outboxRepository.claim(event.id);

    if (!claimed) {
      /*
       * Another dispatcher instance already claimed it.
       */
      return;
    }

    const attempt = event.attemptCount + 1;

    try {
      if (!this.isDomainEventType(event.type)) {
        await this.outboxRepository.markFailed(
          event.id,
          `Unsupported domain event type: ${event.type}`,
        );

        return;
      }

      await this.kafkaProducer.publish({
        eventId: event.id,
        type: event.type,
        version: event.version,
        aggregateId: event.aggregateId,
        payload: event.payload,
        occurredAt: event.occurredAt.toISOString(),
      });

      await this.outboxRepository.markPublished(event.id);

      this.logger.debug(`Published outbox event ${event.id} (${event.type})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (attempt >= MAX_ATTEMPTS) {
        await this.outboxRepository.markFailed(event.id, message);

        this.logger.error(
          `Outbox event ${event.id} failed permanently after ${attempt} attempts`,
        );

        return;
      }

      const retryDelay = this.calculateRetryDelay(attempt);

      await this.outboxRepository.markForRetry(
        event.id,
        message,
        new Date(Date.now() + retryDelay),
      );

      this.logger.warn(
        `Outbox event ${event.id} failed. Retry ${attempt}/${MAX_ATTEMPTS} scheduled in ${retryDelay}ms`,
      );
    }
  }

  private calculateRetryDelay(attempt: number): number {
    /*
     * Exponential backoff:
     *
     * attempt 1 -> 1s
     * attempt 2 -> 2s
     * attempt 3 -> 4s
     * attempt 4 -> 8s
     * ...
     *
     * capped at 5 minutes.
     */
    return Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  }

  private async recoverStaleEvents(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

    const result =
      await this.outboxRepository.recoverStaleProcessing(staleBefore);

    if (result.count > 0) {
      this.logger.warn(`Recovered ${result.count} stale outbox event(s)`);
    }
  }

  private isDomainEventType(type: string): type is DomainEventType {
    return Object.values(DOMAIN_EVENT_TYPES).some((value) => value === type);
  }
}
