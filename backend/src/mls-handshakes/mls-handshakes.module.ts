import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatDevicesModule } from '../chat-devices/chat-devices.module';
import { MlsGroupRosterModule } from '../mls-group-roster/mls-group-roster.module';
import { CommonModule } from '../common/common.module';
import { MlsAuditRepository } from './mls-audit.repository';
import { MlsIntegrityChecks } from './mls-integrity-checks';
import { MlsCommitFaultsService } from './mls-commit-faults.service';
import { MlsPendingService } from './mls-pending.service';
import { MlsFaultReportRateLimiterService } from './mls-fault-report-rate-limiter.service';
import { MlsRequestRateLimiterService } from './mls-request-rate-limiter.service';
import { MlsSelfJoinRateLimiterService } from './mls-self-join-rate-limiter.service';
import { MlsHandshakesController } from './mls-handshakes.controller';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import { MlsSelfJoinRepository } from './mls-self-join.repository';
import { MlsSelfJoinService } from './mls-self-join.service';
import { MlsMembershipWorkRepository } from './mls-membership-work.repository';
import { MlsMembershipWorkService } from './mls-membership-work.service';

@Module({
  imports: [
    PrismaModule,
    ChatDevicesModule,
    MlsGroupRosterModule,
    CommonModule,
  ],
  controllers: [MlsHandshakesController],
  providers: [
    MlsHandshakesService,
    MlsHandshakesRepository,
    MlsMembershipWorkService,
    MlsCommitFaultsService,
    MlsMembershipWorkRepository,
    MlsGroupInfoRepository,
    MlsSelfJoinRepository,
    MlsSelfJoinService,
    MlsSelfJoinRateLimiterService,
    MlsFaultReportRateLimiterService,
    MlsRequestRateLimiterService,
    MlsPendingService,
    MlsAuditRepository,
    MlsIntegrityChecks,
  ],
})
export class MlsHandshakesModule {}
