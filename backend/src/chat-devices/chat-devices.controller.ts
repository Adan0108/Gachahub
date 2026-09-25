import {
  Body,
  Controller,
  Delete,
  Get,
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
import { LinkSessionDto } from './dto/link-session.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UploadKeyPackagesDto } from './dto/upload-key-packages.dto';

@ApiTags('Chat Devices')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat-devices')
export class ChatDevicesController {
  constructor(private readonly chatDevicesService: ChatDevicesService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's own MLS devices" })
  listDevices(@Session() session: UserSession) {
    return this.chatDevicesService.listOwnDevices(session.user.id);
  }

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

  @Get(':deviceId/key-packages/status')
  @ApiOperation({
    summary:
      'How many single-use key packages an owned device has left, and when its last-resort one expires',
  })
  keyPackageStatus(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.getKeyPackageStatus(
      session.user.id,
      deviceId,
    );
  }

  @Post(':deviceId/session/challenge')
  @ApiOperation({
    summary: 'Get a challenge to prove this login is in an owned device',
  })
  sessionLinkChallenge(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.issueSessionLinkChallenge(
      session.user.id,
      deviceId,
      session.session.id,
    );
  }

  @Put(':deviceId/session')
  @ApiOperation({
    summary:
      'Link the current login to an owned device, given a signed challenge',
  })
  linkSession(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Body() dto: LinkSessionDto,
  ) {
    return this.chatDevicesService.linkSessionToDevice(
      session.user.id,
      deviceId,
      session.session.id,
      dto,
    );
  }

  @Post(':deviceId/sign-out')
  @ApiOperation({
    summary: 'Sign an owned device out of the app, everywhere, at once',
  })
  signOutDevice(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chatDevicesService.signOutDevice(
      session.user.id,
      deviceId,
      session.session.id,
    );
  }

  @Delete(':deviceId')
  @ApiOperation({ summary: 'Retire an owned device for good' })
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
