import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { EconomyService } from './economy.service';

@ApiTags('Wallet')
@ApiCookieAuth('better-auth.session_token')
@Controller('wallet')
export class WalletController {
  constructor(private readonly economy: EconomyService) {}

  @Get()
  @ApiOperation({ summary: 'Your Reputation, Shards, Prisms, rank and today' })
  get(@Session() session: UserSession) {
    return this.economy.getWallet(session.user.id);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Your balance history, newest first' })
  ledger(@Session() session: UserSession, @Query() query: LedgerQueryDto) {
    return this.economy.listLedger(session.user.id, query.cursor);
  }

  @Post('check-in')
  @HttpCode(200)
  @ApiOperation({ summary: "Claim today's check-in Shards" })
  checkIn(@Session() session: UserSession) {
    return this.economy.checkIn(session.user.id);
  }
}
