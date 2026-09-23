import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

import type { DomainEvent } from '../domain-events/domain-event.types';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxEventPublisher implements EventPublisherPort {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async publish(
    event: DomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    await this.outboxRepository.create(transaction, event);
  }
}
