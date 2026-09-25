import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

import type {
  DomainEventOf,
  DomainEventType,
} from '../domain-events/domain-event.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  findReady(limit: number) {
    return this.prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        availableAt: {
          lte: new Date(),
        },
      },
      orderBy: [
        {
          availableAt: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
      take: limit,
    });
  }

  async claim(id: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id,
        status: 'PENDING',
        availableAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        attemptCount: {
          increment: 1,
        },
      },
    });

    return result.count === 1;
  }

  markPublished(id: string) {
    return this.prisma.outboxEvent.update({
      where: {
        id,
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        processingAt: null,
        lastError: null,
      },
    });
  }

  markForRetry(id: string, error: string, availableAt: Date) {
    return this.prisma.outboxEvent.update({
      where: {
        id,
      },
      data: {
        status: 'PENDING',
        processingAt: null,
        lastError: error,
        availableAt,
      },
    });
  }

  markFailed(id: string, error: string) {
    return this.prisma.outboxEvent.update({
      where: {
        id,
      },
      data: {
        status: 'FAILED',
        processingAt: null,
        lastError: error,
      },
    });
  }

  recoverStaleProcessing(staleBefore: Date) {
    return this.prisma.outboxEvent.updateMany({
      where: {
        status: 'PROCESSING',
        processingAt: {
          lte: staleBefore,
        },
      },
      data: {
        status: 'PENDING',
        processingAt: null,
        availableAt: new Date(),
      },
    });
  }
}
