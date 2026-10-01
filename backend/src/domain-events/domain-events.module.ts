import { Module } from '@nestjs/common';

import { OutboxEventPublisher } from '../outbox/outbox-event.publisher';
import { OutboxModule } from '../outbox/outbox.module';
import { EventPublisherPort } from './event-publisher.port';

@Module({
  imports: [OutboxModule],

  providers: [
    {
      provide: EventPublisherPort,
      useExisting: OutboxEventPublisher,
    },
  ],

  exports: [EventPublisherPort],
})
export class DomainEventsModule {}
