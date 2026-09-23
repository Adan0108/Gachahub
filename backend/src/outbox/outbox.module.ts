import { Module } from '@nestjs/common';

import { OutboxEventPublisher } from './outbox-event.publisher';
import { OutboxRepository } from './outbox.repository';

@Module({
  providers: [OutboxRepository, OutboxEventPublisher],
  exports: [OutboxEventPublisher],
})
export class OutboxModule {}
