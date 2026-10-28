import { ModerationPolicyRepository } from '../src/moderation-policy/moderation-policy.repository';
// Opt-in real local PostgreSQL/Kafka/HTTP/Python integration. No shared DB URL fallback.
jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    AllowAnonymous: () => common.SetMetadata('PUBLIC', true),
    Session: () =>
      common.createParamDecorator(
        (_: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest<{ session: unknown }>().session,
      )(),
  };
});
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';
import { Client } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsService } from '../src/reports/reports.service';
import { ReportsRepository } from '../src/reports/reports.repository';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportRateLimiterService } from '../src/reports/infrastructure/report-rate-limiter.service';
import { PostVisibilityService } from '../src/post-visibility/post-visibility.service';
import { FollowsService } from '../src/follows/follows.service';
import { FollowsRepository } from '../src/follows/follows.repository';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxEventPublisher } from '../src/outbox/outbox-event.publisher';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import { KafkaProducerService } from '../src/kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '../src/kafka/kafka-topics';
import { ModerationAnalysisScheduler } from '../src/moderation-analysis/moderation-analysis-scheduler.service';
import { ModerationAnalysisInputService } from '../src/moderation-analysis/moderation-analysis-input.service';
import { ModerationAnalysisInternalController } from '../src/moderation-analysis/moderation-analysis-internal.controller';
import { ModerationServiceAuthGuard } from '../src/moderation-analysis/moderation-service-auth.guard';
import { ModerationResultService } from '../src/moderation-analysis/moderation-result.service';
import { ModerationResultConsumer } from '../src/moderation-analysis/moderation-result-consumer.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { isolatedCaseDatabase } from './support/isolated-case-database';

const realModelEnabled = process.env.RUN_MODERATION_REAL_MODEL_LIVE === '1';
const enabled =
  process.env.RUN_MODERATION_WORKER_LIVE === '1' || realModelEnabled;
