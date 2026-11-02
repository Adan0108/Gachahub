import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestOriginInterceptor } from '../common/security/request-origin.interceptor';
import { OutboxModule } from '../outbox/outbox.module';
import { PostsRepository } from '../posts/posts.repository';
import { CommentsRepository } from '../comments/comments.repository';
import { EnforcementService } from './enforcement.service';
import {
  EnforcementController,
  MyModerationController,
} from './enforcement.controller';
import { SanctionAccessService } from './sanction-access.service';
import { SanctionInterceptor } from './sanction.interceptor';
import { SanctionExpirationService } from './expiration.service';

@Global()
@Module({
  imports: [OutboxModule],
  controllers: [EnforcementController, MyModerationController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestOriginInterceptor },
    EnforcementService,
    PostsRepository,
    CommentsRepository,
    SanctionAccessService,
    SanctionExpirationService,
    { provide: APP_INTERCEPTOR, useClass: SanctionInterceptor },
  ],
  exports: [EnforcementService, SanctionAccessService],
})
export class EnforcementModule {}
