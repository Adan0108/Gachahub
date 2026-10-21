import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';

import type { DomainEventType } from '../domain-events/domain-event.types';
import { resolveDomainEventTopic } from './kafka-topics';
import { KafkaBackgroundStart } from './kafka-background-start';

export interface KafkaDomainEvent {
  eventId: string;
  type: DomainEventType;
  version: number;
  occurredAt: string;
  aggregateId: string;
  payload: unknown;
}

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);

  private readonly producer: Producer;
  private readonly startup: KafkaBackgroundStart;

  get isConnected(): boolean {
    return this.startup.connected;
  }

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
    this.startup = new KafkaBackgroundStart(
      () => this.producer.connect(),
      () => this.producer.disconnect(),
      this.logger,
    );
  }

  onModuleInit(): void {
    this.startup.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.startup.stop();

    this.logger.log('Kafka producer disconnected');
  }

  async publish(event: KafkaDomainEvent): Promise<void> {
    await this.startup.waitForAttempt();
    if (!this.isConnected) throw new Error('Kafka producer is not connected');
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
