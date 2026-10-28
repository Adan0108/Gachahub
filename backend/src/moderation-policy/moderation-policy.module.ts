import { Module } from '@nestjs/common';
import { ModerationPolicyService } from './moderation-policy.service';

// Not imported by result ingestion; starts no background work.
@Module({
  providers: [ModerationPolicyService],
  exports: [ModerationPolicyService],
})
export class ModerationPolicyModule {}
