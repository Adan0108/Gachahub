import { Module } from '@nestjs/common';
import { ProfileAccessService } from './profile-access.service';

@Module({
  providers: [ProfileAccessService],
  exports: [ProfileAccessService],
})
export class ProfileAccessModule {}
