import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsMembershipWorkService } from './mls-membership-work.service';
import { SubmitHandshakeDto } from './dto/submit-handshake.dto';

@ApiTags('MLS Handshakes')
@ApiCookieAuth('better-auth.session_token')
@Controller('mls-handshakes')
export class MlsHandshakesController {
  constructor(
    private readonly mlsHandshakesService: MlsHandshakesService,
    private readonly mlsMembershipWorkService: MlsMembershipWorkService,
  ) {}

  @Post('conversations/:conversationId')
  @ApiOperation({
    summary: 'Submit an MLS Commit for a conversation, advancing its epoch',
  })
  submitHandshake(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: SubmitHandshakeDto,
  ) {
    return this.mlsHandshakesService.submitHandshake(
      session.user.id,
      conversationId,
      dto,
    );
  }

  @Get('conversations/:conversationId')
  @ApiOperation({
    summary: 'Fetch Commits for a conversation since a given epoch',
  })
  getHandshakesSince(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query('sinceEpoch', new DefaultValuePipe(0), ParseIntPipe)
    sinceEpoch: number,
  ) {
    return this.mlsHandshakesService.getHandshakesSince(
      session.user.id,
      conversationId,
      sinceEpoch,
    );
  }

  @Get('devices/:deviceId/welcomes')
  @ApiOperation({ summary: 'Fetch pending Welcomes for an owned device' })
  getPendingWelcomes(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.mlsHandshakesService.getPendingWelcomes(
      session.user.id,
      deviceId,
    );
  }

  @Get('devices/:deviceId/membership-work')
  @ApiOperation({
    summary:
      'List the membership changes (devices to add or remove) this device can finish, per conversation',
  })
  getMembershipWork(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Query('after') after?: string,
  ) {
    return this.mlsMembershipWorkService.getMembershipWork(
      session.user.id,
      deviceId,
      after,
    );
  }

  @Post('devices/:deviceId/welcomes/:welcomeId/consume')
  @ApiOperation({ summary: 'Mark a Welcome as consumed' })
  consumeWelcome(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Param('welcomeId') welcomeId: string,
  ) {
    return this.mlsHandshakesService.consumeWelcome(
      session.user.id,
      deviceId,
      welcomeId,
    );
  }
}
