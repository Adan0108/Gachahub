import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MlsRetentionService } from './mls-retention.service';

@Module({
  imports: [CommonModule],
  providers: [MlsRetentionService],
})
export class MlsRetentionModule {}
