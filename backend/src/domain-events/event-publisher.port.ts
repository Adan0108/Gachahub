import type { DomainEvent } from './domain-event.types';

/**
 * Transport-agnostic domain event publisher.
 *
 * Business services depend on this abstraction rather than
 * Kafka, RabbitMQ, NATS, or any concrete message broker.
 */
export abstract class EventPublisherPort {
  abstract publish(event: DomainEvent): Promise<void>;
}
