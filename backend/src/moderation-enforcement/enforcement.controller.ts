import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  AdjustSanctionDto,
  AppealDto,
  ConfirmViolationDto,
  ContentDecisionDto,
  ReasonDto,
  ReviewAppealDto,
  SanctionDto,
  ScopeQuery,
} from './enforcement.dto';
import { EnforcementService } from './enforcement.service';

@Controller('moderation/enforcement')
export class EnforcementController {
  @Get('operations') operations(@Session() session: UserSession) {
    return this.service.operations(session.user.id);
  }
  constructor(private readonly service: EnforcementService) {}
  @Get('cases/:caseId') overview(
    @Session() session: UserSession,
    @Param('caseId') id: string,
    @Query() scope: ScopeQuery,
  ) {
    return this.service.overview(session.user.id, id, scope.gameSlug);
  }
  @Post('cases/:caseId/content') content(
    @Session() session: UserSession,
    @Param('caseId') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: ContentDecisionDto,
  ) {
    return this.service.contentForCase(
      session.user.id,
      id,
      dto.hidden,
      dto.reason,
      scope.gameSlug,
    );
  }
  @Post('cases/:caseId/violations') confirm(
    @Session() session: UserSession,
    @Param('caseId') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: ConfirmViolationDto,
  ) {
    return this.service.confirm(session.user.id, id, dto, scope.gameSlug);
  }
  @Post('cases/:caseId/sanctions') sanction(
    @Session() session: UserSession,
    @Param('caseId') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: SanctionDto,
  ) {
    return this.service.sanction(session.user.id, id, dto, scope.gameSlug);
  }
  @Post('sanctions/:id/revoke') revoke(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: ReasonDto,
  ) {
    return this.service.revoke(session.user.id, id, dto.reason, scope.gameSlug);
  }
  @Patch('sanctions/:id') adjust(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: AdjustSanctionDto,
  ) {
    return this.service.adjust(session.user.id, id, dto, scope.gameSlug);
  }
  @Post('violations/:id/reverse') reverse(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: ReasonDto,
  ) {
    return this.service.reverseViolation(
      session.user.id,
      id,
      dto.reason,
      scope.gameSlug,
    );
  }
  @Get('appeals') appeals(
    @Session() session: UserSession,
    @Query() scope: ScopeQuery,
  ) {
    return this.service.appeals(session.user.id, scope.gameSlug, scope.cursor);
  }
  @Post('appeals/:id/review') review(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query() scope: ScopeQuery,
    @Body() dto: ReviewAppealDto,
  ) {
    return this.service.reviewAppeal(session.user.id, id, dto, scope.gameSlug);
  }
}

@Controller('me/moderation')
export class MyModerationController {
  constructor(private readonly service: EnforcementService) {}
  @Get() own(@Session() session: UserSession, @Query() query: ScopeQuery) {
    return this.service.own(session.user.id, query.cursor, query.contentCursor);
  }
  @Post('sanctions/:id/appeal') appeal(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: AppealDto,
  ) {
    return this.service.appeal(session.user.id, id, dto.statement);
  }
}
