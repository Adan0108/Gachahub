import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostModerationController } from './post-moderation.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostModerationService } from './post-moderation.service';
import { MediaModule } from '../media/media.module';
import { FollowsModule } from '../follows/follows.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';

@Module({
  imports: [
    MediaModule,
    FollowsModule,
    RecommendationModule,
    GameModeratorsModule,
  ],
  controllers: [PostsController, PostModerationController],
  providers: [PostsService, PostsRepository, PostModerationService],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
