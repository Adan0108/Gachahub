import type { DomainEvent } from './domain-event.types';
import type { Prisma } from '../generated/prisma/client';

/**
 * Transport-agnostic domain event publisher.
 *
 * Business services depend on this abstraction rather than
 * Kafka, RabbitMQ, NATS, or any concrete message broker.
 */
export abstract class EventPublisherPort {
  abstract publish(
    event: DomainEvent,
    transaction: Prisma.TransactionClient,
  ): Promise<void>;
}
