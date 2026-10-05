import { Module } from '@nestjs/common';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { MentionsService } from './mentions.service';

@Module({
  imports: [DomainEventsModule],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
