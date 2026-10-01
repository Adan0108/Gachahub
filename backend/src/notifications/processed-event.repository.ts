import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

@Injectable()
export class ProcessedEventRepository {
  async claim(
    transaction: Prisma.TransactionClient,
    eventId: string,
    consumer: string,
  ): Promise<boolean> {
    const result = await transaction.processedEvent.createMany({
      data: [
        {
          eventId,
          consumer,
        },
      ],
      skipDuplicates: true,
    });

    return result.count === 1;
  }
}
