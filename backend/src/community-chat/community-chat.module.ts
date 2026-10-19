import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { MediaModule } from '../media/media.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { CommunityAccessService } from './community-access.service';
import { CommunityActionsService } from './community-actions.service';
import { CommunityChannelsService } from './community-channels.service';
import { CommunityChatGateway } from './community-chat.gateway';
import { CommunityChatController } from './community-chat.controller';
import { CommunityChatRateLimiterService } from './community-chat-rate-limiter.service';
import { CommunityChatRepository } from './community-chat.repository';
import { CommunityMessagePresenter } from './community-message.presenter';
import { CommunityMessagingService } from './community-messaging.service';
import { CommunityRealtimeService } from './community-realtime.service';

/** Public chat rooms for game communities; plaintext so moderators can read and remove messages. */
@Module({
  imports: [BlocksModule, GameModeratorsModule, MediaModule, WebsocketModule],
  controllers: [CommunityChatController],
  providers: [
    CommunityChatRepository,
    CommunityAccessService,
    CommunityMessagePresenter,
    CommunityChannelsService,
    CommunityMessagingService,
    CommunityActionsService,
    CommunityChatRateLimiterService,
    CommunityRealtimeService,
    CommunityChatGateway,
  ],
})
export class CommunityChatModule {}
