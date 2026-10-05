import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module';
import { PostsModule } from '../posts/posts.module';
import { FeedController, GameFeedController } from './feed.controller';
import { FeedRankerService } from './feed-ranker.service';
import { FeedRepository } from './feed.repository';
import { FeedService } from './feed.service';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { TrendingSnapshotService } from './trending/trending-snapshot.service';
import { ForYouSnapshotService } from './for-you/for-you-snapshot.service';

@Module({
  imports: [PostsModule, FollowsModule, RecommendationModule],

  controllers: [FeedController, GameFeedController],

  providers: [
    FeedRepository,
    FeedRankerService,
    FeedService,
    TrendingSnapshotService,
    ForYouSnapshotService,
  ],

  exports: [FeedService],
})
export class FeedModule {}
