import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatBackupDeletionService } from './chat-backup-deletion.service';
import { ChatBackupController } from './chat-backup.controller';
import { ChatBackupRateLimiterService } from './chat-backup-rate-limiter.service';
import { ChatBackupRepository } from './chat-backup.repository';
import { ChatBackupService } from './chat-backup.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [ChatBackupController],
  providers: [
    ChatBackupService,
    ChatBackupRepository,
    ChatBackupRateLimiterService,
    ChatBackupDeletionService,
  ],
})
export class ChatBackupModule {}
