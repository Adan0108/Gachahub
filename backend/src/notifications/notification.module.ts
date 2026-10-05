import { Module } from '@nestjs/common';

import { CommentsModule } from '../comments/comments.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationConsumerService } from './notification-consumer.service';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { ProcessedEventRepository } from './processed-event.repository';
import { SocketNotificationDeliveryService } from './realtime/socket-notification-delivery.service';

@Module({
  imports: [WebsocketModule, CommentsModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    ProcessedEventRepository,
    NotificationConsumerService,
    SocketNotificationDeliveryService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
