import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PostModerationService } from './post-moderation.service';

@ApiTags('Posts')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/posts')
@UseGuards(AdminGuard)
export class AdminPostModerationController {
  constructor(private readonly moderation: PostModerationService) {}

  @Patch(':id/hide')
  hide(@Param('id') id: string, @Session() session: UserSession) {
    return this.moderation.setPersonalStatus(id, session.user.id, true);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @Session() session: UserSession) {
    return this.moderation.setPersonalStatus(id, session.user.id, false);
  }
}
