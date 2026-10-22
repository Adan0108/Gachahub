/**
 * Measures the chat paths issue #105 asked about, on a seeded local database:
 * the inbox (all vs one page), unread counts, a history page near the top and deep in,
 * and how fast the outbox dispatcher drains.
 *
 *   npm run docker:up                     # starts gachahub-test-postgres on :5434
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/gachahub npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/gachahub npx tsx scripts/chat-benchmark.ts
 *
 * Refuses anything but a local database: it writes thousands of rows.
 */
import 'dotenv/config';

import { Logger } from '@nestjs/common';

import { PrismaService } from '../src/prisma/prisma.service';
import { ChatRepository } from '../src/chat/chat.repository';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import type { MlsGroupRosterRepository } from '../src/mls-group-roster/mls-group-roster.repository';
import type { KafkaProducerService } from '../src/kafka/kafka-producer.service';

const RUNS = 30;
const VIEWER = 'bench-0';
// The viewer's inbox: this many direct chats and groups of 50, plus traffic among other users.
const VIEWER_DIRECT_CHATS = 400;
const VIEWER_GROUPS = 40;
const GROUP_SIZE = 50;
const MESSAGES_PER_VIEWER_CHAT = 150;
const OTHER_DIRECT_CHATS = 5_000;
const MESSAGES_PER_OTHER_CHAT = 30;
const USERS = 2_000;
const OUTBOX_EVENTS = 2_000;

function assertLocal(url: string | undefined) {
  const host = url ? new URL(url).hostname : '';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      `Refusing to benchmark against ${host || 'no database'}: use the local test database.`,
    );
  }
}

