import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { RecommendationModule } from '../recommendation/recommendation.module';

@Module({
  imports: [PostVisibilityModule, RecommendationModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository],
  exports: [CommentsService],
})
export class CommentsModule {}
