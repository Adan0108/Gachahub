import { Module } from '@nestjs/common';

import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';

@Module({
  imports: [PostVisibilityModule, RecommendationModule, DomainEventsModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository],
  exports: [CommentsService],
})
export class CommentsModule {}
