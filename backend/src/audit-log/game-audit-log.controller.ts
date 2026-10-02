import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AuditLogQueryService } from './audit-log-query.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** No guard: the service authorizes against the routed game (same as ReportModerationController). */
@ApiTags('Audit Log')
@ApiCookieAuth('better-auth.session_token')
@Controller('games/:gameSlug/audit-logs')
export class GameAuditLogController {
  constructor(private readonly auditLogQueryService: AuditLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit entries for this game. Admin or game moderator only.',
  })
  @ApiParam({ name: 'gameSlug', example: 'wuthering-waves' })
  list(
    @Param('gameSlug') gameSlug: string,
    @Query() query: QueryAuditLogsDto,
    @Session() session: UserSession,
  ) {
    return this.auditLogQueryService.listForModerator(
      gameSlug,
      session.user.id,
      query,
    );
  }
}
