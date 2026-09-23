import { Module } from '@nestjs/common';

import { DomainEventsModule } from '../domain-events/domain-events.module';
import { FollowsController } from './follows.controller';
import { FollowsRepository } from './follows.repository';
import { FollowsService } from './follows.service';

@Module({
  imports: [DomainEventsModule],
  controllers: [FollowsController],
  providers: [FollowsRepository, FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
