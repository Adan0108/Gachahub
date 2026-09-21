import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  imports: [PrismaModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
