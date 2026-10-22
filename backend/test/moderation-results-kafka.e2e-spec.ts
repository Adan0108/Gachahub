import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Kafka, type Producer } from 'kafkajs';
import { ModerationResultConsumer } from '../src/moderation-analysis/moderation-result-consumer.service';
import { ModerationResultService } from '../src/moderation-analysis/moderation-result.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { KAFKA_TOPICS } from '../src/kafka/kafka-topics';
import { isolatedCaseDatabase } from './support/isolated-case-database';
import { resultFixture } from './support/moderation-result-fixture';

describe('Stage 2B deterministic fixture through real Kafka topic', () => {
  jest.setTimeout(120_000);
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let consumer: ModerationResultConsumer | undefined;
  let producer: Producer | undefined;
  let kafka: Kafka;
  const groupId = `stage2b-fixture-${randomUUID()}`;
  const previousGroup = process.env.KAFKA_MODERATION_RESULTS_GROUP_ID;
  beforeAll(async () => {
    const brokers = process.env.KAFKA_BROKERS?.split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    if (!brokers?.length) throw new Error('KAFKA_BROKERS required');
    kafka = new Kafka({
      clientId: 'stage2b-fixture',
      brokers,
      retry: { retries: 1 },
    });
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: KAFKA_TOPICS.MODERATION_RESULTS }],
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
    producer = kafka.producer();
    await producer.connect();
    isolated = await isolatedCaseDatabase();
  });
  afterAll(async () => {
    try {
      await consumer?.onModuleDestroy();
      await producer?.disconnect();
      if (consumer) {
        const admin = kafka.admin();
        try {
          await admin.connect();
          await admin.deleteGroups([groupId]);
        } finally {
          await admin.disconnect();
        }
      }
    } finally {
      await isolated?.cleanup();
      if (previousGroup === undefined)
        delete process.env.KAFKA_MODERATION_RESULTS_GROUP_ID;
      else process.env.KAFKA_MODERATION_RESULTS_GROUP_ID = previousGroup;
    }
  });
  it('skips poison input, retries transient ingestion failure, accepts replay and preserves terminal result', async () => {
    const db = isolated.prisma as PrismaService;
    const row = await db.moderationAnalysis.create({
      data: {
        targetType: 'POST',
        targetId: randomUUID(),
        generation: 1,
        inputSchemaVersion: 1,
        inputSnapshot: {},
        snapshotHash: `sha256:${'a'.repeat(64)}`,
        classifierProfile: 'moderation-text-v1',
        case: {
          create: {
            targetType: 'POST',
            targetId: randomUUID(),
            status: 'DISMISSED',
          },
        },
      },
    });
    const before = await db.moderationCase.findUniqueOrThrow({
      where: { id: row.caseId },
    });
    const events = [resultFixture(row), resultFixture(row)];
    const results = new ModerationResultService(
      db,
      new ProcessedEventRepository(),
    );
    let failOnce = true;
    const actualResults = new ModerationResultService(
      db,
      new ProcessedEventRepository(),
    );
    const ingest = jest
      .spyOn(results, 'ingest')
      .mockImplementation(async (event) => {
        if (event.eventId === events[0].eventId && failOnce) {
          failOnce = false;
          throw new Error('fixture transient failure');
        }
        await actualResults.ingest(event);
      });
    process.env.KAFKA_MODERATION_RESULTS_GROUP_ID = groupId;
    consumer = new ModerationResultConsumer(results);
    consumer.onModuleInit();
    // Wait for group join before sending: production subscription starts at latest.
    const admin = kafka.admin();
    await admin.connect();
    try {
      const deadline = Date.now() + 30_000;
      while (true) {
        const { groups } = await admin.describeGroups([groupId]);
        if (groups.some((g) => g.state === 'Stable' && g.members.length > 0))
          break;
        if (Date.now() > deadline)
          throw new Error('Fixture consumer did not join');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      await admin.disconnect();
    }
    await producer!.send({
      topic: KAFKA_TOPICS.MODERATION_RESULTS,
      messages: [
        { key: row.caseId, value: '{ malformed fixture' },
        { key: row.caseId, value: JSON.stringify(events[0]) },
        { key: row.caseId, value: JSON.stringify(events[0]) },
        { key: row.caseId, value: JSON.stringify(events[1]) },
      ],
    });
    const deadline = Date.now() + 60_000;
    while (
      (await db.processedEvent.count({
        where: {
          eventId: { in: events.map((e) => e.eventId) },
          consumer: 'moderation-results',
        },
      })) < 2
    ) {
      if (Date.now() > deadline)
        throw new Error('Kafka result processing timed out');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const saved = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved).toMatchObject({
      status: 'SUCCEEDED',
      result: { acceptedEventId: events[0].eventId },
    });
    expect(
      await db.moderationCase.findUniqueOrThrow({ where: { id: row.caseId } }),
    ).toEqual(before);
    expect(
      ingest.mock.calls.filter(([e]) => e.eventId === events[0].eventId).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
