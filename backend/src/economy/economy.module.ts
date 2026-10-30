import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminWalletController } from './admin-wallet.controller';
import { EconomyRankJob } from './economy-rank.job';
import { EconomyService } from './economy.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [AuditLogModule],
  controllers: [WalletController, AdminWalletController],
  providers: [EconomyService, EconomyRankJob],
  exports: [EconomyService],
})
export class EconomyModule {}
