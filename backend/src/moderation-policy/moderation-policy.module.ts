import { Module } from '@nestjs/common';
import { ModerationPolicyService } from './moderation-policy.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ModerationPolicyRepository } from './moderation-policy.repository';
import { ModerationPolicyRunner } from './moderation-policy-runner.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ModerationPolicyService,
    ModerationPolicyRepository,
    ModerationPolicyRunner,
  ],
  exports: [ModerationPolicyService, ModerationPolicyRepository],
})
export class ModerationPolicyModule {}