async function seed(prisma: PrismaService) {
  const seeded = await prisma.user.findUnique({ where: { id: VIEWER } });
  if (seeded) return;

  console.log('Seeding (once)...');
  const groupMembers = GROUP_SIZE - 1;
  const statements = [
    `INSERT INTO "user" (id, name, email, "updatedAt")
       SELECT 'bench-' || g, 'Bench ' || g, 'bench' || g || '@bench.local', now()
       FROM generate_series(0, ${USERS - 1}) g`,
    // The viewer's direct chats, each last active a minute apart.
    `INSERT INTO chat_conversations (id, type, "updatedAt")
       SELECT 'bench-dm-' || g, 'DIRECT', now() - g * interval '1 minute'
       FROM generate_series(1, ${VIEWER_DIRECT_CHATS}) g`,
    `INSERT INTO chat_participants (id, "conversationId", "userId", "updatedAt")
       SELECT 'bench-dmp-' || g || '-' || side, 'bench-dm-' || g,
              CASE WHEN side = 0 THEN '${VIEWER}' ELSE 'bench-' || (1 + g % ${USERS - 1}) END, now()
       FROM generate_series(1, ${VIEWER_DIRECT_CHATS}) g, generate_series(0, 1) side`,
    `INSERT INTO chat_conversations (id, type, "updatedAt")
       SELECT 'bench-g-' || g, 'GROUP', now() - g * interval '90 seconds'
       FROM generate_series(1, ${VIEWER_GROUPS}) g`,
    `INSERT INTO chat_participants (id, "conversationId", "userId", "updatedAt")
       SELECT 'bench-gp-' || g || '-' || k, 'bench-g-' || g,
              CASE WHEN k = 0 THEN '${VIEWER}'
                   ELSE 'bench-' || (1 + ((g - 1) * ${groupMembers} + k) % ${USERS - 1}) END, now()
       FROM generate_series(1, ${VIEWER_GROUPS}) g, generate_series(0, ${groupMembers}) k`,
    // Background traffic among everyone else, so the tables are not just the viewer's rows.
    `INSERT INTO chat_conversations (id, type, "updatedAt")
       SELECT 'bench-o-' || g, 'DIRECT', now() - g * interval '1 minute'
       FROM generate_series(1, ${OTHER_DIRECT_CHATS}) g`,
    `INSERT INTO chat_participants (id, "conversationId", "userId", "updatedAt")
       SELECT 'bench-op-' || g || '-' || side, 'bench-o-' || g,
              'bench-' || (1 + (g * 7 + side * 13) % ${USERS - 1}), now()
       FROM generate_series(1, ${OTHER_DIRECT_CHATS}) g, generate_series(0, 1) side`,
    // Messages: each conversation's members take turns, oldest first.
    `INSERT INTO chat_messages (id, "conversationId", "senderId", ciphertext, "createdAt")
       SELECT 'bench-m-' || c.id || '-' || i, c.id, p."userId", repeat('x', 300),
              c."updatedAt" - (${MESSAGES_PER_VIEWER_CHAT} - i) * interval '1 second'
       FROM chat_conversations c
       CROSS JOIN generate_series(1, ${MESSAGES_PER_VIEWER_CHAT}) i
       JOIN LATERAL (
         SELECT "userId" FROM chat_participants
         WHERE "conversationId" = c.id ORDER BY id OFFSET i % 2 LIMIT 1
       ) p ON true
       WHERE c.id LIKE 'bench-dm-%' OR c.id LIKE 'bench-g-%'`,
    `INSERT INTO chat_messages (id, "conversationId", "senderId", ciphertext, "createdAt")
       SELECT 'bench-m-' || c.id || '-' || i, c.id, p."userId", repeat('x', 300),
              c."updatedAt" - (${MESSAGES_PER_OTHER_CHAT} - i) * interval '1 second'
       FROM chat_conversations c
       CROSS JOIN generate_series(1, ${MESSAGES_PER_OTHER_CHAT}) i
       JOIN LATERAL (
         SELECT "userId" FROM chat_participants
         WHERE "conversationId" = c.id ORDER BY id OFFSET i % 2 LIMIT 1
       ) p ON true
       WHERE c.id LIKE 'bench-o-%'`,
    // A receipt per recipient per message, as every send writes; the last five are unread.
    `INSERT INTO chat_message_receipts (id, "messageId", "userId", "updatedAt", "deliveredAt", "readAt")
       SELECT m.id || '-r-' || p."userId", m.id, p."userId", now(), now(),
              CASE WHEN m."createdAt" > c."updatedAt" - interval '5 seconds' THEN NULL ELSE now() END
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m."conversationId"
       JOIN chat_participants p ON p."conversationId" = m."conversationId" AND p."userId" <> m."senderId"
       WHERE m.id LIKE 'bench-m-%'`,
    `ANALYZE`,
  ];
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function time<T>(run: () => Promise<T>) {
  const samples: number[] = [];
  let result: T | undefined;
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    result = await run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return { p50: at(0.5), p95: at(0.95), result: result as T };
}

async function explain(prisma: PrismaService, sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

async function benchmarkDispatcher(prisma: PrismaService) {
  await prisma.outboxEvent.deleteMany({
    where: { id: { startsWith: 'bench-' } },
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO outbox_events (id, type, version, "aggregateId", payload, "occurredAt", "updatedAt")
       SELECT 'bench-e-' || g, 'chat.message.sent', 1, 'bench-dm-1', '{}'::jsonb, now(), now()
       FROM generate_series(1, ${OUTBOX_EVENTS}) g`,
  );
  // Kafka is not under test: a publish that returns at once, so this measures the database work.
  const kafka = {
    publish: () => Promise.resolve(),
  } as unknown as KafkaProducerService;
  const dispatcher = new OutboxDispatcherService(
    new OutboxRepository(prisma),
    kafka,
  );
  const dispatch = () =>
    (dispatcher as unknown as { dispatch: () => Promise<void> }).dispatch();

  const started = performance.now();
  let ticks = 0;
  while (
    (await prisma.outboxEvent.count({
      where: { id: { startsWith: 'bench-' }, status: 'PENDING' },
    })) > 0
  ) {
    await dispatch();
    ticks += 1;
  }
  const seconds = (performance.now() - started) / 1000;
  await prisma.outboxEvent.deleteMany({
    where: { id: { startsWith: 'bench-' } },
  });
  return { seconds, ticks, perSecond: OUTBOX_EVENTS / seconds };
}

async function main() {
  assertLocal(process.env.DATABASE_URL);
  Logger.overrideLogger(['error', 'warn']);
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await seed(prisma);
    const chats = new ChatRepository(prisma, {} as MlsGroupRosterRepository);
    const counts = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(
      `SELECT (SELECT count(*) FROM chat_messages) AS messages,
              (SELECT count(*) FROM chat_message_receipts) AS receipts,
              (SELECT count(*) FROM chat_conversations) AS conversations`,
    );

    const fullInbox = await time(() =>
      chats.findInboxConversations(VIEWER, 'ACTIVE'),
    );
    const firstPage = await time(() =>
      chats.findUnpinnedInboxPage(VIEWER, 'ACTIVE', { limit: 50 }),
    );
    const ids = fullInbox.result.map((conversation) => conversation.id);
    const unreadForInbox = await time(() =>
      chats.countUnreadMessagesForConversations(ids, VIEWER),
    );
    const unreadTotal = await time(() =>
      chats.countUnreadMessagesForUser(VIEWER),
    );
    const unreadChats = await time(() =>
      chats.countUnreadConversationsForUser(VIEWER),
    );
    const group = 'bench-g-1';
    const newestHistory = await time(() =>
      chats.findMessages({ conversationId: group, limit: 50 }),
    );
    // Scrolling back: the page before the oldest message of the newest page.
    const oldestShown = newestHistory.result.at(-1)!;
    const olderHistory = await time(() =>
      chats.findMessages({
        conversationId: group,
        before: { id: oldestShown.id, createdAt: oldestShown.createdAt },
        limit: 50,
      }),
    );
    const dispatcher = await benchmarkDispatcher(prisma);

    const historyPlan = await explain(
      prisma,
      `SELECT id FROM chat_messages WHERE "conversationId" = '${group}'
         ORDER BY "createdAt" DESC, id DESC LIMIT 50`,
    );
    const unreadPlan = await explain(
      prisma,
      `SELECT count(*) FROM chat_message_receipts r JOIN chat_messages m ON m.id = r."messageId"
         WHERE r."userId" = '${VIEWER}' AND r."readAt" IS NULL AND m.status = 'SENT'`,
    );

    const ms = (value: number) => `${value.toFixed(1)} ms`;
    const row = (name: string, result: { p50: number; p95: number }) =>
      `| ${name} | ${ms(result.p50)} | ${ms(result.p95)} |`;
    console.log(
      [
        `Data: ${counts[0].conversations} conversations, ${counts[0].messages} messages, ${counts[0].receipts} receipts.`,
        `Viewer: ${ids.length} inbox conversations (${VIEWER_DIRECT_CHATS} direct, ${VIEWER_GROUPS} groups of ${GROUP_SIZE}). ${RUNS} runs each.`,
        '',
        '| Query | p50 | p95 |',
        '| --- | --- | --- |',
        row(`Inbox, all ${ids.length}`, fullInbox),
        row('Inbox, first page of 50', firstPage),
        row(`Unread counts for ${ids.length} chats`, unreadForInbox),
        row('Unread messages, total', unreadTotal),
        row('Unread chats, total', unreadChats),
        row('History, newest 50', newestHistory),
        row('History, the 50 before those', olderHistory),
        '',
        `Outbox: ${OUTBOX_EVENTS} events drained in ${dispatcher.seconds.toFixed(1)} s over ${dispatcher.ticks} ticks, ${dispatcher.perSecond.toFixed(0)} events/s (Kafka stubbed).`,
        '',
        'History plan:',
        historyPlan,
        '',
        'Unread total plan:',
        unreadPlan,
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
