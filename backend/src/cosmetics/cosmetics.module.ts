import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EconomyModule } from '../economy/economy.module';
import { AdminCosmeticsController } from './admin-cosmetics.controller';
import { CosmeticsController } from './cosmetics.controller';
import { CosmeticsService } from './cosmetics.service';

@Module({
  imports: [EconomyModule, AuditLogModule],
  controllers: [CosmeticsController, AdminCosmeticsController],
  providers: [CosmeticsService],
  exports: [CosmeticsService],
})
export class CosmeticsModule {}
