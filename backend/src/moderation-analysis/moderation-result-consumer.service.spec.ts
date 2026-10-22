import type { EachMessagePayload } from 'kafkajs';
import { ModerationResultConsumer } from './moderation-result-consumer.service';
import { ModerationResultService } from './moderation-result.service';

const connect = jest.fn().mockResolvedValue(undefined);
const subscribe = jest.fn().mockResolvedValue(undefined);
const run = jest.fn().mockResolvedValue(undefined);
const disconnect = jest.fn().mockResolvedValue(undefined);
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: () => ({ connect, subscribe, run, disconnect }),
  })),
}));

describe('moderation result consumer', () => {
  const oldBrokers = process.env.KAFKA_BROKERS;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KAFKA_BROKERS = 'localhost:9092';
  });
  afterAll(() => {
    if (oldBrokers === undefined) delete process.env.KAFKA_BROKERS;
    else process.env.KAFKA_BROKERS = oldBrokers;
  });
  function message(value: string | null) {
    return {
      message: { value: value === null ? null : Buffer.from(value) },
    } as EachMessagePayload;
  }
  function valid() {
    return {
      eventId: '11111111-1111-4111-8111-111111111111',
      type: 'moderation.result',
      version: 1,
      aggregateId: 'case',
      occurredAt: '2026-10-22T00:00:00Z',
      payload: {
        caseId: 'case',
        analysisJobId: 'job',
        generation: 1,
        snapshotHash: `sha256:${'a'.repeat(64)}`,
        classifierProfile: 'moderation-text-v1',
        status: 'FAILED',
        errorCode: 'MODEL_TIMEOUT',
        completedAt: '2026-10-22T00:00:00Z',
      },
    };
  }
  it.each([
    null,
    '{ private moderation content',
    ' '.repeat(32769),
    JSON.stringify({ ...valid(), version: 2 }),
    JSON.stringify({ ...valid(), aggregateId: 'wrong' }),
  ])('drops invalid input without calling persistence %#', async (raw) => {
    const ingest = jest.fn();
    const consumer = new ModerationResultConsumer({
      ingest,
    } as unknown as ModerationResultService);
    const warn = jest
      .spyOn(consumer['logger'], 'warn')
      .mockImplementation(() => undefined);
    await consumer.handleMessage(message(raw));
    expect(ingest).not.toHaveBeenCalled();
    if (raw !== null)
      expect(warn).toHaveBeenCalledWith('Skipping invalid moderation result');
  });
  it('passes validated input and propagates persistence errors for retry', async () => {
    const ingest = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined);
    const consumer = new ModerationResultConsumer({
      ingest,
    } as unknown as ModerationResultService);
    await expect(
      consumer.handleMessage(message(JSON.stringify(valid()))),
    ).rejects.toThrow('Moderation result persistence failed');
    await consumer.handleMessage(message(JSON.stringify(valid())));
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenLastCalledWith(valid());
  });
  it('subscribes to real topic and disconnects via shared lifecycle helper', async () => {
    const consumer = new ModerationResultConsumer(
      {} as ModerationResultService,
    );
    consumer.onModuleInit();
    await consumer['startup'].waitForAttempt();
    expect(subscribe).toHaveBeenCalledWith({
      topics: ['gachahub.moderation.results'],
    });
    expect(run).toHaveBeenCalled();
    await consumer.onModuleDestroy();
    expect(disconnect).toHaveBeenCalled();
  });
});
