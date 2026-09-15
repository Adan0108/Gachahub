import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { FollowsModule } from '../follows/follows.module';
import { RecommendationModule } from '../recommendation/recommendation.module';

@Module({
  imports: [FollowsModule, RecommendationModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository],
  exports: [CommentsService],
})
export class CommentsModule {}
