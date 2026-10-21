import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { QueryPresenceDto } from './dto/query-presence.dto';
import { SetPresenceDto } from './dto/set-presence.dto';
import { PresenceService } from './presence.service';

@ApiTags('Presence')
@ApiCookieAuth('better-auth.session_token')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Whether you are online or invisible, and until when',
  })
  getMine(@Session() session: UserSession) {
    return this.presence.getMine(session.user.id);
  }

  @Put('me')
  @ApiOperation({ summary: 'Go online, or be invisible for a chosen time' })
  setMine(@Session() session: UserSession, @Body() dto: SetPresenceDto) {
    return this.presence.setMine(session.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Online or offline for people you share an accepted chat with',
  })
  getVisible(
    @Session() session: UserSession,
    @Query() query: QueryPresenceDto,
  ) {
    return this.presence.getVisible(session.user.id, query.userIds);
  }
}
