import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { EconomyService } from './economy.service';

@ApiTags('Wallet')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin/users/:userId/wallet')
@UseGuards(AdminGuard)
export class AdminWalletController {
  constructor(private readonly economy: EconomyService) {}

  @Get()
  @ApiOperation({ summary: "A user's balances and rank. Admin only." })
  get(@Param('userId') userId: string) {
    return this.economy.getWallet(userId);
  }

  @Get('ledger')
  @ApiOperation({ summary: "A user's balance history. Admin only." })
  ledger(@Param('userId') userId: string, @Query() query: LedgerQueryDto) {
    return this.economy.listLedger(userId, query.cursor);
  }

  @Post('adjust')
  @ApiOperation({
    summary: 'Correct a balance, with a reason; audit-logged. Admin only.',
  })
  adjust(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() dto: AdjustWalletDto,
  ) {
    return this.economy.adjust({ adminId: session.user.id, userId, ...dto });
  }
}
