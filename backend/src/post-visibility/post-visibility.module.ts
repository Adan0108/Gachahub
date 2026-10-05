import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module';
import { PostVisibilityService } from './post-visibility.service';

@Module({
  imports: [FollowsModule],
  providers: [PostVisibilityService],
  exports: [PostVisibilityService],
})
export class PostVisibilityModule {}
