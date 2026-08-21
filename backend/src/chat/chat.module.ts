import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { NoopChatDeliveryService } from './noop-chat-delivery.service';
import { OpaqueMessageEncryptionService } from './opaque-message-encryption.service';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { CommonModule } from '../common/common.module';
import { FollowsModule } from '../follows/follows.module';
import { GamesModule } from '../games/games.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';

/**
 * Chat feature module.
 *
 * This module wires the HTTP controller, business service, database repository,
 * and replaceable adapter ports used by the chat system.
 */
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    FollowsModule,
    GamesModule,
    GameModeratorsModule,
  ],
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
