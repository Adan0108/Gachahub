import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { DomainEvent } from '../domain-events/domain-event.types';

@Injectable()
export class OutboxRepository {
  create(transaction: Prisma.TransactionClient, event: DomainEvent) {
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
