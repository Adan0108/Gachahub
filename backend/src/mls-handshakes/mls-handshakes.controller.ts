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
import { MlsCommitFaultsService } from './mls-commit-faults.service';
import { MlsMembershipWorkService } from './mls-membership-work.service';
import { ReportCommitFaultDto } from './dto/report-commit-fault.dto';
import { SubmitHandshakeDto } from './dto/submit-handshake.dto';

@ApiTags('MLS Handshakes')
@ApiCookieAuth('better-auth.session_token')
@Controller('mls-handshakes')
export class MlsHandshakesController {
  constructor(
    private readonly mlsHandshakesService: MlsHandshakesService,
    private readonly mlsMembershipWorkService: MlsMembershipWorkService,
    private readonly mlsCommitFaultsService: MlsCommitFaultsService,
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

  @Post('conversations/:conversationId/faults')
  @ApiOperation({
    summary:
      'Report that this client refused a Commit because it did not match what the server recorded',
  })
  reportCommitFault(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: ReportCommitFaultDto,
  ) {
    return this.mlsCommitFaultsService.reportFault(
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
    @Query('scope') scope?: string,
    @Query('after') after?: string,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.mlsMembershipWorkService.getMembershipWork(
      session.user.id,
      deviceId,
      // `full` also finds new, revoked and leftover devices but costs more, so
      // clients ask for it rarely; anything else means the cheap default.
      { scope: scope === 'full' ? 'full' : 'pending', after, conversationId },
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
