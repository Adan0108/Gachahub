import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

import type {
  DomainEventOf,
  DomainEventType,
} from '../domain-events/domain-event.types';

@Injectable()
export class OutboxRepository {
  create<T extends DomainEventType>(
    transaction: Prisma.TransactionClient,
    event: DomainEventOf<T>,
  ) {
    return transaction.outboxEvent.create({
      data: {
        id: event.eventId,
        type: event.type,
        version: event.version,
        aggregateId: event.aggregateId,
        payload: event.payload,
        occurredAt: new Date(event.occurredAt),
      },
    });
  }
}
