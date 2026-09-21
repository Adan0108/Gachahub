import { Module } from '@nestjs/common';
import { MlsGroupRosterRepository } from './mls-group-roster.repository';

@Module({
  providers: [MlsGroupRosterRepository],
  exports: [MlsGroupRosterRepository],
})
export class MlsGroupRosterModule {}
