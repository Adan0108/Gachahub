import { Module } from '@nestjs/common';
import { FollowsController } from './follows.controller';
import { FollowsRepository } from './follows.repository';
import { FollowsService } from './follows.service';

@Module({
  controllers: [FollowsController],

  providers: [FollowsRepository, FollowsService],

  exports: [FollowsService],
})
export class FollowsModule {}
