import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FollowsModule } from '../follows/follows.module';
import { BlocksModule } from '../blocks/blocks.module';
import { CommonModule } from '../common/common.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { MlsGroupRosterModule } from '../mls-group-roster/mls-group-roster.module';
import { ChatDevicesController } from './chat-devices.controller';
import { ChatDevicesService } from './chat-devices.service';
import { ChatDevicesRepository } from './chat-devices.repository';
import { KeyPackageFetchRateLimiterService } from './key-package-fetch-rate-limiter.service';
import { KeyPackageUploadRateLimiterService } from './key-package-upload-rate-limiter.service';
import { MlsKeyPackageCleanupService } from './mls-key-package-cleanup.service';

@Module({
  imports: [
    PrismaModule,
    FollowsModule,
    BlocksModule,
    CommonModule,
    MlsGroupRosterModule,
    WebsocketModule,
  ],
  controllers: [ChatDevicesController],
  providers: [
    ChatDevicesService,
    ChatDevicesRepository,
    KeyPackageFetchRateLimiterService,
    KeyPackageUploadRateLimiterService,
    MlsKeyPackageCleanupService,
  ],
  exports: [ChatDevicesService],
})
export class ChatDevicesModule {}
