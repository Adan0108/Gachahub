import { randomUUID } from 'node:crypto';

import {
  type DomainEventOf,
  type DomainEventPayloadMap,
  type DomainEventType,
} from './domain-event.types';

const DEFAULT_EVENT_VERSION = 1;

export function createDomainEvent<TType extends DomainEventType>(params: {
  type: TType;
  aggregateId: string;
  payload: DomainEventPayloadMap[TType];

  /**
   * Override only when publishing a newer version
   * of an existing event contract.
   */
  version?: number;
}): DomainEventOf<TType> {
  return {
    eventId: randomUUID(),
    type: params.type,
    version: params.version ?? DEFAULT_EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    aggregateId: params.aggregateId,
    payload: params.payload,
  };
}
