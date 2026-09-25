import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsCommitFaultsService } from './mls-commit-faults.service';
import { MlsMembershipWorkService } from './mls-membership-work.service';
import { ExternalJoinDto } from './dto/external-join.dto';
import { MlsPendingService } from './mls-pending.service';
import { MlsSelfJoinService } from './mls-self-join.service';
import { ReportCommitFaultDto } from './dto/report-commit-fault.dto';
import { HandshakesSinceQueryDto } from './dto/handshakes-since-query.dto';
import { SubmitHandshakeDto } from './dto/submit-handshake.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { DeviceQueryDto } from './dto/device-query.dto';
import { MembershipWorkQueryDto } from './dto/membership-work-query.dto';
import { ScopeQueryDto } from './dto/scope-query.dto';
import { PendingWelcomesQueryDto } from './dto/pending-welcomes-query.dto';

@ApiTags('MLS Handshakes')
@ApiCookieAuth('better-auth.session_token')
@Controller('mls-handshakes')
export class MlsHandshakesController {
  constructor(
    private readonly mlsHandshakesService: MlsHandshakesService,
    private readonly mlsMembershipWorkService: MlsMembershipWorkService,
    private readonly mlsCommitFaultsService: MlsCommitFaultsService,
    private readonly mlsSelfJoinService: MlsSelfJoinService,
    private readonly mlsPendingService: MlsPendingService,
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

  @Post('conversations/:conversationId/external-join')
  @ApiOperation({
    summary:
      'Join the group by yourself with an external commit, when no member has to be online',
  })
  submitExternalJoin(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: ExternalJoinDto,
  ) {
    return this.mlsHandshakesService.submitExternalJoin(
      session.user.id,
      conversationId,
      dto,
    );
  }

  @Get('conversations/:conversationId/group-info')
  @ApiOperation({
    summary:
      'The public snapshot of the group to join from, for a device of someone entitled to join',
  })
  getGroupInfo(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query() { deviceId }: DeviceQueryDto,
  ) {
    return this.mlsSelfJoinService.getGroupInfo(
      session.user.id,
      conversationId,
      deviceId,
    );
  }

  @Get('devices/:deviceId/joinable-conversations')
  @ApiOperation({
    summary:
      'Conversations this device could join by itself. scope=full also finds a new device of an existing member.',
  })
  listJoinable(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Query() { scope }: ScopeQueryDto,
  ) {
    return this.mlsSelfJoinService.listJoinable(
      session.user.id,
      deviceId,
      scope ?? 'pending',
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
    summary:
      'Fetch Commits for a conversation since a given epoch, at most one page (100); a full page means ask again from the new epoch',
  })
  getHandshakesSince(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query() query: HandshakesSinceQueryDto,
  ) {
    return this.mlsHandshakesService.getHandshakesSince(
      session.user.id,
      conversationId,
      query.sinceEpoch,
    );
  }

  @Get('conversations/:conversationId/roster')
  @ApiOperation({
    summary:
      'The devices that were in the group at an epoch, with their registered keys, to check a ratchet tree against',
  })
  getRosterAtEpoch(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query() query: RosterQueryDto,
  ) {
    return this.mlsHandshakesService.getRosterAtEpoch(
      session.user.id,
      conversationId,
      query.epoch,
    );
  }

  @Get('devices/:deviceId/pending')
  @ApiOperation({
    summary:
      'Whether this device has anything waiting: welcomes, groups to join by itself, or membership work',
  })
  getPendingSummary(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
  ) {
    return this.mlsPendingService.getPendingSummary(session.user.id, deviceId);
  }

  @Get('devices/:deviceId/welcomes')
  @ApiOperation({
    summary:
      'Fetch pending Welcomes for an owned device, oldest first, at most one page (50); pass `after` (the last id seen) to walk past ones that cannot be consumed',
  })
  getPendingWelcomes(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Query() query: PendingWelcomesQueryDto,
  ) {
    return this.mlsHandshakesService.getPendingWelcomes(
      session.user.id,
      deviceId,
      query.after,
    );
  }

  @Post('devices/:deviceId/membership-work')
  @ApiOperation({
    summary:
      'Take the membership changes (devices to add or remove) this device can finish, per conversation',
  })
  getMembershipWork(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Query() { scope, after, conversationId }: MembershipWorkQueryDto,
  ) {
    return this.mlsMembershipWorkService.getMembershipWork(
      session.user.id,
      deviceId,
      { scope: scope ?? 'pending', after, conversationId },
    );
  }

  @Post('devices/:deviceId/membership-work/:conversationId/release')
  @ApiOperation({
    summary:
      'Give back the lease on a conversation whose membership work this device could not finish',
  })
  releaseMembershipWork(
    @Session() session: UserSession,
    @Param('deviceId') deviceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.mlsMembershipWorkService.releaseMembershipWork(
      session.user.id,
      deviceId,
      conversationId,
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
