import { Module } from '@nestjs/common';

import { BlocksModule } from '../blocks/blocks.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ProfileAccessModule } from '../profile-access/profile-access.module';
import { FollowsController } from './follows.controller';
import { FollowsRepository } from './follows.repository';
import { FollowsService } from './follows.service';

@Module({
  imports: [DomainEventsModule, BlocksModule, ProfileAccessModule],
  controllers: [FollowsController],
  providers: [FollowsRepository, FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
