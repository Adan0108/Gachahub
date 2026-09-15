import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FollowsModule } from '../follows/follows.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ChatDevicesController } from './chat-devices.controller';
import { ChatDevicesService } from './chat-devices.service';
import { ChatDevicesRepository } from './chat-devices.repository';
import { KeyPackageFetchRateLimiterService } from './key-package-fetch-rate-limiter.service';

@Module({
  imports: [PrismaModule, FollowsModule, BlocksModule],
  controllers: [ChatDevicesController],
  providers: [
    ChatDevicesService,
    ChatDevicesRepository,
    KeyPackageFetchRateLimiterService,
  ],
  exports: [ChatDevicesService],
})
export class ChatDevicesModule {}
