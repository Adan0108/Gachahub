import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { QueryCaseAssigneesDto } from '../reports/dto/query-case-assignees.dto';
import { PlatformModeratorsService } from './platform-moderators.service';

@ApiTags('Platform Moderators')
@ApiCookieAuth('better-auth.session_token')
@UseGuards(AdminGuard)
@Controller('platform-moderators')
export class PlatformModeratorsController {
  constructor(private readonly moderators: PlatformModeratorsService) {}

  @Get('candidates')
  @ApiOperation({
    summary: 'Search active users and platform moderators. Admin only.',
  })
  search(
    @Session() session: UserSession,
    @Query() query: QueryCaseAssigneesDto,
  ) {
    return this.moderators.search(session.user.id, query.q);
  }

  @Post(':userId')
  @ApiOperation({
    summary:
      'Grant platform moderator access to an active ordinary user. Admin only.',
  })
  grant(@Session() session: UserSession, @Param('userId') userId: string) {
    return this.moderators.change(session.user.id, userId, true);
  }

  @Delete(':userId')
  @ApiOperation({
    summary:
      'Remove platform moderator access; keep user and game assignments. Admin only.',
  })
  revoke(@Session() session: UserSession, @Param('userId') userId: string) {
    return this.moderators.change(session.user.id, userId, false);
  }
}
