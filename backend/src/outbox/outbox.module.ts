import { Module } from '@nestjs/common';

import { KafkaModule } from '../kafka/kafka.module';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxEventPublisher } from './outbox-event.publisher';
import { OutboxRepository } from './outbox.repository';

@Module({
  imports: [KafkaModule],
  providers: [OutboxRepository, OutboxEventPublisher, OutboxDispatcherService],
  exports: [OutboxEventPublisher],
})
export class OutboxModule {}
