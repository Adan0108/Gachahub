import { OutboxDispatcherService } from './outbox-dispatcher.service';
import type { OutboxRepository } from './outbox.repository';
import type { KafkaProducerService } from '../kafka/kafka-producer.service';

const event = (id: string) => ({
  id,
  type: 'chat.message.sent',
  version: 1,
  aggregateId: 'conversation-1',
  payload: {},
  occurredAt: new Date('2026-10-22T10:00:00.000Z'),
  attemptCount: 0,
});

// #105: one tick used to send at most 20 events, every 2 s, however many were waiting.
describe('OutboxDispatcherService', () => {
  const repository = {
    recoverStaleProcessing: jest.fn(),
    findReady: jest.fn(),
    claim: jest.fn(),
    markPublished: jest.fn(),
    markFailed: jest.fn(),
    markForRetry: jest.fn(),
  };
  const kafka = { publish: jest.fn() };
  const dispatch = (service: OutboxDispatcherService) =>
    (service as unknown as { dispatch: () => Promise<void> }).dispatch();

  let service: OutboxDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.recoverStaleProcessing.mockResolvedValue({ count: 0 });
    repository.claim.mockResolvedValue(true);
    service = new OutboxDispatcherService(
      repository as unknown as OutboxRepository,
      kafka as unknown as KafkaProducerService,
    );
  });

  it('keeps sending while full batches keep coming, in one tick', async () => {
    const full = Array.from({ length: 20 }, (_, i) => event(`e${i}`));
    repository.findReady
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce(
        full.map((item) => ({ ...item, id: `f${item.id}` })),
      )
      .mockResolvedValueOnce([event('last')]);

    await dispatch(service);

    expect(repository.findReady).toHaveBeenCalledTimes(3);
    expect(kafka.publish).toHaveBeenCalledTimes(41);
    expect(repository.markPublished).toHaveBeenCalledTimes(41);
  });

  it('stops after one short batch, leaving the rest of the wait to the next tick', async () => {
    repository.findReady.mockResolvedValue([event('e1')]);

    await dispatch(service);

    expect(repository.findReady).toHaveBeenCalledTimes(1);
  });

  it('never runs more than 50 batches in one tick', async () => {
    const full = Array.from({ length: 20 }, (_, i) => event(`e${i}`));
    repository.findReady.mockResolvedValue(full);

    await dispatch(service);

    expect(repository.findReady).toHaveBeenCalledTimes(50);
  });
});
