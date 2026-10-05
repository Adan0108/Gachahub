import { Module } from '@nestjs/common';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { CommentModerationController } from './comment-moderation.controller';
import { CommentModerationService } from './comment-moderation.service';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  imports: [
    PostVisibilityModule,
    RecommendationModule,
    GameModeratorsModule,
    AuditLogModule,
    DomainEventsModule,
    MentionsModule,
  ],
  controllers: [CommentsController, CommentModerationController],
  providers: [CommentsService, CommentsRepository, CommentModerationService],
  exports: [CommentsService, CommentsRepository],
})
export class CommentsModule {}
