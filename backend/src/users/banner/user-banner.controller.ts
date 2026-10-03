import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { UserBannerService } from './user-banner.service';

@ApiTags('Users')
@Controller('users/me')
export class UserBannerController {
  constructor(private readonly userBannerService: UserBannerService) {}

  @Get('banner-options')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Profile banner designs and which you can use' })
  list() {
    return this.userBannerService.list();
  }

  @Patch('banner')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Pick a profile banner design' })
  update(@Session() session: UserSession, @Body() dto: UpdateBannerDto) {
    return this.userBannerService.update(session.user.id, dto);
  }

  @Delete('banner')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Reset your profile banner to the default' })
  remove(@Session() session: UserSession) {
    return this.userBannerService.remove(session.user.id);
  }
}
