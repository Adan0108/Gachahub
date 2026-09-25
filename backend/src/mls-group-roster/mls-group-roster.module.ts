import { Module } from '@nestjs/common';
import { MlsGroupRosterRepository } from './mls-group-roster.repository';
import { ParticipantStateRepository } from './participant-state.repository';

@Module({
  providers: [MlsGroupRosterRepository, ParticipantStateRepository],
  exports: [MlsGroupRosterRepository, ParticipantStateRepository],
})
export class MlsGroupRosterModule {}
