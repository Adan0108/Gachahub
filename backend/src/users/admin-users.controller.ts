import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { QueryUsersAdminDto } from './dto/query-users-admin.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserModerationService } from './user-moderation.service';

@ApiTags('Users')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly userModerationService: UserModerationService) {}

  @Get()
  @ApiOperation({ summary: 'List platform users. Admin only.' })
  list(@Query() query: QueryUsersAdminDto) {
    return this.userModerationService.listForAdmin(query);
  }

  @Patch(':userId/status')
  @ApiOperation({
    summary: 'Ban, suspend, or reactivate a user account. Admin only.',
  })
  updateStatus(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.userModerationService.setStatus(
      userId,
      dto.status,
      session.user.id,
      dto.reason,
    );
  }
}
