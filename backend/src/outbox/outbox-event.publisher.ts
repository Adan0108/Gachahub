import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

import { createDomainEvent } from '../domain-events/domain-event.factory';
import type { DomainEventType } from '../domain-events/domain-event.types';
import {
  EventPublisherPort,
  type PublishDomainEventInput,
} from '../domain-events/event-publisher.port';
import { OutboxRepository } from './outbox.repository';

@Injectable()
export class OutboxEventPublisher implements EventPublisherPort {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async publish<T extends DomainEventType>(
    input: PublishDomainEventInput<T>,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const event = createDomainEvent(input);

    await this.outboxRepository.create(transaction, event);
  }
}
