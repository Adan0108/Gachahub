import { Module } from '@nestjs/common';
import { SessionTerminatorModule } from '../auth/session-terminator.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  imports: [PrismaModule, SessionTerminatorModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
