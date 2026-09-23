import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';

import type { DomainEvent } from '../domain-events/domain-event.types';
import { resolveDomainEventTopic } from './kafka-topics';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);

  private readonly producer: Producer;

  constructor() {
    const brokers = process.env.KAFKA_BROKERS?.split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);

    const clientId = process.env.KAFKA_CLIENT_ID ?? 'gachahub-backend';

    if (!brokers || brokers.length === 0) {
      throw new Error('KAFKA_BROKERS is missing');
    }

    const kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        retries: 8,
      },
    });

    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();

    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();

    this.logger.log('Kafka producer disconnected');
  }

  async publish(event: DomainEvent): Promise<void> {
    const topic = resolveDomainEventTopic(event.type);

    await this.producer.send({
      topic,
      acks: -1,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            eventId: event.eventId,
            eventType: event.type,
            eventVersion: String(event.version),
          },
        },
      ],
    });
  }
}
