import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatDevicesModule } from '../chat-devices/chat-devices.module';
import { MlsGroupRosterModule } from '../mls-group-roster/mls-group-roster.module';
import { CommonModule } from '../common/common.module';
import { MlsCommitFaultsService } from './mls-commit-faults.service';
import { MlsHandshakesController } from './mls-handshakes.controller';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
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
  ],
})
export class MlsHandshakesModule {}
