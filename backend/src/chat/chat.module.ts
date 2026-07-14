import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { NoopChatDeliveryService } from './noop-chat-delivery.service';
import { OpaqueMessageEncryptionService } from './opaque-message-encryption.service';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';

@Module({
  imports: [PrismaModule],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatService,
    {
      provide: MESSAGE_ENCRYPTION_PORT,
      useClass: OpaqueMessageEncryptionService,
    },
    {
      provide: CHAT_DELIVERY_PORT,
      useClass: NoopChatDeliveryService,
    },
  ],
})
export class ChatModule {}
