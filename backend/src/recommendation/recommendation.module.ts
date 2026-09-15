import { Module } from '@nestjs/common';
import { UserInterestRepository } from './user-interest.repository';
import { UserInterestService } from './user-interest.service';

@Module({
  providers: [UserInterestRepository, UserInterestService],
  exports: [UserInterestService],
})
export class RecommendationModule {}
