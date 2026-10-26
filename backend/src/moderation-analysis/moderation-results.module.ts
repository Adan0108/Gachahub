import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessedEventRepository } from '../notifications/processed-event.repository';
import { ModerationResultService } from './moderation-result.service';
import { ModerationResultConsumer } from './moderation-result-consumer.service';
import { ModerationServiceAuthGuard } from './moderation-service-auth.guard';
import { ModerationAnalysisInternalController } from './moderation-analysis-internal.controller';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ModerationAnalysisInputService } from './moderation-analysis-input.service';

@Module({
  imports: [PrismaModule],
  controllers: [ModerationAnalysisInternalController],
  providers: [
    ModerationServiceAuthGuard,
    ModerationAnalysisInputService,
    ProcessedEventRepository,
    ModerationResultService,
    ModerationResultConsumer,
  ],
})
export class ModerationResultsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Cover authentication, validation and error responses too.
    consumer
      .apply(
        (_req: unknown, res: import('express').Response, next: () => void) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Pragma', 'no-cache');
          next();
        },
      )
      .forRoutes(ModerationAnalysisInternalController);
  }
}