(enabled ? describe : describe.skip)('Stage 2C local live pipeline', () => {
  jest.setTimeout(180000);
  const prefix = `stage2c-${randomUUID()}`;
  const topics = {
    request: `${prefix}.requests`,
    result: `${prefix}.results`,
    quarantine: `${prefix}.quarantine`,
  };
  const groups = { worker: `${prefix}-worker`, result: `${prefix}-results` };
  const token = 'test-only-' + randomUUID();
  const savedTopics = { ...KAFKA_TOPICS };
  const savedEnv = { ...process.env };
  const children: ChildProcess[] = [];
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let db: PrismaService;
  let app: INestApplication;
  let baseUrl: string;
  let kafka: Kafka;
  let producer: Producer;
  let outboxProducer: KafkaProducerService;
  let resultConsumer: ModerationResultConsumer;
  let dispatcher: OutboxDispatcherService;
  let reporterId: string;
  let authorId: string;
  let outage = 0;
  let inputCalls = 0;

  async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeout = 60000,
  ) {
    const deadline = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  function startWorker(extra: NodeJS.ProcessEnv = {}) {
    const workerRoot = resolve(__dirname, '../../moderation-worker');
    const child = spawn(
      resolve(workerRoot, '.venv/Scripts/python.exe'),
      ['-m', 'tests.live_fault_worker'],
      {
        cwd: workerRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WORKER_ENV: 'local',
          BACKEND_BASE_URL: baseUrl,
          MODERATION_WORKER_TOKEN: token,
          KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT',
          KAFKA_MODERATION_REQUEST_TOPIC: topics.request,
          KAFKA_MODERATION_RESULT_TOPIC: topics.result,
          KAFKA_MODERATION_QUARANTINE_TOPIC: topics.quarantine,
          KAFKA_MODERATION_WORKER_GROUP_ID: groups.worker,
          HTTP_TIMEOUT_SECONDS: '2',
          HTTP_ATTEMPTS: '3',
          RETRY_BASE_SECONDS: '0.1',
          DELIVERY_TIMEOUT_SECONDS: '2',
          ...extra,
        },
      },
    );
    children.push(child);
    // Drain bounded privacy-safe logs; never dump environment or raw process exceptions.
    child.stdout?.resume();
    child.stderr?.resume();
    return child;
  }
  async function expectExit(child: ChildProcess, code = 1) {
    await waitFor(
      () => Promise.resolve(child.exitCode !== null),
      'worker exit',
      30000,
    );
    expect(child.exitCode).toBe(code);
  }
  async function makeUser() {
    return db.user.create({
      data: {
        id: randomUUID(),
        name: 'Isolated fixture',
        email: `${randomUUID()}@example.invalid`,
      },
    });
  }
  async function report(postId: string) {
    const response = await fetch(baseUrl + '/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetType: 'POST',
        targetId: postId,
        reasonCode: 'HARASSMENT',
      }),
    });
    expect(response.status).toBe(201);
    const receipt = (await response.json()) as { caseId: string };
    return receipt.caseId;
  }
  async function dispatch() {
    await (dispatcher as unknown as { dispatch(): Promise<void> }).dispatch();
  }
  async function committedOffset() {
    const admin = kafka.admin();
    await admin.connect();
    try {
      const offsets = await admin.fetchOffsets({
        groupId: groups.worker,
        topics: [topics.request],
      });
      return offsets[0].partitions.reduce(
        (sum, partition) => sum + Math.max(0, Number(partition.offset)),
        0,
      );
    } finally {
      await admin.disconnect();
    }
  }

  beforeAll(async () => {
    const testUrl = process.env.MODERATION_TEST_DATABASE_URL;
    if (
      !testUrl ||
      !['localhost', '127.0.0.1'].includes(new URL(testUrl).hostname)
    )
      throw new Error(
        'Explicit loopback MODERATION_TEST_DATABASE_URL is required',
      );
    process.env.DATABASE_URL = testUrl;
    process.env.MODERATION_WORKER_TOKEN = token;
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_MODERATION_RESULTS_GROUP_ID = groups.result;
    process.env.MODERATION_CLASSIFIER_PROFILE = realModelEnabled
      ? 'toxicity-mmbert-small-v1'
      : 'moderation-text-v1';
    Object.assign(KAFKA_TOPICS, {
      MODERATION_REQUESTS: topics.request,
      MODERATION_RESULTS: topics.result,
    });
    const localDatabase = new Client({ connectionString: testUrl });
    await localDatabase.connect();
    try {
      await localDatabase.query('CREATE EXTENSION IF NOT EXISTS citext');
      await localDatabase.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } finally {
      await localDatabase.end();
    }
    isolated = await isolatedCaseDatabase();
    db = isolated.prisma as PrismaService;
    authorId = (await makeUser()).id;
    reporterId = (await makeUser()).id;
    const outbox = new OutboxRepository(db);
    const publisher = new OutboxEventPublisher(outbox);
    const repository = new ReportsRepository(
      db,
      new ModerationAnalysisScheduler(publisher),
    );
    const visibility = new PostVisibilityService(
      new FollowsService(new FollowsRepository(db), publisher, db),
    );
    const reports = new ReportsService(
      repository,
      visibility,
      new ReportRateLimiterService(),
      db,
    );
    const module = await Test.createTestingModule({
      controllers: [ReportsController, ModerationAnalysisInternalController],
      providers: [
        { provide: ReportsService, useValue: reports },
        {
          provide: ModerationAnalysisInputService,
          useValue: new ModerationAnalysisInputService(db),
        },
        ModerationServiceAuthGuard,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(
      (
        req: Request & { session?: unknown },
        res: Response,
        next: NextFunction,
      ) => {
        if (req.url.startsWith('/internal/')) {
          inputCalls++;
          if (outage > 0) {
            outage--;
            res.status(503).end();
            return;
          }
        }
        req.session = { user: { id: reporterId } }; // Only user session is a fixture; real guard is checked by native HTTP runner.
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    kafka = new Kafka({
      clientId: prefix,
      brokers: ['localhost:9092'],
      logLevel: 0,
    });
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: Object.values(topics).map((topic) => ({
          topic,
          numPartitions: 2,
          configEntries: [{ name: 'retention.ms', value: '3600000' }],
        })),
        waitForLeaders: true,
      });
    } finally {
      await admin.disconnect();
    }
    producer = kafka.producer();
    await producer.connect();
    outboxProducer = new KafkaProducerService();
    outboxProducer.onModuleInit();
    await outboxProducer['startup'].waitForAttempt();
    resultConsumer = new ModerationResultConsumer(
      new ModerationResultService(
        db,
        new ProcessedEventRepository(),
        new ModerationPolicyRepository(db),
      ),
    );
    resultConsumer.onModuleInit();
    await resultConsumer['startup'].waitForAttempt();
    dispatcher = new OutboxDispatcherService(outbox, outboxProducer);
  });
  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill();
        await new Promise<void>((resolve) =>
          child.once('exit', () => resolve()),
        );
      }
    }
    await app?.close();
    await resultConsumer?.onModuleDestroy();
    await outboxProducer?.onModuleDestroy();
    await producer?.disconnect();
    if (kafka) {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.deleteTopics({ topics: Object.values(topics) });
        // Child kill may leave the group active briefly; unique groups expire naturally if still active.
        await admin.deleteGroups(Object.values(groups)).catch(() => undefined);
      } finally {
        await admin.disconnect();
      }
    }
    await isolated?.cleanup();
    Object.assign(KAFKA_TOPICS, savedTopics);
    for (const key of Object.keys(process.env))
      if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });

  (realModelEnabled ? it : it.skip)(
    'one real model report -> immutable HTTP -> Kafka -> stored scores, with no case/content changes',
    async () => {
      const post = await db.post.create({
        data: {
          authorId,
          title: 'Test comment',
          content: 'You are a complete idiot.',
        },
      });
      const caseId = await report(post.id);
      const job = await db.moderationAnalysis.findFirstOrThrow({
        where: { caseId },
      });
      expect(job.status).toBe('PENDING');
      expect(job.classifierProfile).toBe('toxicity-mmbert-small-v1');
      const caseBefore = await db.moderationCase.findUniqueOrThrow({
        where: { id: caseId },
      });
      const postBefore = await db.post.findUniqueOrThrow({
        where: { id: post.id },
      });
      await dispatch();
      startWorker({ CLASSIFIER_BACKEND: 'huggingface', HF_HUB_OFFLINE: '1' });
      await waitFor(
        async () =>
          (
            await db.moderationAnalysis.findUniqueOrThrow({
              where: { id: job.id },
            })
          ).status === 'SUCCEEDED',
        'real model result',
        120000,
      );
      await waitFor(
        async () => (await committedOffset()) >= 1,
        'real model offset commit',
      );
      const completed = await db.moderationAnalysis.findUniqueOrThrow({
        where: { id: job.id },
      });
      const result = completed.result as {
        output: {
          model: { name: string; revision: string };
          labels: Array<{ label: string; score: number }>;
        };
      };
      expect(result.output.model).toEqual({
        name: 'Horizon-Labs/multilingual-toxicity-small',
        revision: '01adcc628a33848569816d4851a38544c321b92c',
      });
      expect(result.output.labels.map(({ label }) => label)).toEqual([
        'toxicity',
        'severe_toxicity',
        'obscene',
        'threat',
        'insult',
        'identity_attack',
        'sexual_explicit',
      ]);
      for (const { score } of result.output.labels) {
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
      expect(
        await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } }),
      ).toEqual(caseBefore);
      expect(
        await db.post.findUniqueOrThrow({ where: { id: post.id } }),
      ).toEqual(postBefore);
    },
  );

  const fixtureTest = realModelEnabled ? it.skip : it;
  fixtureTest('real report -> outbox -> Python -> immutable HTTP -> Kafka -> PostgreSQL, with failures/replay/history', async () => {
    const post = await db.post.create({
      data: { authorId, title: 'fixture title', content: 'fixture-toxic' },
    });
    const caseId = await report(post.id);
    const job = await db.moderationAnalysis.findFirstOrThrow({
      where: { caseId },
    });
    expect(job.status).toBe('PENDING');
    expect(
      await db.outboxEvent.count({
        where: { type: 'moderation.analysis.requested', status: 'PENDING' },
      }),
    ).toBe(1);
    await db.post.update({
      where: { id: post.id },
      data: { content: 'edited live content' },
    });
    await dispatch();
    expect(await db.outboxEvent.count({ where: { status: 'PUBLISHED' } })).toBe(
      1,
    );

    // Real HTTP 401: no offset advancement.
    await expectExit(
      startWorker({
        MODERATION_WORKER_TOKEN: 'invalid-test-' + 'b'.repeat(32),
      }),
    );
    expect(await committedOffset()).toBe(0);
    // Real Kafka delivery timeout: no offset advancement.
    await expectExit(startWorker({ LIVE_TEST_PUBLISH_BROKERS: '127.0.0.1:1' }));
    expect(await committedOffset()).toBe(0);
    expect(
      (await db.moderationAnalysis.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe('PENDING');

    // Backend transient outage and acknowledged result followed by failure before commit.
    outage = 2;
    const callsBefore = inputCalls;
    await expectExit(startWorker({ LIVE_TEST_FAIL_COMMIT: '1' }));
    await waitFor(
      async () =>
        (
          await db.moderationAnalysis.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).status === 'SUCCEEDED',
      'first result',
    );
    expect(inputCalls - callsBefore).toBeGreaterThanOrEqual(3);
    expect(await committedOffset()).toBe(0);
    const completed = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: job.id },
    });
    const output = completed.result as {
      output: { labels: Array<{ label: string; score: number }> };
    };
    expect(output.output.labels).toContainEqual({
      label: 'toxicity',
      score: 0.9,
    });

    startWorker();
    await waitFor(
      async () => (await committedOffset()) >= 1,
      'restart replay committed',
    );
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: job.id } }),
    ).toEqual(completed);
    expect(
      await db.processedEvent.count({
        where: { consumer: 'moderation-results' },
      }),
    ).toBe(1);
    const outbox = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'moderation.analysis.requested' },
    });
    await producer.send({
      topic: topics.request,
      messages: [
        {
          key: caseId,
          value: JSON.stringify({
            eventId: outbox.id,
            type: outbox.type,
            version: outbox.version,
            aggregateId: outbox.aggregateId,
            occurredAt: outbox.occurredAt.toISOString(),
            payload: outbox.payload,
          }),
        },
      ],
    });
    await waitFor(
      async () => (await committedOffset()) >= 2,
      'duplicate delivery committed',
    );
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: job.id } }),
    ).toEqual(completed);

    // Multiple processes share the two request partitions; joining forces a real rebalance.
    startWorker();
    await waitFor(async () => {
      const admin = kafka.admin();
      await admin.connect();
      try {
        const description = await admin.describeGroups([groups.worker]);
        return (
          description.groups[0].state === 'Stable' &&
          description.groups[0].members.length === 2
        );
      } finally {
        await admin.disconnect();
      }
    }, 'two worker instances assigned');

    await resultConsumer.onModuleDestroy();
    reporterId = (await makeUser()).id;
    expect(await report(post.id)).toBe(caseId);
    await dispatch();
    const newer = await db.moderationAnalysis.findFirstOrThrow({
      where: { caseId, generation: 2 },
    });
    await waitFor(
      async () => (await committedOffset()) >= 3,
      'result retained while backend consumer is offline',
    );
    expect(
      (
        await db.moderationAnalysis.findUniqueOrThrow({
          where: { id: newer.id },
        })
      ).status,
    ).toBe('PENDING');
    resultConsumer = new ModerationResultConsumer(
      new ModerationResultService(
        db,
        new ProcessedEventRepository(),
        new ModerationPolicyRepository(db),
      ),
    );
    resultConsumer.onModuleInit();
    await resultConsumer['startup'].waitForAttempt();
    await waitFor(
      async () =>
        (
          await db.moderationAnalysis.findUniqueOrThrow({
            where: { id: newer.id },
          })
        ).status === 'SUCCEEDED',
      'new generation',
    );
    const newerCompleted = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: newer.id },
    });
    const beforeCase = await db.moderationCase.findUniqueOrThrow({
      where: { id: caseId },
    });
    const oldResultId = randomUUID();
    const now = new Date().toISOString();
    await producer.send({
      topic: topics.result,
      messages: [
        {
          key: caseId,
          value: JSON.stringify({
            eventId: oldResultId,
            type: 'moderation.result',
            version: 1,
            aggregateId: caseId,
            occurredAt: now,
            payload: {
              analysisJobId: job.id,
              caseId,
              generation: 1,
              snapshotHash: job.snapshotHash,
              classifierProfile: job.classifierProfile,
              status: 'FAILED',
              errorCode: 'CLASSIFIER_ERROR',
              completedAt: now,
            },
          }),
        },
      ],
    });
    await waitFor(
      async () =>
        (await db.processedEvent.count({ where: { eventId: oldResultId } })) ===
        1,
      'stale replay',
    );
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: job.id } }),
    ).toEqual(completed);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({
        where: { id: newer.id },
      }),
    ).toEqual(newerCompleted);
    expect(
      await db.moderationCase.findUniqueOrThrow({ where: { id: caseId } }),
    ).toEqual(beforeCase);

    await producer.send({
      topic: topics.request,
      messages: [{ key: caseId, value: '{ invalid request fixture' }],
    });
    await waitFor(
      async () => (await committedOffset()) >= 4,
      'poison request quarantined and committed',
    );
    const admin = kafka.admin();
    await admin.connect();
    try {
      const offsets = await admin.fetchTopicOffsets(topics.quarantine);
      expect(
        offsets.reduce((sum, partition) => sum + Number(partition.high), 0),
      ).toBe(1);
    } finally {
      await admin.disconnect();
    }
  });
});
