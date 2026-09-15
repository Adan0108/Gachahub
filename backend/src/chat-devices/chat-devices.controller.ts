import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatDevicesService } from './chat-devices.service';
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

  @Delete(':deviceId')
  @ApiOperation({ summary: 'Revoke an owned device' })
  revokeDevice(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.revokeDevice(session.user.id, deviceId);
  }

  @Post('claim/:userId')
  @ApiOperation({
    summary:
      'Claim one key package for a user, to add their device to an MLS group',
  })
  claimKeyPackage(
    @Session() session: UserSession,
    @Param('userId') userId: string,
  ) {
    return this.chatDevicesService.claimKeyPackageForUser(
      session.user.id,
      userId,
    );
  }
}
