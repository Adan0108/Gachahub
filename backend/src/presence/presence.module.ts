import { Module } from '@nestjs/common';
import { WebsocketModule } from '../websocket/websocket.module';
import { PresenceController } from './presence.controller';
import { PresenceExpiryService } from './presence-expiry.service';
import { PresenceGateway } from './presence.gateway';
import { PresenceRepository } from './presence.repository';
import { PresenceService } from './presence.service';
import { PresenceStore } from './presence.store';

/** Online and invisible status, shown live to the people you chat with. */
@Module({
  imports: [WebsocketModule],
  controllers: [PresenceController],
  providers: [
    PresenceStore,
    PresenceRepository,
    PresenceService,
    PresenceExpiryService,
    PresenceGateway,
  ],
})
export class PresenceModule {}
