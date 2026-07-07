import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

@ApiTags('Users')
@ApiCookieAuth('better-auth.session_token')
@Controller('users')
export class UsersController {
  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@Session() session: UserSession) {
    return session.user;
  }
}
