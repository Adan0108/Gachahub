import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/guards/admin.guard';
import { ContentModerationService } from './content-moderation.service';
import { QueryContentModerationDto } from './dto/query-content-moderation.dto';

/**
 * Cross-game flagged-content listing. Purely an admin action with no other
 * permission check inside it, so a guard here is the right fit (same
 * pattern as AdminReportsController/AdminUsersController). Hiding or
 * restoring an item found here still goes through the existing per-game
 * routes (games/:gameSlug/posts/:postId/hide, .../comments/:commentId/hide)
 * - this controller only has to tell the frontend which gameSlug to use.
 */
@ApiTags('Content Moderation')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/content')
@UseGuards(AdminGuard)
export class AdminContentController {
  constructor(
    private readonly contentModerationService: ContentModerationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List reported posts and comments across every game. Admin only.',
  })
  list(@Query() query: QueryContentModerationDto) {
    return this.contentModerationService.listFlagged(query);
  }
}
