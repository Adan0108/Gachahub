import { Module } from '@nestjs/common';
import { SessionTerminatorModule } from '../auth/session-terminator.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DevController } from './dev.controller';
import { DevEmotesController } from './dev-emotes.controller';
import { DevEmotesService } from './dev-emotes.service';
import { DevService } from './dev.service';

@Module({
  imports: [PrismaModule, SessionTerminatorModule],
  controllers: [DevController, DevEmotesController],
  providers: [DevService, DevEmotesService],
})
export class DevModule {}
