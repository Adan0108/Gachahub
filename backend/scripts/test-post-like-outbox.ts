import 'dotenv/config';

import { PrismaService } from '../src/prisma/prisma.service';
import { PostsRepository } from '../src/posts/posts.repository';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxEventPublisher } from '../src/outbox/outbox-event.publisher';

async function main() {
  const prisma = new PrismaService();

  await prisma.$connect();

  const postsRepository = new PostsRepository(prisma);
  const outboxRepository = new OutboxRepository();
  const eventPublisher = new OutboxEventPublisher(outboxRepository);

  let testPostId: string | null = null;

  try {
    console.log('\n=== Transactional Outbox integration test ===\n');

    const users = await prisma.user.findMany({
      take: 2,
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (users.length === 0) {
      throw new Error(
        'No users found. Create at least one user before running this script.',
      );
    }

    const authorId = users[0].id;
    const actorId = users[1]?.id ?? users[0].id;

    const game = await prisma.game.findFirst({
      where: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });

    if (!game) {
      throw new Error(
        'No ACTIVE game found. Create or activate a game before running this script.',
      );
    }

    const testPost = await prisma.post.create({
      data: {
        authorId,
        gameId: game.id,
        title: '[TEST] Transactional Outbox',
        content: 'Temporary post for transactional outbox testing.',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
      select: {
        id: true,
        reactionCount: true,
      },
    });

    testPostId = testPost.id;

    console.log(`Test post: ${testPost.id}`);
    console.log(`Actor: ${actorId}`);
    console.log(`Initial reactionCount: ${testPost.reactionCount}\n`);

    /*
     * TEST 1
     * Successful like must create:
     * - PostLike
     * - reactionCount + 1
     * - OutboxEvent
     */
    console.log('TEST 1: successful like + outbox');

    const firstLike = await prisma.$transaction(async (transaction) => {
      const result = await postsRepository.like(
        transaction,
        testPost.id,
        actorId,
      );

      if (result.changed) {
        await eventPublisher.publish(
          {
            type: 'post.liked',
            aggregateId: testPost.id,
            payload: {
              postId: testPost.id,
              postAuthorId: authorId,
              actorId,
            },
          },
          transaction,
        );
      }

      return result;
    });

    const postLikeAfterSuccess = await prisma.postLike.findFirst({
      where: {
        postId: testPost.id,
        userId: actorId,
      },
    });

    const postAfterSuccess = await prisma.post.findUniqueOrThrow({
      where: {
        id: testPost.id,
      },
      select: {
        reactionCount: true,
      },
    });

    const outboxAfterSuccess = await prisma.outboxEvent.findMany({
      where: {
        aggregateId: testPost.id,
        type: 'post.liked',
      },
    });

    if (!firstLike.changed) {
      throw new Error('TEST 1 failed: first like should have changed state.');
    }

    if (!postLikeAfterSuccess) {
      throw new Error('TEST 1 failed: PostLike was not created.');
    }

    if (postAfterSuccess.reactionCount !== testPost.reactionCount + 1) {
      throw new Error(
        `TEST 1 failed: expected reactionCount ${
          testPost.reactionCount + 1
        }, got ${postAfterSuccess.reactionCount}.`,
      );
    }

    if (outboxAfterSuccess.length !== 1) {
      throw new Error(
        `TEST 1 failed: expected 1 OutboxEvent, got ${outboxAfterSuccess.length}.`,
      );
    }

    console.log('PASS');
    console.log('  PostLike created');
    console.log(
      `  reactionCount: ${testPost.reactionCount} -> ${postAfterSuccess.reactionCount}`,
    );
    console.log('  OutboxEvent created\n');

    /*
     * TEST 2
     * Duplicate like must not create another OutboxEvent.
     */
    console.log('TEST 2: duplicate like does not create duplicate event');

    const duplicateLike = await prisma.$transaction(async (transaction) => {
      const result = await postsRepository.like(
        transaction,
        testPost.id,
        actorId,
      );

      if (result.changed) {
        await eventPublisher.publish(
          {
            type: 'post.liked',
            aggregateId: testPost.id,
            payload: {
              postId: testPost.id,
              postAuthorId: authorId,
              actorId,
            },
          },
          transaction,
        );
      }

      return result;
    });

    const postAfterDuplicate = await prisma.post.findUniqueOrThrow({
      where: {
        id: testPost.id,
      },
      select: {
        reactionCount: true,
      },
    });

    const outboxCountAfterDuplicate = await prisma.outboxEvent.count({
      where: {
        aggregateId: testPost.id,
        type: 'post.liked',
      },
    });

    if (duplicateLike.changed) {
      throw new Error('TEST 2 failed: duplicate like returned changed=true.');
    }

    if (postAfterDuplicate.reactionCount !== postAfterSuccess.reactionCount) {
      throw new Error('TEST 2 failed: duplicate like changed reactionCount.');
    }

    if (outboxCountAfterDuplicate !== 1) {
      throw new Error(
        `TEST 2 failed: expected 1 OutboxEvent, got ${outboxCountAfterDuplicate}.`,
      );
    }

    console.log('PASS');
    console.log('  changed=false');
    console.log('  reactionCount unchanged');
    console.log('  no duplicate OutboxEvent\n');

    /*
     * Reset state for rollback test.
     */
    await prisma.postLike.deleteMany({
      where: {
        postId: testPost.id,
        userId: actorId,
      },
    });

    await prisma.post.update({
      where: {
        id: testPost.id,
      },
      data: {
        reactionCount: testPost.reactionCount,
      },
    });

    await prisma.outboxEvent.deleteMany({
      where: {
        aggregateId: testPost.id,
      },
    });

    /*
     * TEST 3
     * Simulate failure inside the same transaction.
     *
     * PostLike + reactionCount must rollback.
     */
    console.log('TEST 3: rollback when event publishing fails');

    let expectedFailureCaught = false;

    try {
      await prisma.$transaction(async (transaction) => {
        const result = await postsRepository.like(
          transaction,
          testPost.id,
          actorId,
        );

        if (!result.changed) {
          throw new Error(
            'Rollback setup failed: like should have changed state.',
          );
        }

        throw new Error('SIMULATED_OUTBOX_FAILURE');
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SIMULATED_OUTBOX_FAILURE'
      ) {
        expectedFailureCaught = true;
      } else {
        throw error;
      }
    }

    if (!expectedFailureCaught) {
      throw new Error('TEST 3 failed: simulated failure was not caught.');
    }

    const postLikeAfterRollback = await prisma.postLike.findFirst({
      where: {
        postId: testPost.id,
        userId: actorId,
      },
    });

    const postAfterRollback = await prisma.post.findUniqueOrThrow({
      where: {
        id: testPost.id,
      },
      select: {
        reactionCount: true,
      },
    });

    const outboxAfterRollback = await prisma.outboxEvent.count({
      where: {
        aggregateId: testPost.id,
      },
    });

    if (postLikeAfterRollback) {
      throw new Error('TEST 3 failed: PostLike survived rollback.');
    }

    if (postAfterRollback.reactionCount !== testPost.reactionCount) {
      throw new Error(
        `TEST 3 failed: expected reactionCount ${testPost.reactionCount}, got ${postAfterRollback.reactionCount}.`,
      );
    }

    if (outboxAfterRollback !== 0) {
      throw new Error(
        `TEST 3 failed: expected 0 OutboxEvents, got ${outboxAfterRollback}.`,
      );
    }

    console.log('PASS');
    console.log('  simulated failure thrown');
    console.log('  PostLike rolled back');
    console.log('  reactionCount rolled back');
    console.log('  no OutboxEvent committed');

    console.log('\n========================================');
    console.log('ALL TRANSACTIONAL OUTBOX TESTS PASSED');
    console.log('========================================\n');
  } finally {
    if (testPostId) {
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateId: testPostId,
        },
      });

      await prisma.postLike.deleteMany({
        where: {
          postId: testPostId,
        },
      });

      await prisma.post
        .delete({
          where: {
            id: testPostId,
          },
        })
        .catch(() => undefined);
    }

    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\nTransactional Outbox test FAILED\n');

  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
