import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { ChatMessagingService } from './chat-messaging.service';
import { ChatGroupService } from './chat-group.service';
import { ChatInboxService } from './chat-inbox.service';
import { ChatMessageActionsService } from './chat-message-actions.service';
import { ChatMediaReleaseRetryService } from './chat-media-release-retry.service';
import { ChatTypingGateway } from './realtime/chat-typing.gateway';
import { ChatTypingService } from './realtime/chat-typing.service';
import { ChatMessageRateLimiterService } from './chat-message-rate-limiter.service';
import { ChatHistoryFetchRateLimiterService } from './chat-history-fetch-rate-limiter.service';
import { SocketChatDeliveryService } from './realtime/socket-chat-delivery.service';
import { OpaqueMessageEncryptionService } from './opaque-message-encryption.service';
import { CHAT_DELIVERY_PORT } from './ports/chat-delivery.port';
import { MESSAGE_ENCRYPTION_PORT } from './ports/message-encryption.port';
import { CommonModule } from '../common/common.module';
import { FollowsModule } from '../follows/follows.module';
import { GamesModule } from '../games/games.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { BlocksModule } from '../blocks/blocks.module';
import { MediaModule } from '../media/media.module';
import { MlsGroupRosterModule } from '../mls-group-roster/mls-group-roster.module';
import { ChatDevicesModule } from '../chat-devices/chat-devices.module';
import { ChatMembershipRepository } from './membership/chat-membership.repository';
import { ChatMembershipService } from './membership/chat-membership.service';
import { ChatInviteExpiryService } from './membership/chat-invite-expiry.service';

/**
 * Chat feature module.
 *
 * This module wires the HTTP controller, business services (split by
 * concern: access/permissions, messaging, group management, inbox, and
 * message actions), database repository, and replaceable adapter ports
 * used by the chat system.
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
    MediaModule,
    MlsGroupRosterModule,
    ChatDevicesModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatAccessService,
    ChatMessagingService,
    ChatMembershipRepository,
    ChatMembershipService,
    ChatInviteExpiryService,
    ChatGroupService,
    ChatInboxService,
    ChatMessageActionsService,
    ChatMediaReleaseRetryService,
    ChatTypingGateway,
    ChatTypingService,
    ChatMessageRateLimiterService,
    ChatHistoryFetchRateLimiterService,
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
