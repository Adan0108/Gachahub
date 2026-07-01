import { Controller, Get } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

@Controller('users')
export class UsersController {
  @Get('me')
  getMe(@Session() session: UserSession) {
    return session.user;
  }
}
