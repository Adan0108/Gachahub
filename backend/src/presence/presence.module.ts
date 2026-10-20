import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { ChatModule } from '../chat/chat.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { PresenceController } from './presence.controller';
import { PresenceExpiryService } from './presence-expiry.service';
import { PresenceGateway } from './presence.gateway';
import { PresenceAudienceService } from './presence-audience.service';
import { PresenceRedisStore } from './presence-redis.store';
import { PresenceService } from './presence.service';

/** Online and invisible status, shown live to the people you chat with. */
@Module({
  imports: [WebsocketModule, ChatModule, BlocksModule],
  controllers: [PresenceController],
  providers: [
    PresenceRedisStore,
    PresenceAudienceService,
    PresenceService,
    PresenceExpiryService,
    PresenceGateway,
  ],
})
export class PresenceModule {}
