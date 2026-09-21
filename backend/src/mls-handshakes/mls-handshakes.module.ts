import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatDevicesModule } from '../chat-devices/chat-devices.module';
import { MlsGroupRosterModule } from '../mls-group-roster/mls-group-roster.module';
import { MlsHandshakesController } from './mls-handshakes.controller';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';
import { MlsMembershipWorkRepository } from './mls-membership-work.repository';
import { MlsMembershipWorkService } from './mls-membership-work.service';

@Module({
  imports: [PrismaModule, ChatDevicesModule, MlsGroupRosterModule],
  controllers: [MlsHandshakesController],
  providers: [
    MlsHandshakesService,
    MlsHandshakesRepository,
    MlsMembershipWorkService,
    MlsMembershipWorkRepository,
  ],
})
export class MlsHandshakesModule {}
