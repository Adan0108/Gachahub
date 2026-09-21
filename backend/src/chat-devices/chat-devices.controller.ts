import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatDevicesService } from './chat-devices.service';
import { ClaimKeyPackagesQueryDto } from './dto/claim-key-packages-query.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UploadKeyPackagesDto } from './dto/upload-key-packages.dto';

@ApiTags('Chat Devices')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat-devices')
export class ChatDevicesController {
  constructor(private readonly chatDevicesService: ChatDevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new MLS device for the current user' })
  registerDevice(
    @Session() session: UserSession,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.chatDevicesService.registerDevice(session.user.id, dto);
  }

  @Post(':deviceId/key-packages')
  @ApiOperation({ summary: 'Top up key packages for an owned device' })
  uploadKeyPackages(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Body() dto: UploadKeyPackagesDto,
  ) {
    return this.chatDevicesService.uploadKeyPackages(
      session.user.id,
      deviceId,
      dto,
    );
  }

  @Put(':deviceId/session')
  @ApiOperation({ summary: 'Link the current login to an owned device' })
  linkSession(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.linkSessionToDevice(
      session.user.id,
      deviceId,
      session.session.id,
    );
  }

  @Delete(':deviceId')
  @ApiOperation({
    summary: 'Revoke an owned device and end the logins linked to it',
  })
  revokeDevice(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.revokeDevice(
      session.user.id,
      deviceId,
      session.session.id,
    );
  }

  @Post('claim/:userId')
  @ApiOperation({
    summary:
      'Claim one key package per active device of a user, to add all their devices to an MLS group. Pass excludeDeviceId when claiming your own devices, to skip the one creating the group; pass conversationId when finishing a change to a group you are in, and deviceIds (comma-separated) to claim for only those devices.',
  })
  claimKeyPackages(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Query() query: ClaimKeyPackagesQueryDto,
  ) {
    return this.chatDevicesService.claimKeyPackagesForUser(
      session.user.id,
      userId,
      query,
    );
  }
}
