jest.mock('kafkajs', () => ({ Kafka: jest.fn() }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { Kafka } from 'kafkajs';
import { Test } from '@nestjs/testing';
import { KafkaProducerService } from './kafka-producer.service';
import { NotificationConsumerService } from '../notifications/notification-consumer.service';
import { NotificationService } from '../notifications/notification.service';
import { ProcessedEventRepository } from '../notifications/processed-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { SocketNotificationDeliveryService } from '../notifications/realtime/socket-notification-delivery.service';
import { OutboxDispatcherService } from '../outbox/outbox-dispatcher.service';
import { OutboxRepository } from '../outbox/outbox.repository';

describe('Kafka-down Nest lifecycle', () => {
  it('boots HTTP while both connections are unfinished; leaves outbox unclaimed and publishes after recovery', async () => {
    process.env.KAFKA_BROKERS = 'localhost:1';
    let connectProducer!: () => void;
    let connectConsumer!: () => void;
    const producer = {
      connect: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            connectProducer = resolve;
          }),
      ),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
    };
    const consumer = {
      connect: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            connectConsumer = resolve;
          }),
      ),
      disconnect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
    };
    jest.mocked(Kafka).mockImplementation(
      () =>
        ({
          producer: () => producer,
          consumer: () => consumer,
        }) as unknown as Kafka,
    );
    const module = await Test.createTestingModule({
      providers: [
        KafkaProducerService,
        NotificationConsumerService,
        ...[
          NotificationService,
          ProcessedEventRepository,
          PrismaService,
          SocketNotificationDeliveryService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const outbox = {
        recoverStaleProcessing: jest.fn().mockResolvedValue({ count: 0 }),
        findReady: jest.fn(),
        claim: jest.fn().mockResolvedValue(true),
        markPublished: jest.fn().mockResolvedValue(undefined),
      };
      const kafka = app.get(KafkaProducerService);
      const dispatcher = new OutboxDispatcherService(
        outbox as unknown as OutboxRepository,
        kafka,
      );
      await dispatcher['dispatch']();
      expect(outbox.findReady).not.toHaveBeenCalled();
      expect(outbox.claim).not.toHaveBeenCalled();
      connectProducer();
      connectConsumer();
      await kafka['startup'].waitForAttempt();
      await app.get(NotificationConsumerService)['startup'].waitForAttempt();
      const event = {
        id: 'event',
        type: 'moderation.analysis.requested',
        version: 1,
        aggregateId: 'case',
        payload: { analysisJobId: 'job' },
        occurredAt: new Date(),
        attemptCount: 0,
      };
      outbox.findReady.mockResolvedValue([event]);
      await dispatcher['dispatch']();
      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'gachahub.moderation.requests',
          messages: [expect.objectContaining({ key: 'case' })],
        }),
      );
      expect(outbox.markPublished).toHaveBeenCalledWith('event');
      expect(consumer.subscribe).toHaveBeenCalledWith({
        topics: ['gachahub.posts', 'gachahub.social', 'gachahub.chat'],
      });
    } finally {
      connectProducer();
      connectConsumer();
      await app.close();
    }
  });
});
