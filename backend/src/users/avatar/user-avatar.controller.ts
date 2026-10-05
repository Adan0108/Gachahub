import { Body, Controller, Delete, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UserAvatarService } from './user-avatar.service';

@ApiTags('Users')
@Controller('users/me/avatar')
export class UserAvatarController {
  constructor(private readonly userAvatarService: UserAvatarService) {}

  @Patch()
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Set your profile picture from a confirmed upload' })
  update(@Session() session: UserSession, @Body() dto: UpdateAvatarDto) {
    return this.userAvatarService.update(session.user.id, dto);
  }

  @Delete()
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Remove your profile picture' })
  remove(@Session() session: UserSession) {
    return this.userAvatarService.remove(session.user.id);
  }
}
