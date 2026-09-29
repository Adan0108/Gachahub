import 'dotenv/config';
import { randomUUID } from 'crypto';

import { NotificationRepository } from '../src/notifications/notification.repository';
import { NotificationService } from '../src/notifications/notification.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { PrismaService } from '../src/prisma/prisma.service';

const CONSUMER = 'notifications';

async function main() {
  const prisma = new PrismaService();

  const notificationRepository = new NotificationRepository(prisma);
  const notificationService = new NotificationService(notificationRepository);
  const processedEventRepository = new ProcessedEventRepository();

  const suffix = randomUUID();

  const actorId = `test-actor-${suffix}`;
  const recipientId = `test-recipient-${suffix}`;

  const normalEventId = `event-normal-${suffix}`;
  const rollbackEventId = `event-rollback-${suffix}`;

  const normalEntityId = `post-normal-${suffix}`;
  const rollbackEntityId = `post-rollback-${suffix}`;

  try {
    await prisma.$connect();

    /*
     * Temporary users used by Notification relations and recipient checks.
     */
    await prisma.user.createMany({
      data: [
        {
          id: actorId,
          name: 'Idempotency Test Actor',
          email: `actor-${suffix}@example.com`,
          emailVerified: true,
        },
        {
          id: recipientId,
          name: 'Idempotency Test Recipient',
          email: `recipient-${suffix}@example.com`,
          emailVerified: true,
        },
      ],
    });

    console.log('\n=== TEST 1: new event is processed ===');

    await prisma.$transaction(async (transaction) => {
      const claimed = await processedEventRepository.claim(
        transaction,
        normalEventId,
        CONSUMER,
      );

      if (!claimed) {
        throw new Error('Expected new event to be claimed');
      }

      await notificationService.createNotification(
        {
          recipientId,
          actorId,
          type: 'POST_LIKED',
          entityType: 'POST',
          entityId: normalEntityId,
        },
        transaction,
      );
    });

    const processedAfterFirst = await prisma.processedEvent.count({
      where: {
        eventId: normalEventId,
        consumer: CONSUMER,
      },
    });

    const notificationsAfterFirst = await prisma.notification.count({
      where: {
        recipientId,
        actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: normalEntityId,
      },
    });

    console.log({
      processedEvents: processedAfterFirst,
      notifications: notificationsAfterFirst,
    });

    if (processedAfterFirst !== 1 || notificationsAfterFirst !== 1) {
      throw new Error('TEST 1 failed');
    }

    console.log('✅ TEST 1 passed');

    /*
     * -------------------------------------------------------------
     */

    console.log('\n=== TEST 2: duplicate event is skipped ===');

    let duplicateClaimed = true;

    await prisma.$transaction(async (transaction) => {
      duplicateClaimed = await processedEventRepository.claim(
        transaction,
        normalEventId,
        CONSUMER,
      );

      if (!duplicateClaimed) {
        return;
      }

      await notificationService.createNotification(
        {
          recipientId,
          actorId,
          type: 'POST_LIKED',
          entityType: 'POST',
          entityId: normalEntityId,
        },
        transaction,
      );
    });

    const processedAfterDuplicate = await prisma.processedEvent.count({
      where: {
        eventId: normalEventId,
        consumer: CONSUMER,
      },
    });

    const notificationsAfterDuplicate = await prisma.notification.count({
      where: {
        recipientId,
        actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: normalEntityId,
      },
    });

    console.log({
      duplicateClaimed,
      processedEvents: processedAfterDuplicate,
      notifications: notificationsAfterDuplicate,
    });

    if (
      duplicateClaimed ||
      processedAfterDuplicate !== 1 ||
      notificationsAfterDuplicate !== 1
    ) {
      throw new Error('TEST 2 failed');
    }

    console.log('✅ TEST 2 passed');

    /*
     * -------------------------------------------------------------
     */

    console.log(
      '\n=== TEST 3: failure rolls back processed event + notification ===',
    );

    try {
      await prisma.$transaction(async (transaction) => {
        const claimed = await processedEventRepository.claim(
          transaction,
          rollbackEventId,
          CONSUMER,
        );

        if (!claimed) {
          throw new Error('Expected rollback event to be claimed');
        }

        await notificationService.createNotification(
          {
            recipientId,
            actorId,
            type: 'POST_LIKED',
            entityType: 'POST',
            entityId: rollbackEntityId,
          },
          transaction,
        );

        /*
         * Simulate consumer failure/crash after the notification
         * has been created but before the transaction commits.
         */
        throw new Error('FORCED_TRANSACTION_FAILURE');
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'FORCED_TRANSACTION_FAILURE'
      ) {
        throw error;
      }

      console.log('Expected failure triggered');
    }

    const processedAfterRollback = await prisma.processedEvent.count({
      where: {
        eventId: rollbackEventId,
        consumer: CONSUMER,
      },
    });

    const notificationsAfterRollback = await prisma.notification.count({
      where: {
        recipientId,
        actorId,
        type: 'POST_LIKED',
        entityType: 'POST',
        entityId: rollbackEntityId,
      },
    });

    console.log({
      processedEvents: processedAfterRollback,
      notifications: notificationsAfterRollback,
    });

    if (processedAfterRollback !== 0 || notificationsAfterRollback !== 0) {
      throw new Error('TEST 3 failed');
    }

    console.log('✅ TEST 3 passed');

    console.log('\n🎉 Notification idempotency integration test passed');
  } finally {
    /*
     * Clean up only data created by this script.
     */
    await prisma.processedEvent.deleteMany({
      where: {
        eventId: {
          in: [normalEventId, rollbackEventId],
        },
        consumer: CONSUMER,
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [actorId, recipientId],
        },
      },
    });

    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('\n❌ Notification idempotency test failed');

  if (error instanceof Error) {
    console.error(error.stack);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
