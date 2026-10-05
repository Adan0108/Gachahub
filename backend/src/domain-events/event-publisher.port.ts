import type { Prisma } from '../generated/prisma/client';
import type {
  DomainEventPayloadMap,
  DomainEventType,
} from './domain-event.types';

export type PublishDomainEventInput<T extends DomainEventType> = {
  type: T;
  aggregateId: string;
  payload: DomainEventPayloadMap[T];
};

/**
 * Transport-agnostic domain event publisher.
 *
 * Business services depend on this abstraction rather than
 * Kafka, RabbitMQ, NATS, or any concrete message broker.
 *
 * Transport-agnostic domain event publisher.
 *
 * Business services only describe what happened.
 * The concrete publisher decides how the final event envelope is created
 * and persisted/transmitted.
 */
export abstract class EventPublisherPort {
  abstract publish<T extends DomainEventType>(
    input: PublishDomainEventInput<T>,
    transaction: Prisma.TransactionClient,
  ): Promise<void>;

  /** Batched version of `publish` for a fan-out (e.g. one event per group member) - avoids N sequential inserts in one transaction. */
  abstract publishMany<T extends DomainEventType>(
    inputs: ReadonlyArray<PublishDomainEventInput<T>>,
    transaction: Prisma.TransactionClient,
  ): Promise<void>;
}
