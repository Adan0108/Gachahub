import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatDevicesModule } from '../chat-devices/chat-devices.module';
import { MlsHandshakesController } from './mls-handshakes.controller';
import { MlsHandshakesService } from './mls-handshakes.service';
import { MlsHandshakesRepository } from './mls-handshakes.repository';

@Module({
  imports: [PrismaModule, ChatDevicesModule],
  controllers: [MlsHandshakesController],
  providers: [MlsHandshakesService, MlsHandshakesRepository],
})
export class MlsHandshakesModule {}
