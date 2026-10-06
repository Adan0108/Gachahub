import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostModerationController } from './moderation/post-moderation.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostModerationService } from './moderation/post-moderation.service';
import { MediaModule } from '../media/media.module';
import { PostVisibilityModule } from '../post-visibility/post-visibility.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { GameModeratorsModule } from '../game-moderators/game-moderators.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { MentionsModule } from '../mentions/mentions.module';
import { PostSaveController } from './save/post-save.controller';
import { PostSaveService } from './save/post-save.service';
import { PostSaveRepository } from './save/post-save.repository';

@Module({
  imports: [
    MediaModule,
    PostVisibilityModule,
    RecommendationModule,
    GameModeratorsModule,
    AuditLogModule,
    DomainEventsModule,
    MentionsModule,
  ],
  controllers: [PostSaveController, PostsController, PostModerationController],
  providers: [
    PostsService,
    PostsRepository,
    PostModerationService,
    PostSaveService,
    PostSaveRepository,
  ],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
