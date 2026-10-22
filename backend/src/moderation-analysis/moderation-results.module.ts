import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessedEventRepository } from '../notifications/processed-event.repository';
import { ModerationResultService } from './moderation-result.service';
import { ModerationResultConsumer } from './moderation-result-consumer.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ProcessedEventRepository,
    ModerationResultService,
    ModerationResultConsumer,
  ],
})
export class ModerationResultsModule {}
