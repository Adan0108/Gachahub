import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { ChatTypingGateway } from './chat-typing.gateway';
import { ChatTypingService } from './chat-typing.service';
import { SocketChatDeliveryService } from './socket-chat-delivery.service';
import { OpaqueMessageEncryptionService } from './opaque-message-encryption.service';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { CommonModule } from '../common/common.module';
import { FollowsModule } from '../follows/follows.module';
import { GamesModule } from '../games/games.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { BlocksModule } from '../blocks/blocks.module';

/**
 * Chat feature module.
 *
 * This module wires the HTTP controller, business service, database repository,
 * and replaceable adapter ports used by the chat system.
 */
@Module({
  imports: [
    PrismaModule,
    WebsocketModule,
    CommonModule,
    FollowsModule,
    GamesModule,
    GameModeratorsModule,
    BlocksModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatService,
    ChatTypingGateway,
    ChatTypingService,
    {
      provide: CHAT_DELIVERY_PORT,
      useClass: SocketChatDeliveryService,
    },
    {
      provide: MESSAGE_ENCRYPTION_PORT,
      useClass: OpaqueMessageEncryptionService,
    },
  ],
})
export class ChatModule {}
